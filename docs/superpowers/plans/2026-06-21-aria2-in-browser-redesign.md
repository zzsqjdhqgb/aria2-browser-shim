# aria2-in-browser Complete Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete rewrite of the aria2-in-browser browser extension that emulates aria2 JSON-RPC in the browser, redirecting downloads to the browser's native download manager with a bundled AriaNg Web UI.

**Architecture:** WXT extension with message-oriented pattern — MAIN world content script intercepts fetch/WebSocket, ISOLATED world bridge relays via `runtime.sendMessage`, Background SW dispatches RPC through a method registry to a strategy-pattern download manager. State persists via `chrome.storage.session` (hot) and `chrome.storage.local` (history/settings). GIDs encode `browserDownloadId` inline for stateless pause/resume/cancel.

**Tech Stack:** WXT 0.20+, TypeScript 5.9+, Preact (popup), Vitest, Playwright

## Dependency Graph
```
Task 1 (gid.ts)
Task 2 (logging.ts)
Task 3 (core types)
Task 4 (storage.ts)
Task 5 (per-site-config.ts)
Task 6 (download-strategies/tab-dnr.ts)
Task 7 (download-manager.ts) ← depends on 1,3,4,6
Task 8 (rpc/types.ts + response-factory.ts)
Task 9 (rpc/dispatcher.ts) ← depends on 8
Task 10 (rpc/methods/) ← depends on 7,8,9
Task 11 (message-router.ts)
Task 12 (background.ts) ← depends on 7,9,10,11
Task 13 (bridge.content.ts) ← independent
Task 14 (main.content.ts) ← independent
Task 15 (popup) ← independent
Task 16 (ariang integration) ← independent
Task 17 (E2E tests) ← depends on all
```

## Global Constraints
- Framework: WXT (Manifest V3). No code reuse from existing PoC.
- GID prefix: "48". No Node module imports in MAIN world content scripts.
- Download mechanism: tabs.create() + DNR, strategy pattern extensible.
- Transport: HTTP JSON-RPC + WebSocket.
- Testing: Vitest unit + Playwright E2E, target 80%+ coverage.
- Preact via `@preact/compat` for popup UI.
---

### Task 1: GID Encoding/Decoding (`lib/gid.ts`)

**Files:** Create `lib/gid.ts`, `lib/gid.test.ts`

**Produces:** `encodeGid(prefix: string, salt: string, browserId: number): string`, `decodeGid(gid: string): { prefix: string; salt: string; browserId: number } | null`, `generateSalt(): string`, `PLACEHOLDER_BROWSER_ID: number`, `EXTENSION_PREFIX: string`

- [ ] **Step 1: Write failing tests** — `lib/gid.test.ts`:
  - `encodeGid("48", "a1b2c3", 45)` → `"48a1b2c30000002d"` (length 16)
  - `encodeGid("48", "ffffff", 0)` → `"48ffffff00000000"` (zero-padded)
  - `encodeGid("48", "000000", 2147483647)` → `"480000007fffffff"` (large id)
  - `decodeGid("48a1b2c30000002d")` → `{ prefix: "48", salt: "a1b2c3", browserId: 45 }`
  - `decodeGid("48a1b2c30000002")` → null (15 chars, wrong length)
  - `decodeGid("48a1b2c30000002dd")` → null (17 chars)
  - `decodeGid("48a1b2c30000002g")` → null (non-hex)
  - Round-trip for `browserId: 1, 99999, 0` with random salts
  - `generateSalt()` returns 6-char hex, produces unique values across 100 calls
  - `PLACEHOLDER_BROWSER_ID` is 0

- [ ] **Step 2: Run** — `npx vitest run lib/gid.test.ts` → FAIL

- [ ] **Step 3: Implement** — `lib/gid.ts`:
  - Constants: `GID_LENGTH = 16`, `BROWSER_ID_LENGTH = 8`, `HEX_PATTERN = /^[0-9a-fA-F]+$/`
  - `PLACEHOLDER_BROWSER_ID = 0`, `EXTENSION_PREFIX = "48"`
  - `generateSalt()`: `crypto.getRandomValues(new Uint8Array(3))`, hex encode
  - `encodeGid(prefix, salt, browserId)`: `${prefix}${salt}${browserId.toString(16).padStart(BROWSER_ID_LENGTH, "0")}`.slice(0, 16)
  - `decodeGid(gid)`: validate length + hex, parse prefix(0-2), salt(2-8), browserId from last 8 hex chars

- [ ] **Step 4: Run tests** — All PASS

- [ ] **Step 5: Commit** — `git add lib/gid.ts lib/gid.test.ts && git commit -m "feat: add GID encoding/decoding with round-trip support"`

---

### Task 2: Logging Utility (`lib/logging.ts`)

**Files:** Create `lib/logging.ts`, `lib/logging.test.ts`

**Produces:** `interface Logger { debug, info, warn, error }`, `createLogger(prefix: string): Logger`

- [ ] **Step 1: Write tests** — Each log level calls the correct console method with prefix prepended + supports multiple arguments.

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — `createLogger(prefix)` returns object with `debug`, `info`, `warn`, `error` methods each delegating to `console.debug/log/warn/error(prefix, ...args)`.

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**

---

### Task 3: Core Types (`lib/types.ts`)

**Files:** Create `lib/types.ts` (no tests — pure type definitions)

**Produces:** `DownloadRequest`, `DownloadTask`, `DownloadStatus`, `TaskQuery`, `TaskChangeListener`, `DownloadStrategy`, `DownloadResult`, `AppSettings`, `DEFAULT_SETTINGS`

- [ ] **Step 1: Write types:**
  - `DownloadRequest`: `url: string`, `filename?: string`, `directory?: string`, `headers?: Record<string, string>`
  - `DownloadStatus`: `"pending" | "in_progress" | "paused" | "complete" | "error" | "cancelled"`
  - `DownloadTask`: `gid: string`, `browserDownloadId?: number`, `request: DownloadRequest`, `status: DownloadStatus`, `bytesReceived: number`, `totalBytes: number`, `error?: string`, `createdAt: number`, `completedAt?: number`
  - `TaskQuery`: `status?: DownloadStatus | DownloadStatus[]`, `limit?: number`, `offset?: number`
  - `TaskChangeListener`: `(task: DownloadTask) => void`
  - `DownloadStrategy`: `name: string`, `canHandle(req: DownloadRequest): boolean`, `execute(req: DownloadRequest, task: DownloadTask): Promise<DownloadResult>`, `cancel(task: DownloadTask): Promise<void>`
  - `DownloadResult`: `success: boolean`, `error?: string`
  - `AppSettings`: `interceptionEnabled: boolean`, `perSiteOverrides: Record<string, boolean>`, `pendingTimeoutMs: number`
  - `DEFAULT_SETTINGS`: `{ interceptionEnabled: true, perSiteOverrides: {}, pendingTimeoutMs: 120_000 }`

- [ ] **Step 2: Commit** — `git add lib/types.ts && git commit -m "feat: define core types for download, task, strategy, and settings"`

---

### Task 4: Storage Layer (`lib/storage.ts`)

**Files:** Create `lib/storage.ts`, `lib/storage.test.ts`

**Consumes:** `DownloadTask`, `AppSettings`, `DEFAULT_SETTINGS` from `lib/types.ts`

**Produces:** `SessionStore` namespace (`putTask`, `getTask`, `getAllTasks`, `removeTask`), `LocalStore` namespace (`getPerSiteEnabled`, `setPerSiteEnabled`, `getSettings`, `putSettings`, `getDownloadHistory`, `addToHistory`)

- [ ] **Step 1: Write tests** — Mock `browser.storage.session` / `browser.storage.local` as in-memory Maps. Test each CRUD method including edge cases: getTask returns null for unknown GID, getAllTasks sorted by createdAt desc, getSettings returns defaults when nothing stored, addToHistory caps at 500, getDownloadHistory respects limit.

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — `SessionStore` reads/writes `"aria2_active_tasks"` array via `browser.storage.session`. `LocalStore` reads/writes `"aria2_settings"` and `"aria2_download_history"` via `browser.storage.local`. Key detail: `LocalStore.getPerSiteEnabled(origin)` reads settings and returns `perSiteOverrides[origin] ?? true` (default-enabled).

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**

---

### Task 5: Per-Site Config (`lib/per-site-config.ts`)

**Files:** Create `lib/per-site-config.ts`, `lib/per-site-config.test.ts`

**Consumes:** `LocalStore` from `lib/storage.ts`

**Produces:** `isInterceptionEnabled(url: string): Promise<boolean>`, `setInterceptionEnabled(url: string, enabled: boolean): Promise<void>`, `isGloballyEnabled(): Promise<boolean>`

- [ ] **Step 1: Write tests** — Mock `LocalStore`. Test: returns true when global enabled + no override; false when global disabled; false when site disabled; true when global disabled but site explicitly enabled.

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — `isInterceptionEnabled(url)` extracts origin, reads both global and per-site settings. Logic: if globalEnabled → return perSite value; else → return true only if `perSite === true` (explicit opt-in at site level).

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**
---

### Task 6: Tab + DNR Download Strategy (`lib/download-strategies/tab-dnr.ts`)

**Files:** Create `lib/download-strategies/tab-dnr.ts`, `lib/download-strategies/tab-dnr.test.ts`

**Consumes:** Types from `lib/types.ts`, `Logger` from `lib/logging.ts`

**Produces:** `TabDnrStrategy` class implementing `DownloadStrategy`

- [ ] **Step 1: Write tests** — Mock `browser.tabs.create/remove`, `browser.declarativeNetRequest.updateSessionRules`. Test that `canHandle` returns true for http/https, false for ftp/magnet. `execute` creates DNR rules with proper `Content-Disposition: attachment` header + request headers, opens background tab, returns `{ success: true }`. Handle DNR/tab failures gracefully returning `{ success: false, error }`. Test `cancel` removes DNR rules.

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — `TabDnrStrategy` with `name = "tab-dnr"`, rule counter, `ruleIdMap: Map<string, number>`.
  - `canHandle`: parse URL, protocol must be `"http:"` or `"https:"`
  - `execute`: build DNR rules (request headers from `request.headers`, response `Content-Disposition` with sanitized filename from `buildFilename()`), open `tabs.create({ url, active: false })`, return `{ success: true }`
  - `cancel`: remove DNR rule by ruleId from map
  - `cleanupOnMatched`: alias for cancel (called by DownloadManager after onCreated fires)
  - `buildFilename(dir?, filename?)`: join sanitized parts (strip leading slashes, replace `..` with `_`), use basename for Content-Disposition filename param

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**

---

### Task 7: Download Manager (`lib/download-manager.ts`)

**Files:** Create `lib/download-manager.ts`, `lib/download-manager.test.ts`

**Consumes:** Types from Task 3; GID fns from Task 1; Storage from Task 4; `TabDnrStrategy` from Task 6

**Produces:** `DownloadManager` class: strategies, create/pause/resume/cancel, getTask/queryTasks, onTaskChange, hydrate

- [ ] **Step 1: Write tests** — Mock all browser APIs. Test scenarios:
  - `create` → returns 16-char GID with "48" prefix, status=pending, persists via SessionStore
  - `pause(gid)` → throws for unknown, calls `browser.downloads.pause(browserDownloadId)` otherwise
  - `resume(gid)` / `cancel(gid)` → similar pattern, cancel marks status=cancelled
  - `queryTasks(filter)` → status filter, limit/offset, sorted by createdAt desc
  - `onTaskChange(fn)` → returns unsubscribe, listener called with task shallow copy
  - `registerStrategy(s)` → strategies are stored, selected by `canHandle`
  - Pending correlation: `handleDownloadCreated` matches by URL + closest timestamp, re-encodes GID with real browserId, removes from pending map
  - Timeout: pending task auto-cancels after 120s
  - `hydrate()` restores from mocked SessionStore

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — `DownloadManager` class (~220 lines):
  - Memory cache: `Map<string, DownloadTask>` stores all active tasks
  - `pendingByUrl: Map<string, DownloadTask[]>` for onCreated correlation
  - `pendingTimeouts: Map<string, ReturnType<typeof setTimeout>>` for 120s auto-cancel
  - Constructor registers `TabDnrStrategy` as default, sets up `browser.downloads.onCreated` and `onChanged` listeners
  - `registerStrategy(s)`: adds to front of array (respects registration order for priority)
  - `create(request)`: generate GID via `encodeGid(EXTENSION_PREFIX, generateSalt(), PLACEHOLDER_BROWSER_ID)`, create task, push into `pendingByUrl[request.url]`, set 120s timeout, find capable strategy, call `strategy.execute(request, task)`. On strategy failure: mark error.
  - `handleDownloadCreated(item)`: lookup `pendingByUrl[item.finalUrl ?? item.url]`, match by smallest `Math.abs(task.createdAt - Date.now())`, bind `browserDownloadId`, re-encode GID, remove from pending map + clear timeout, emit + persist, call strategy `cleanupOnMatched`
  - `handleDownloadChanged(delta)`: find task where `task.browserDownloadId === delta.id`, update status/bytes/paused, on terminal status call `finalizeTask`
  - `finalizeTask(task)`: add to `LocalStore.addToHistory`, remove from `SessionStore`, delete from memory cache
  - `emit(task)`: notify all listeners with `{ ...task }` shallow copy

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**

---

### Task 8: RPC Types & Response Factory (`lib/rpc/types.ts`, `lib/rpc/response-factory.ts`)

**Files:** Create `lib/rpc/types.ts`, `lib/rpc/response-factory.ts`, `lib/rpc/response-factory.test.ts`

**Produces:** `Aria2RpcRequest`, `Aria2RpcResponse`, `Aria2RpcError`, `HandlerContext`, `MethodHandler`, `ErrorCode` constants. Response factory: `successResponse`, `errorResponse`, `notImplementedResponse`, `internalErrorResponse`, `notSupportedResponse`.

- [ ] **Step 1: Write tests** — Test each factory function: `successResponse("1", result)` → `{ jsonrpc: "2.0", id: "1", result }`, `errorResponse("1", -32602, "msg")` → same with error obj, `notImplementedResponse` uses METHOD_NOT_FOUND, `notSupportedResponse("BitTorrent")` uses SERVER_ERROR with descriptive message, `internalErrorResponse(new Error("x"))` uses INTERNAL_ERROR extracting message.

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — Pure factory functions. `HandlerContext` contains `downloadManager: DownloadManager`, `settings: AppSettings`, `store: { session: typeof SessionStore, local: typeof LocalStore }`. Error codes follow JSON-RPC standard.

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**

---

### Task 9: RPC Dispatcher (`lib/rpc/dispatcher.ts`)

**Files:** Create `lib/rpc/dispatcher.ts`, `lib/rpc/dispatcher.test.ts`

**Consumes:** Types and response factory from Task 8

**Produces:** `MethodRegistry` class: `register(method: string, handler: MethodHandler): void`, `dispatch(req: Aria2RpcRequest | Aria2RpcRequest[], ctx: HandlerContext): Promise<Aria2RpcResponse | Aria2RpcResponse[]>`

- [ ] **Step 1: Write tests:**
  - Single dispatch → registered handler called, result wrapped in success response
  - Unknown method → METHOD_NOT_FOUND
  - Invalid jsonrpc version → INVALID_REQUEST
  - Batch request → returns array of responses
  - Batch isolates errors: one bad method doesn't affect others
  - Null id (notification) → handled correctly
  - Handler throws → INTERNAL_ERROR

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** — `MethodRegistry` with internal `Map<string, MethodHandler>`.
  - `register(method, handler)`: set in map
  - `dispatch(req, ctx)`: if Array → `Promise.all(req.map(r => this.dispatchSingle(r, ctx)))`. If single → validate `jsonrpc === "2.0"`, lookup handler in map, call `handler(req.params ?? [], ctx)`, wrap result in `successResponse`. Catch errors → `internalErrorResponse`.
  - Unknown method → `errorResponse(id, METHOD_NOT_FOUND, message)`. Invalid version → `errorResponse(id, INVALID_REQUEST, message)`.

- [ ] **Step 4: Run tests** → All PASS

- [ ] **Step 5: Commit**


---

### Task 10: All RPC Method Handlers (`lib/rpc/methods/`)

**Files:** Create one file per method in `lib/rpc/methods/`, plus `lib/rpc/methods/register-all.ts`, plus tests. Each exports `register(registry: MethodRegistry): void`.

**Consumes:** `MethodRegistry` from Task 9, `DownloadManager` from Task 7, response factory from Task 8

**Produces:** ~20 registered method handlers

**Method list with implementation details:**

| Method | File | Behavior |
|--------|------|----------|
| `aria2.addUri` | `add-uri.ts` | Parse `params[0]` as `string[]` (URIs), `params[1]` as `{ dir?, out?, header? }`. Split "Key: Value" headers on first ":". Strip `token:` from params. Call `downloadManager.create()`. Return GID. |
| `aria2.getVersion` | `get-version.ts` | Return `{ version: "1.37.0-shim", enabledFeatures: ["Firefox3Cookie", "GZip", "HTTPS", "Message Digest"] }` -- no BitTorrent/Metalink |
| `aria2.tellStatus` | `tell-status.ts` | Get task by GID. Map: `in_progress -> "active"`, `paused -> "paused"`, `pending -> "waiting"`, `complete -> "complete"`, `error -> "error"`, `cancelled -> "removed"`. Return full status with `completedLength`, `totalLength`, `downloadSpeed`, `files`. |
| `aria2.tellActive` | `tell-active.ts` | `queryTasks({status:"in_progress"})`, map each. Support offset/num from params. |
| `aria2.tellWaiting` | `tell-waiting.ts` | `queryTasks({status:"pending"})`, map each. |
| `aria2.tellStopped` | `tell-stopped.ts` | `queryTasks({status:["complete","error","cancelled"]})`, map each. |
| `aria2.getGlobalStat` | `get-global-stat.ts` | Aggregate: numActive, numWaiting, numStopped, downloadSpeed (sum), uploadSpeed: 0. |
| `aria2.getFiles` | `get-files.ts` | Return single-file array from task data: filename, path, length, completedLength, uris. |
| `aria2.getUris` | `get-uris.ts` | Return `[{ uri, status: "used" }]`. |
| `aria2.pause` | `pause.ts` | `downloadManager.pause(gid)`, return GID. |
| `aria2.unpause` | `unpause.ts` | `downloadManager.resume(gid)`, return GID. |
| `aria2.remove` | `remove.ts` | `downloadManager.cancel(gid)`, return GID. |
| `aria2.forceRemove` | `force-remove.ts` | Same as remove. |
| `aria2.removeDownloadResult` | `remove-download-result.ts` | Remove from local history. |
| `aria2.purgeDownloadResult` | `purge-download-result.ts` | Purge all completed from local history. |
| `aria2.changeOption` | `change-option.ts` | Accept, return "OK" (no-op). |
| `aria2.changeGlobalOption` | `change-global-option.ts` | Accept, return "OK" (no-op). |
| `aria2.getOption` | `get-option.ts` | Return sensible defaults (single-thread, no split). |
| `aria2.getGlobalOption` | `get-global-option.ts` | Same as getOption. |
| `aria2.addMetalink` | `add-metalink.ts` | Return `notSupportedResponse(id, "Metalink")`. |
| `aria2.addTorrent` | `add-torrent.ts` | Return `notSupportedResponse(id, "BitTorrent")`. |
| `system.multicall` | `system-multicall.ts` | `params[0]` is `[{ methodName, params }]`. Lookup each handler, wrap result as `[result]` or error as `[{ code, message }]`. Return array of arrays. |

**register-all.ts:** Imports all register functions, calls each with the MethodRegistry instance.

- [ ] **Step 1: Implement each method TDD-style** -- Write test, see it fail, implement, see it pass, commit. Each method gets its own commit.
- [ ] **Step 2: Core methods first** -- add-uri, get-version, tell-status, tell-active, tell-waiting, tell-stopped, get-global-stat, pause, unpause, remove, system-multicall.
- [ ] **Step 3: Degraded/query methods next** -- get-files, get-uris, get-option/get-global-option, change-option/change-global-option, remove-download-result, purge-download-result.
- [ ] **Step 4: Error-returning methods** -- force-remove, add-metalink, add-torrent.
- [ ] **Step 5: Wire up register-all.ts** importing all registers, calling each.
- [ ] **Step 6: Commit** -- Multiple commits, one per method group.

---

### Task 11: Message Router (`lib/message-router.ts`)

**Files:** Create `lib/message-router.ts`

- [ ] **Step 1: Implement** -- `handleAria2RpcMessage(payload, ctx)` validates payload is object with `method` or is array, calls `registry.dispatch()`. On parse failure returns `{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }`. Also exports message type string constants: `MSG_ARIA2_RPC`, `MSG_GET_SETTINGS`, `MSG_UPDATE_SETTINGS`, `MSG_GET_POPUP_STATE`.
- [ ] **Step 2: Commit**

---

### Task 12: Background Service Worker (`entrypoints/background.ts`)

**Files:** Create `entrypoints/background.ts`

- [ ] **Step 1: Implement** -- Uses WXT `defineBackground(async () => { ... })`.
  - Bootstraps context: `new DownloadManager()`, `await dm.hydrate()`, `await LocalStore.getSettings()`, `new MethodRegistry()`, `registerAllMethods(registry)`
  - Message listener switches on `message.type`:
    - `"aria2-rpc"` -> `handleAria2RpcMessage(payload, ctx).then(sendResponse)` with `return true` (async)
    - `"get-settings"` -> `sendResponse(ctx.settings)`
    - `"update-settings"` -> merge payload into settings, persist via `LocalStore.putSettings`, respond `{ ok: true }`
    - `"get-popup-state"` -> respond with `{ activeCount, waitingCount, interceptionEnabled }`
  - Structured logging at startup and on each message
- [ ] **Step 2: Commit**

---

### Task 13: Bridge Content Script (`entrypoints/bridge.content.ts`)

**Files:** Create (replace) `entrypoints/bridge.content.ts`

- [ ] **Step 1: Implement** -- ISOLATED world content script:
  - Matches `<all_urls>`, runs at `document_start`
  - Listens for `"aria2-shim-request"` CustomEvent, extracts `{ _requestId, body }`
  - Calls `browser.runtime.sendMessage({ type: "aria2-rpc", payload: body })`
  - Dispatches `"aria2-shim-response"` CustomEvent with `{ _requestId, data: response }`
  - Error path: if sendMessage throws, dispatch error response with code -32603
- [ ] **Step 2: Commit**

---

### Task 14: MAIN World Content Script (`entrypoints/main.content.ts`)

**Files:** Create (replace) `entrypoints/main.content.ts`

- [ ] **Step 1: Implement** -- MAIN world script with ZERO module imports:
  - `isAria2Url(url)`: checks for `localhost:6800` or `127.0.0.1:6800`
  - `sendToBridge(body)`: CustomEvent request/response with 30s timeout and requestId correlation
  - `buildFakeResponse(body, result)`: JSON `new Response(...)` wrapper
  - **Fetch interception:** Save `window.fetch`, replace with wrapper that checks URL against `isAria2Url`, forwards via `sendToBridge`, returns `buildFakeResponse`. Non-aria2 URLs -> original fetch.
  - **WebSocket interception:** `FakeWebSocket` class extending `EventTarget`, models request-response. Proxy `window.WebSocket` constructor to return `FakeWebSocket` for aria2 URLs, real WebSocket otherwise.
- [ ] **Step 2: Commit**

---

### Task 15: Popup UI (`entrypoints/popup/`)

**Files:** Create `entrypoints/popup/index.html`, `entrypoints/popup/main.tsx`, `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`

**Consumes:** Background message types from Task 11

**Produces:** Compact popup window with Preact components

- [ ] **Step 1: Create popup with Preact:**
  - **StatusIndicator:** Green dot (interception active, CSS pulse animation) or red dot (disabled/error). Shows toast messages from recent actions (auto-fade after 2s)
  - **ControlsSection:** Global toggle switch (calls `update-settings`), per-site toggle (reads current tab origin via `browser.tabs.query`, calls `update-settings` with per-site override), displays current origin hostname. When no current origin, shows "No active page"
  - **StatsSection:** Active download count and pending count from `get-popup-state`
  - **AriaNg Button:** Opens `browser.runtime.getURL("/ariang/index.html")` in new tab via `browser.tabs.create`
  - Error boundary: catches render errors, shows fallback with error message
- [ ] **Step 2: Style** -- Compact layout (~300px wide), dark/light theme via `prefers-color-scheme`, clean toggle switch CSS
- [ ] **Step 3: Configure WXT popup entry** -- Add popup to wxt.config.ts entrypoints
- [ ] **Step 4: Commit**

---

### Task 16: AriaNg Integration (`entrypoints/ariang/`)

**Files:** Copy AriaNg release into `entrypoints/ariang/`. Create `lib/injected-interceptor.ts`. Update `wxt.config.ts`.

- [ ] **Step 1: Download AriaNg** -- Get latest AriaNg AllInOne release (single HTML + assets). Extract to `entrypoints/ariang/`. Pre-configure to connect to `http://localhost:6800/jsonrpc`.
- [ ] **Step 2: Create `lib/injected-interceptor.ts`** -- Self-contained script (no module imports, pure browser APIs): contains `isAria2Url`, `sendToBridge` (via CustomEvent to ISOLATED world bridge), fetch interceptor, FakeWebSocket. WXT handles bundling this into the AriaNg page at build time.
- [ ] **Step 3: Update `wxt.config.ts`** -- Add Vite plugin with `transformIndexHtml`:
  - In dev: inject `<script type="module" src="/lib/injected-interceptor.ts"></script>` before `</head>` in AriaNg's HTML
  - In build: read `lib/injected-interceptor.ts`, inject as inline `<script>...</script>` before `</head>`
  - Detection: check if HTML contains "AriaNg" marker to avoid injecting into other pages
- [ ] **Step 4: Manifest updates** -- Add `web_accessible_resources` for AriaNg assets. Update permissions if needed.
- [ ] **Step 5: Commit**

---

### Task 17: E2E Tests (`e2e/`)

**Files:** Create `e2e/fixtures/extension.ts`, `e2e/specs/interception.spec.ts`, `e2e/specs/ariang-ui.spec.ts`, `e2e/specs/download-flow.spec.ts`, `e2e/specs/popup.spec.ts`

- [ ] **Step 1: Create Playwright fixture** -- `e2e/fixtures/extension.ts`: Extend `test` with `extensionId` fixture using `persistentContext` loading extension from WXT build output.
- [ ] **Step 2: Write interception tests** (`interception.spec.ts`) -- Inject fetch/WS callers into a test page, verify responses contain valid JSON-RPC.
- [ ] **Step 3: Write AriaNg tests** (`ariang-ui.spec.ts`) -- Load AriaNg page, verify connection, trigger addUri, verify UI shows download entry.
- [ ] **Step 4: Write download flow tests** (`download-flow.spec.ts`) -- Full lifecycle: addUri -> tellStatus (active) -> pause -> tellStatus (paused) -> unpause -> remove. Use `browser.downloads` events for verification.
- [ ] **Step 5: Write popup tests** (`popup.spec.ts`) -- Open popup, verify status indicator visible, toggle global switch, click AriaNg button opens new tab.
- [ ] **Step 6: Add E2E scripts to package.json** -- `"test:e2e": "playwright test"`, `"pretest:e2e": "wxt build"`
- [ ] **Step 7: Run E2E suite** -- `npm run pretest:e2e && npm run test:e2e`
- [ ] **Step 8: Commit**

---

## Final Cleanup Checklist

- [ ] Remove all existing PoC source files after new files are in place
- [ ] Remove `@wxt-dev/module-react` from `package.json` dependencies; add `@preact/compat`
- [ ] Update `README.md` with new architecture and usage instructions
- [ ] Ensure `tsconfig.json` extends `.wxt/tsconfig.json`
- [ ] Run full test suite: `npx vitest run --coverage` (80%+), `npm run test:e2e`
- [ ] Final build verification: `npm run build` succeeds
- [ ] Final commit with updated README
