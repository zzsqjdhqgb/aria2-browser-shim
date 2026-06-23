# aria2-browser-shim v2 Design

## Overview

Complete rewrite of the aria2-browser-shim browser extension. A Chromium extension (Manifest V3) that intercepts aria2 JSON-RPC calls from userscripts on any webpage and redirects them to the browser's native download manager, eliminating the need to install aria2. Bundles aria2NG as the main download management UI.

## Requirements

### Functional
- Intercept `fetch`, `XMLHttpRequest`, and `WebSocket` calls to `localhost:6800` / `127.0.0.1:6800` on any webpage
- Implement the full aria2 JSON-RPC 2.0 protocol faithfully
- WebSocket event notifications (onDownloadStart, onDownloadComplete, etc.)
- Download with custom request headers (Cookie, Referer, User-Agent) via declarativeNetRequest
- Browser-native download triggering via background tab navigation
- Persistent download history via IndexedDB
- Popup UI (React + Tailwind CSS): status overview, "Open aria2NG" button
- Options UI (React + Tailwind CSS): token, download directory, concurrency
- Bundled aria2NG as the main download management interface (zero modifications)

### Non-Functional
- Chromium-only (Chrome, Edge, Opera, etc.)
- WXT build framework
- Manifest V3
- Persistent service worker compatible (not relying on long-lived background state without storage)
- Graceful error handling with full aria2 error codes
- Timeout and retry for orphaned download tabs

## Architecture

### Communication Flow

```
Any webpage (userscripts, hosted aria2NG, or bundled aria2NG)
  fetch/XMLHttpRequest/WebSocket → localhost:6800
    ↓ intercepted by
main.content.ts (MAIN world)
    ↓ CustomEvent
bridge.content.ts (ISOLATED world)
    ↓ chrome.runtime.sendMessage / chrome.runtime.connect
background.ts (service worker)
    ↓
Aria2Server → DownloadManager → TaskStore (IndexedDB)
                ↓
         chrome.declarativeNetRequest + chrome.tabs + chrome.downloads
```

### Entrypoints

| Entrypoint | Type | World | Purpose |
|---|---|---|---|
| `background.ts` | Service worker | — | Assembles and coordinates all core modules |
| `main.content.ts` | Content script | MAIN | Monkey-patches fetch/XHR/WebSocket on every page |
| `bridge.content.ts` | Content script | ISOLATED | Bridges MAIN world ↔ background via CustomEvent |
| `popup/` | Extension page | — | React popup with download overview and "Open UI" button |
| `options/` | Extension page | — | React settings page |
| `ui/` | Extension page | — | Hosts bundled aria2NG (configured for localhost:6800, zero changes) |

### Key Design Decisions

1. **Content scripts are the universal entry point.** The same interception logic runs on every page — userscripts, online aria2NG, the bundled aria2NG page — all transparently routed to the background. No per-page adapters needed.

2. **aria2NG is bundled with zero modifications.** The extension packages aria2NG's built output. The config points it at `localhost:6800`. The content script automatically intercepts these calls. aria2NG's polling (every 1s) and WebSocket both work transparently.

3. **WebSocket emulation via chrome.runtime.connect.** MAIN world creates a FakeWebSocket that uses CustomEvent → Port as transport. Background broadcasts aria2 events to all connected clients via the port. Client disconnection is detected and cleaned up.

4. **Download mechanism: DNR + background tabs.** The only approach that works for injecting custom headers into browser downloads. DNR rules inject request headers and force `Content-Disposition: attachment`. A background tab navigates to the URL, triggering native download. Tab and rule are cleaned up once the download fires or times out.

5. **IndexedDB for persistence.** Large download history survives service worker restarts. Settings (token, directory, concurrency) use chrome.storage.sync for small config.

## Module Design

### `core/aria2-server.ts` — JSON-RPC 2.0 Protocol Handler

- Parse requests (single object or batch array)
- Route method names to implementations
- Return standard JSON-RPC 2.0 responses (result or error)
- Handle batch requests with Promise.all
- Token authentication: strip `token:` prefix from params, validate against stored token
- Full error code table:

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -1, -2, ..., -9 | aria2-specific error codes |

### `core/aria2-methods.ts` — Method Implementations

Each method is a pure function: `(params, context) => Promise<Result>`. `context` provides access to DownloadManager and TaskStore.

| Method | Implementation |
|---|---|
| `aria2.addUri` | Parse URIs + options → DownloadManager.create(). Return GID. |
| `aria2.addTorrent` / `aria2.addMetalink` | Return error: browser native downloads only. |
| `aria2.remove` / `aria2.forceRemove` | Cancel download, remove from store. |
| `aria2.pause` / `aria2.forcePause` | Pause browser download. |
| `aria2.unpause` | Resume browser download. |
| `aria2.tellStatus` | Lookup by GID, return full aria2 status struct. Include real completedLength, totalLength, downloadSpeed, uploadSpeed, connections, dir, files, etc. |
| `aria2.tellActive` | Return tasks with status=active. Support keys filter, sort, offset, num. |
| `aria2.tellWaiting` | Return tasks with status=waiting. Same filtering. |
| `aria2.tellStopped` | Return stopped tasks. Same filtering. |
| `aria2.getOption` / `aria2.changeOption` | Per-task option CRUD. |
| `aria2.getGlobalOption` / `aria2.changeGlobalOption` | Global option CRUD. Persist to chrome.storage. |
| `aria2.getVersion` | Return honest capabilities (no BitTorrent, no Metalink, no FTP). |
| `aria2.getSessionInfo` | Return persistent session ID. |
| `aria2.shutdown` / `aria2.forceShutdown` | Cancel all downloads, close all ports. |
| `aria2.getGlobalStat` | Aggregate stats from active tasks. |
| `aria2.changePosition` | Reorder waiting tasks. |
| `aria2.purgeDownloadResult` / `aria2.removeDownloadResult` | Clear completed/error tasks from store. |

### `core/download-manager.ts` — Download Orchestrator

**State machine:**
```
pending → in_progress → complete
                     → error (interrupted)
                     → cancelled
```

**Lifecycle:**
1. `create(requests: DownloadRequest[])` → for each URL:
   - Generate 16-char hex GID
   - Build filename from aria2 options (dir + out)
   - Create DNR session rule for this URL:
     - Action: modifyHeaders → SET request headers + force Content-Disposition: attachment
     - Condition: exact URL match, MAIN_FRAME resource type
   - `chrome.tabs.create({ url, active: false })` → background tab
   - Store task with status `pending`, rule ID, tab ID
   - Start 30s timeout: if no download fires, close tab + remove rule + mark task error

2. On `chrome.downloads.onCreated`:
   - Match download URL to pending tasks
   - Set `browserDownloadId`, transition to `in_progress`
   - Cleanup: remove DNR rule, close background tab
   - Broadcast `onDownloadStart` event

3. On `chrome.downloads.onChanged`:
   - Track `totalBytes`, `fileSize`, `bytesReceived` for progress
   - State transitions: `in_progress` → `complete` (fileSize matches totalBytes and state is complete), `in_progress` → `error` (state is interrupted)
   - Broadcast corresponding events
   - On terminal states: remove DNR rule, close tab (defensive cleanup)

4. **Pause/Resume/Cancel:** delegate to `chrome.downloads` API, update internal state.

5. **Timeout mechanism:** 30s timer from tab creation. If no download created by then, assume failure, clean up.

### `core/task-store.ts` — IndexedDB Persistence

**Schema:**
```
Tasks store:
  key: gid (string)
  value: {
    gid: string,
    uris: string[],
    status: 'pending' | 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed',
    options: {...},
    browserDownloadId: number | null,
    totalLength: number,
    completedLength: number,
    downloadSpeed: number,
    uploadSpeed: number,
    connections: number,
    dir: string,
    files: Array<{ index, path, length, completedLength, selected, uris }>,
    errorCode: number | null,
    errorMessage: string | null,
    createdAt: number,
    updatedAt: number
  }
```

**Operations:** get(gid), query(filter, sort, offset, num), upsert(task), delete(gid), purge(status).

### `core/websocket-bridge.ts` — Event Broadcasting

- Background maintains a `Set<{ portId, sessionId }>` of connected clients
- On `chrome.runtime.onConnect`, register the port, send `aria2.onConnect` with session info
- On port disconnect, remove from set
- `broadcast(method, params)` → sends JSON-RPC notification to all connected ports
- Events: onDownloadStart, onDownloadPause, onDownloadStop, onDownloadComplete, onDownloadError, onBtDownloadComplete

### Content Scripts

**`main.content.ts` (MAIN world):**
- Injected at `document_start` via `world: 'MAIN'`
- Monkey-patches `window.fetch`: intercepts URLs matching `localhost:6800` / `127.0.0.1:6800`, dispatches via `CustomEvent('__aria2shim_request__')`, returns mock response
- Monkey-patches `window.XMLHttpRequest`: intercepts `open()` for matching URLs, routes via CustomEvent
- Monkey-patches `window.WebSocket`: returns `FakeWebSocket` for matching URLs
- `FakeWebSocket` class: implements WebSocket API surface using CustomEvent + polling for receive
- For WebSocket: one persistent `chrome.runtime.connect` port per page, multiplexed through the bridge
- 30s request timeout with `-32603` error response
- Creates a hidden `<span>` element for CustomEvent dispatch

**`bridge.content.ts` (ISOLATED world):**
- Listens for `__aria2shim_request__` CustomEvent on the hidden element
- For HTTP requests: `chrome.runtime.sendMessage({ type: 'rpc', payload })` → sends response back via `__aria2shim_response__` CustomEvent
- For WebSocket: establishes `chrome.runtime.connect` port, relays messages bidirectionally
- Forwards `__aria2shim_event__` events to the MAIN world FakeWebSocket instances

### React UI

**Popup (`entrypoints/popup/`):**
- Components: `App`, `StatusOverview`, `RecentDownloads`, `ActionBar`
- StatusOverview: active/waiting/paused/error counts, global download speed
- RecentDownloads: last 5 downloads with filename, progress bar, status badge
- ActionBar: "Open aria2NG" button (opens `chrome-extension://{id}/ui/index.html` in new tab), settings gear icon, pause/resume all button
- Communicates with background via `chrome.runtime.sendMessage` for initial data load
- Subscribes to background Port for real-time status updates while popup is open

**Options (`entrypoints/options/`):**
- Components: `App`, `TokenSettings`, `DirectorySettings`, `GlobalOptions`
- TokenSettings: set/change RPC secret token
- DirectorySettings: default download directory path
- GlobalOptions: max-concurrent-downloads, max-connection-per-server, aria2NG source preference

### UI Page (`entrypoints/ui/`):
- Static HTML that loads the bundled aria2NG app
- aria2NG is configured to connect to `localhost:6800` (default)
- Content scripts automatically intercept these requests
- aria2NG is a git submodule at `src/entrypoints/ui/aria2ng/`, built as part of the extension build
- Alternatively: references an online deployment (configurable in options)

## Dependencies

- **WXT**: extension build framework
- **React 19 + React DOM**: popup and options UI
- **Tailwind CSS v4**: utility CSS
- **idb**: IndexedDB wrapper for ergonomic async API
- **aria2NG**: bundled as git submodule, built static files

## Manifest Permissions

- `downloads`: browser.downloads API
- `declarativeNetRequest`: header injection for downloads
- `tabs`: background tab management
- `storage`: settings persistence
- `unlimitedStorage`: IndexedDB for download history
- `host_permissions`: `<all_urls>` (content script injection + DNR rules on any URL)

## Error Handling

- All aria2 methods return proper error codes per the aria2 RPC spec
- Download failures have 30s timeout with automatic cleanup
- Service worker suspend/resume: all state persisted to IndexedDB, restored on wake
- Invalid Download URLs: tab opens → 30s no download → mark error, close tab, remove DNR rule
- Port disconnections: detected via `onDisconnect`, cleaned up immediately
- Batch requests: individual request failures don't fail the entire batch

## Testing Strategy

- Unit tests: aria2-methods (pure functions), GID generation, header parsing
- Integration tests: download-manager state machine, task-store CRUD
- E2E: load extension in Chromium, verify userscript interception with real aria2NG UI
- Manual verification: test with common cloud-drive userscripts (BaiduPan, AliyunDrive)
