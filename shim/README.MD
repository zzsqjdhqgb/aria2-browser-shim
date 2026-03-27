# aria2 RPC Compatibility Matrix

This document is the strict compatibility ledger for the shim RPC surface.

Status definitions:
- FULL: behavior is aligned with aria2 for this shim's supported transport and runtime model.
- PARTIAL: method is callable and mostly compatible, but has intentional differences.
- UNSUPPORTED: method always returns an explicit RPC error with rationale.

Reviewed on: 2026-03-27

## Protocol Scope

- Transport: JSON-RPC style request/response implemented by extension background code.
- Not implemented: XML-RPC endpoint and WebSocket notification push channel.
- Secret token handling: token:... as first param is stripped (including nested multicall params), matching aria2 token convention.

## Method-by-Method Compatibility

| Method | Status | Notes |
| --- | --- | --- |
| aria2.addUri | PARTIAL | Only HTTP/HTTPS URIs are accepted. Only the first URI in uris is used. position is accepted but not used for real queue insertion. |
| aria2.addTorrent | UNSUPPORTED | Browser extension runtime cannot implement BitTorrent P2P stack. |
| aria2.addMetalink | UNSUPPORTED | Browser downloads API cannot execute Metalink multi-source semantics. |
| aria2.remove | FULL | Returns gid and maps removed state through shim status model. |
| aria2.forceRemove | FULL | Same behavior as aria2.remove in shim model. |
| aria2.pause | FULL | Supports active and pending tasks. |
| aria2.pauseAll | FULL | Applies pause across active/waiting set in shim queue model. |
| aria2.forcePause | FULL | Same behavior as aria2.pause in shim model. |
| aria2.forcePauseAll | FULL | Same behavior as aria2.pauseAll in shim model. |
| aria2.unpause | FULL | Resumes paused tasks back to waiting/active flow. |
| aria2.unpauseAll | FULL | Resumes all paused tasks. |
| aria2.tellStatus | PARTIAL | downloadSpeed and bitfield are derived from browser-visible state, not native aria2 internals. BitTorrent-only fields are not provided. |
| aria2.getUris | FULL | Returns single-source URI list for shim tasks. |
| aria2.getFiles | PARTIAL | Shim exposes one logical file per task; path is shim-constructed and not guaranteed to be absolute OS path. |
| aria2.getPeers | UNSUPPORTED | BitTorrent-only API; shim has no peer graph. |
| aria2.getServers | PARTIAL | Single-server synthetic view from browser download metadata; no full mirror rotation model. |
| aria2.tellActive | PARTIAL | Built from tellStatus derivation; same approximation limits as tellStatus. |
| aria2.tellWaiting | FULL | offset/num semantics (including negative offset reverse order) aligned. |
| aria2.tellStopped | FULL | offset/num semantics aligned; ordered by oldest stopped first for positive offsets. |
| aria2.changePosition | PARTIAL | Accepted and returns integer position, but shim has no native scheduler queue reordering backend. |
| aria2.changeUri | UNSUPPORTED | Browser downloads API cannot mutate URI mirror lists on existing tasks. |
| aria2.getOption | PARTIAL | Returns supported subset and shim template defaults; not all aria2 options are meaningful in browser runtime. |
| aria2.changeOption | PARTIAL | Validates and accepts option object, but most runtime mutations are not operable in browser download engine. |
| aria2.getGlobalOption | PARTIAL | Exposes in-memory global option template used by shim; not full aria2 daemon config surface. |
| aria2.changeGlobalOption | PARTIAL | Updates in-memory option template only; does not retroactively enforce all daemon-level behaviors. |
| aria2.getGlobalStat | PARTIAL | uploadSpeed is always 0 in non-BitTorrent shim; speeds are derived from observed task deltas. |
| aria2.purgeDownloadResult | FULL | Purges terminal results in shim store. |
| aria2.removeDownloadResult | FULL | Removes a specific terminal result by gid. |
| aria2.getVersion | PARTIAL | Reports shim version/features, not full native aria2 feature matrix. |
| aria2.getSessionInfo | FULL | Returns stable sessionId for service-worker lifetime. |
| aria2.shutdown | PARTIAL | Accepted as no-op; extension cannot terminate itself like daemon process shutdown. |
| aria2.forceShutdown | PARTIAL | Accepted as no-op for same runtime limitation. |
| aria2.saveSession | PARTIAL | Accepted as no-op; extension cannot write aria2 session file to arbitrary host filesystem path. |
| system.multicall | FULL | Executes nested calls and wraps successful results as one-item arrays. |
| system.listMethods | FULL | Lists all methods exposed by shim router, including explicit unsupported methods. |
| system.listNotifications | PARTIAL | Returns standard aria2 notification names, but shim does not emit push notifications over WebSocket. |

## This Revision: Fixed to Improve Alignment

- tellStatus/tellActive/tellWaiting/tellStopped now validate keys as string[] and return Invalid params for invalid shapes.
- tellWaiting/tellStopped negative offset behavior now matches aria2 reversed ordering rules.
- aria2.changeUri is now explicitly exposed and returns a documented unsupported error (instead of method-not-found).
- getOption header now uses array form instead of JSON-stringified list.
- changeGlobalOption/getGlobalOption now keep an in-memory mutable global option template.
- getGlobalStat now caps numStopped by max-download-result semantics and keeps numStoppedTotal uncapped.
- sessionId format updated to 40 hex chars (aria2-like shape).
- Pending-task pause/unpause/remove behavior was hardened to avoid false internal errors before browserDownloadId assignment.
- tellStatus now exposes pieceLength/numPieces/bitfield with shim-derived values for closer structural compatibility.
- getFiles completedLength now follows completed-piece accounting semantics.
