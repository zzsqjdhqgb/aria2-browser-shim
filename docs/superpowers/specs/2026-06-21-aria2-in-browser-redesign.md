# aria2-in-browser: Complete Rewrite Design Spec

**Date:** 2026-06-21
**Status:** Awaiting approval
**Branch:** rebuild

---

## 1. Overview

Complete rewrite of the aria2-in-browser browser extension. The extension emulates an aria2 JSON-RPC server inside the browser, intercepting requests to `localhost:6800` and redirecting them to the browser's native download manager via `tabs.create()` + `declarativeNetRequest` header injection.

A bundled, unmodified AriaNg Web UI provides a full download management dashboard.

**Zero prior code reused.** Only browser extension API call patterns are referenced from the original PoC.

### 1.1 Key Decisions

| Decision | Choice |
|----------|--------|
| Framework | WXT (Manifest V3) |
| RPC methods | Multi-client compatible — ~20 methods, graceful degradation for unsupported |
| Download mechanism | `tabs.create()` + DNR header injection (primary), strategy pattern for extensibility |
| Transport | HTTP JSON-RPC + WebSocket |
| UI | Bundled unmodified AriaNg + lightweight popup with controls |
| State persistence | `chrome.storage.session` (hot state) + `chrome.storage.local` (history/settings) |
| Testing | Vitest unit tests + Playwright E2E |

---

## 2. Architecture: Message-Oriented + Persisted State

### 2.1 Architectural Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ MAIN World (main.content.ts)                                │
│  • Intercepts fetch → localhost:6800                        │
│  • Intercepts WebSocket → localhost:6800                    │
│  • CustomEvent "aria2-shim-request" → bridge                │
└────────────────────┬────────────────────────────────────────┘
                     │ CustomEvent
┌────────────────────▼────────────────────────────────────────┐
│ ISOLATED World (bridge.content.ts)                          │
│  • Listens for "aria2-shim-request" CustomEvent             │
│  • runtime.sendMessage → background SW                      │
│  • Dispatches "aria2-shim-response" CustomEvent             │
└────────────────────┬────────────────────────────────────────┘
                     │ runtime.sendMessage
┌────────────────────▼────────────────────────────────────────┐
│ Background Service Worker (background.ts)                   │
│  • Thin router: dispatches message types                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ RPC Layer (lib/rpc/)                                  │   │
│  │  • dispatcher.ts — method → handler routing           │   │
│  │  • methods/ — one file per aria2 method              │   │
│  │  • response-factory.ts — standard response builders  │   │
│  └────────────────────┬─────────────────────────────────┘   │
│  ┌────────────────────▼─────────────────────────────────┐   │
│  │ DownloadManager (lib/download-manager.ts)             │   │
│  │  • Strategy pattern for download execution            │   │
│  │  • Pending correlation map (URL → task)               │   │
│  │  • GID encoding/decoding                              │   │
│  └────────────────────┬─────────────────────────────────┘   │
│  ┌────────────────────▼─────────────────────────────────┐   │
│  │ Storage Layer (lib/storage.ts)                        │   │
│  │  • chrome.storage.session — active tasks              │   │
│  │  • chrome.storage.local — history, settings           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Why This Architecture

- **SW termination resilience:** All mutable state persists through SW suspend/resume cycles. GIDs encode the browser download ID inline, so pause/resume/cancel work without a lookup table.
- **Testability:** Each module has a single responsibility and explicit interface. RPC methods are pure async functions that can be tested with mock contexts.
- **Extensibility:** Download strategies register via a common interface. New download mechanisms can be added without touching core logic.
- **WXT-native:** Uses `defineBackground`, `defineContentScript` conventions. Module separation follows WXT's build model (MAIN world scripts are isolated bundles).

---

## 3. Module Design

### 3.1 File Structure

```
entrypoints/
├── background.ts              # Service Worker — thin router
├── main.content.ts            # MAIN world — fetch + WebSocket interception
├── bridge.content.ts          # ISOLATED world — CustomEvent ↔ runtime bridge
├── popup/
│   ├── index.html             # Popup window (lightweight)
│   └── App.tsx                # Preact component: toggles + status + AriaNg entry
└── ariang/
    ├── index.html             # Original AriaNg (unmodified, configured for localhost)
    ├── js/                    # Original AriaNg assets
    ├── css/
    └── langs/

lib/
├── storage.ts                 # State persistence layer
├── download-manager.ts        # Download execution engine
├── download-strategies/
│   └── tab-dnr.ts             # Tab + DNR strategy (primary)
├── rpc/
│   ├── types.ts               # JSON-RPC type definitions
│   ├── dispatcher.ts          # Method → handler router
│   ├── response-factory.ts    # Response construction helpers
│   └── methods/               # One file per aria2 method
│       ├── add-uri.ts
│       ├── tell-status.ts
│       ├── tell-active.ts
│       ├── tell-stopped.ts
│       ├── tell-waiting.ts
│       ├── get-version.ts
│       ├── get-global-stat.ts
│       ├── get-files.ts
│       ├── get-uris.ts
│       ├── get-option.ts
│       ├── get-global-option.ts
│       ├── change-option.ts
│       ├── change-global-option.ts
│       ├── pause.ts
│       ├── unpause.ts
│       ├── remove.ts
│       ├── remove-download-result.ts
│       ├── purge-download-result.ts
│       ├── add-metalink.ts
│       ├── add-torrent.ts
│       └── system-multicall.ts
├── message-router.ts          # Message type definitions + dispatch
├── per-site-config.ts         # Per-origin enable/disable
├── gid.ts                     # GID encoding/decoding
└── logging.ts                 # Structured logging utility

e2e/
├── fixtures/
│   └── extension.ts           # Extension loading helpers
└── specs/
    ├── interception.spec.ts
    ├── ariang-ui.spec.ts
    ├── download-flow.spec.ts
    └── popup.spec.ts
```

### 3.2 GID Encoding

Aria2 GIDs are 16-character hex strings. This extension encodes data into the GID for stateless operation:

```
Structure:  48 + a1b2c3 + 0000002d
            │     │        └─ browserDownloadId (8 hex chars, zero-padded)
            │     └─ Random salt (6 hex chars, 3 bytes)
            └─ Prefix "48" (1 byte) — marks this task as extension-managed
```

**Encode:** `encodeGid(prefix: "48", salt: "a1b2c3", browserId: 45) → "48a1b2c30000002d"`
**Decode:** `decodeGid("48a1b2c30000002d") → { prefix: "48", salt: "a1b2c3", browserId: 45 }`

When a task is first created (browserDownloadId unknown), the browser ID portion is `"00000000"`. After `onCreated` fires, the GID is re-encoded with the real browser download ID.

### 3.3 Storage Layer (`lib/storage.ts`)

```typescript
// Active tasks — hot state, survives SW restart within session
namespace SessionStore {
  putTask(task: DownloadTask): Promise<void>
  getTask(gid: string): Promise<DownloadTask | null>
  getAllTasks(): Promise<DownloadTask[]>
  removeTask(gid: string): Promise<void>
}

// Persistent state — survives across browser restarts
namespace LocalStore {
  getPerSiteEnabled(origin: string): Promise<boolean>
  setPerSiteEnabled(origin: string, enabled: boolean): Promise<void>
  getSettings(): Promise<AppSettings>
  putSettings(s: AppSettings): Promise<void>
  getDownloadHistory(limit: number): Promise<DownloadTask[]>
  addToHistory(task: DownloadTask): Promise<void>
}
```

Memory cache (`Map<string, DownloadTask>`) mirrors session storage for fast access. Hydrated on SW startup from `chrome.storage.session`.

### 3.4 Download Manager (`lib/download-manager.ts`)

**Strategy Pattern:**

```typescript
interface DownloadStrategy {
  name: string
  canHandle(request: DownloadRequest): boolean
  execute(request: DownloadRequest): Promise<DownloadResult>
  cancel(taskId: string): Promise<void>
}

class DownloadManager {
  registerStrategy(s: DownloadStrategy): void
  create(request: DownloadRequest): Promise<string>   // returns GID
  pause(gid: string): Promise<void>
  resume(gid: string): Promise<void>
  cancel(gid: string): Promise<void>
  getTask(gid: string): DownloadTask | undefined
  queryTasks(filter: TaskQuery): DownloadTask[]
  onTaskChange(listener: (t: DownloadTask) => void): () => void
}
```

**Pending Correlation Map:**

```
pendingDownloadsByUrl: Map<string, DownloadTask[]>

create(task) → push onto pendingDownloadsByUrl[task.url]
onCreated(item) → lookup by item.url, match closest createdAt timestamp
match → bind browserDownloadId, re-encode GID, remove from map
```

This solves the problem where `downloads.onCreated` provides a `DownloadItem` with no GID or tabId — URL + timestamp proximity provides accurate correlation even with concurrent downloads to the same URL.

### 3.5 Tab + DNR Strategy (`lib/download-strategies/tab-dnr.ts`)

```
execute(request):
  1. Create DNR session rules:
     - Inject request headers (Cookie, Referer, User-Agent, etc.)
     - Inject Content-Disposition: attachment response header
  2. tab = await browser.tabs.create({ url, active: false })
  3. Wait for browser.downloads.onCreated (via pending correlation map)
  4. On match:
     - Bind browserDownloadId to task
     - Re-encode GID
     - Remove DNR rules
     - Close tab
  5. Timeout: 120s → auto-cancel + cleanup if no onCreated fires
```

### 3.6 RPC Dispatcher (`lib/rpc/dispatcher.ts`)

```typescript
type MethodHandler = (params: unknown[], ctx: HandlerContext) => Promise<unknown>

interface HandlerContext {
  downloadManager: DownloadManager
  storage: typeof LocalStore & typeof SessionStore
  settings: AppSettings
}

const methodRegistry: Map<string, MethodHandler> = new Map()

function registerMethod(name: string, handler: MethodHandler): void
async function dispatch(req: Aria2Request | Aria2Request[], ctx: HandlerContext): Promise<Aria2Response | Aria2Response[]>
```

Each method file exports a `register` function:

```typescript
// lib/rpc/methods/add-uri.ts
export function register(registry: Map<string, MethodHandler>): void {
  registry.set("aria2.addUri", async (params, ctx) => {
    const downloadReq = parseAddUri(params)
    const gid = await ctx.downloadManager.create(downloadReq)
    return gid
  })
}
```

### 3.7 Content Scripts

**MAIN world (`entrypoints/main.content.ts`):**

- Intercepts `window.fetch` via proxy — matches `localhost:6800` / `127.0.0.1:6800`
- Intercepts `window.WebSocket` via constructor proxy — same host matching
- Forwards raw JSON-RPC body to bridge via `CustomEvent("aria2-shim-request")`
- Contains **zero** aria2 parsing logic — purely transport interception
- Zero imports from `@/lib/` (keeps MAIN world bundle minimal)

**Bridge (`entrypoints/bridge.content.ts`):**

- Listens for `aria2-shim-request` CustomEvent
- `browser.runtime.sendMessage({ type: "aria2-rpc", payload })`
- Receives response, dispatches `aria2-shim-response` CustomEvent
- 30-second request timeout, requestId-based deduplication

### 3.8 AriaNg Integration

AriaNg is bundled as **unmodified static assets** under `entrypoints/ariang/`. Its `index.html` is pre-configured to connect to `http://localhost:6800/jsonrpc`.

**Content script injection:** Since content scripts don't run on `chrome-extension://` pages, the WXT build pipeline uses a Vite plugin with `transformIndexHtml` to auto-inject the interception script (a slim inline bundle containing fetch/WebSocket interception + bridge logic) into AriaNg's `index.html` `<head>` at build time.

**Launch:** Popup provides an "Open AriaNg" button that opens a new tab to the bundled AriaNg page.

### 3.9 Popup (`entrypoints/popup/`)

Lightweight React component with three sections:

1. **Status Indicator** — Green dot (interception active/working) or red dot (disabled/error)
2. **Controls** — Global interception toggle. Per-site enable/disable for the current tab's origin. "Open AriaNg" button.
3. **Quick Stats** — Active download count, completed today count, "AriaNg →" link

**Tech:** Preact (lightweight, fast popup open). No heavy UI framework needed.

### 3.10 Background Router (`entrypoints/background.ts`)

```typescript
export default defineBackground(() => {
  const ctx = await bootstrapContext()  // hydrate from storage, init managers

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case "aria2-rpc":
        handleRpcMessage(msg.payload, ctx).then(sendResponse)
        return true  // async response
      case "get-settings":
        sendResponse(ctx.settings)
        return false
      case "update-settings":
        updateSettings(msg.payload, ctx).then(() => sendResponse({ ok: true }))
        return true
      case "get-popup-state":
        sendResponse(buildPopupState(ctx))
        return false
    }
  })
})
```

---

## 4. RPC Method Coverage

### 4.1 Fully Implemented

| Method | Implementation |
|--------|---------------|
| `aria2.addUri` | Parse URIs + options, delegate to downloadManager |
| `aria2.pause` | Match by GID, call `browser.downloads.pause()` |
| `aria2.unpause` | Match by GID, call `browser.downloads.resume()` |
| `aria2.remove` | Match by GID, call `browser.downloads.cancel()` |
| `aria2.forceRemove` | Same as remove |
| `aria2.tellStatus` | Query from active tasks + history, fully normalized |
| `aria2.tellActive` | Query all `in_progress` tasks |
| `aria2.tellWaiting` | Query all `pending` tasks |
| `aria2.tellStopped` | Query all completed/error/cancelled tasks |
| `aria2.getVersion` | Return honest version + capabilities (no BitTorrent, no Metalink) |
| `aria2.getGlobalStat` | Aggregate from active + history |
| `aria2.getFiles` | Return file data from browser download item (filename, path, size) |
| `aria2.getUris` | Return task's original URL |
| `aria2.removeDownloadResult` | Remove completed task from history storage |
| `aria2.purgeDownloadResult` | Remove all completed tasks from history |
| `system.multicall` | Loop over sub-requests through existing methodRegistry |

### 4.2 Gracefully Degraded (Accept & Return OK)

| Method | Behavior |
|--------|----------|
| `aria2.changeOption` | Accept, return OK (no-op) |
| `aria2.changeGlobalOption` | Accept, return OK (no-op) |
| `aria2.getOption` | Return sensible defaults (single-thread, no limit-connection, etc.) |
| `aria2.getGlobalOption` | Return sensible defaults |

### 4.3 Gracefully Degraded (Return Descriptive Error)

| Method | Behavior |
|--------|----------|
| `aria2.addMetalink` | Error code `-32000` — "Metalink not supported by browser download" |
| `aria2.addTorrent` | Error code `-32000` — "BitTorrent not supported by browser download" |

---

## 5. Download Lifecycle

```
1. downloadManager.create(request)
   ├─ Generate GID: "48" + randomSalt(6) + "00000000" (placeholder browser ID)
   ├─ Persist task to session storage (status: pending)
   └─ strategy.execute(request)

2. [TabDnrStrategy].execute(request)
   ├─ Create DNR session rules (request headers + Content-Disposition)
   ├─ tab = await browser.tabs.create({ url, active: false })
   ├─ Register in pendingDownloadsByUrl[request.url]
   └─ Wait for onCreated event...

3. browser.downloads.onCreated(item)
   ├─ Lookup pendingDownloadsByUrl[item.url]
   ├─ Match by closest createdAt timestamp
   ├─ task.browserDownloadId = item.id
   ├─ Re-encode GID: "48" + salt + padBrowserId(item.id, 8)
   ├─ Update session storage (status: in_progress)
   ├─ Remove from pendingDownloadsByUrl
   ├─ Remove DNR rules
   └─ Close tab

4. browser.downloads.onChanged(delta)
   ├─ Update task.bytesReceived / totalBytes / status
   ├─ Persist to session storage
   └─ On terminal status: move task from session → local history

5. Timeout (120s)
   └─ If task still pending after 120s: auto-cancel + cleanup (DNR + tab)
```

---

## 6. Error Handling

| Layer | Strategy |
|-------|----------|
| RPC parsing | Invalid JSON-RPC → error `-32700`. Batch: per-item errors, no discard |
| Method routing | Unknown method → `-32601`. Valid method, bad params → `-32602` |
| Download execution | DNR failure → task `error` with message. Tab failure → same |
| SW cold start | `bootstrapContext()` hydrates all active tasks before message loop. GID self-contains browserDownloadId for stateless pause/resume/cancel |
| Timeout | Pending downloads without `onCreated` within 120s → auto-cancel + cleanup |

---

## 7. Testing Strategy

### 7.1 Unit Tests (Vitest)

```
lib/rpc/methods/*.test.ts       # One test file per method
lib/rpc/dispatcher.test.ts
lib/rpc/response-factory.test.ts
lib/download-manager.test.ts
lib/storage.test.ts
lib/gid.test.ts                 # Encode/decode round-trip
lib/per-site-config.test.ts
```

- Run offline using mock `chrome.*` / `browser.*` APIs
- Coverage target: 80%+ lines, 90%+ branches on core modules
- Key cases: GID round-trip, system.multicall batch, download state transitions, pending correlation map accuracy

### 7.2 E2E Tests (Playwright)

```
e2e/specs/interception.spec.ts   # fetch + WebSocket interception
e2e/specs/ariang-ui.spec.ts      # AriaNg loads, connects, displays downloads
e2e/specs/download-flow.spec.ts  # End-to-end download trigger + tracking
e2e/specs/popup.spec.ts          # Popup UI: toggles, status indicator
```

- Run against Chromium with extension loaded unpacked
- Key flows: addUri → download started → tellStatus reflects progress → pause/resume → complete
- AriaNg page: load → connect → show active downloads → interact with UI

---

## 8. Dependencies

| Package | Purpose |
|---------|---------|
| `wxt` | Extension framework, build tooling |
| `typescript` | Type safety |
| `react` / `@preact/compat` | Popup UI (Preact preferred for size) |
| `vitest` | Unit testing |
| `playwright` | E2E testing |
| `@anthropic-ai/sdk` | (None — no AI dependency in production) |

No runtime dependencies beyond what WXT and the browser provide.

---

## 9. Build Pipeline Notes

- WXT build with Vite
- `transformIndexHtml` Vite plugin injects interception `<script>` into `entrypoints/ariang/index.html`
- AriaNg static assets copied as-is, no modification
- Manifest permissions: `downloads`, `declarativeNetRequest`, `tabs`, `storage`. Host permissions: `http://localhost:6800/*`, `<all_urls>`

---

## 10. Open Questions / Future Work

- **Alternative download strategies:** The strategy pattern allows future `fetch+blob` or `downloads.download` strategies to be added without refactoring
- **Multi-thread simulation:** Could split large files into byte ranges and merge, but browser downloads API limitations make this impractical — explicitly not supported
- **Firefox compatibility:** WXT supports Firefox. Tab + DNR approach needs testing on Firefox's different DNR implementation
