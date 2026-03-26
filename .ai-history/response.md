

Looking at the codebase, I need to completely rewrite the `shim/aria2-interceptor.ts` module, splitting it into a well-organized multi-file structure that properly implements all the interfaces from the three tables.

Let me analyze what's needed:

1. **Table 1 (Fully Implementable):** `addUri`, `remove`, `forceRemove`, `pause`, `unpause`, `tellWaiting`, `tellStopped`, `getUris`, `getVersion`, `getSessionInfo`, `purgeDownloadResult`, `system.multicall`, `system.listMethods`

2. **Table 2 (Partially Implementable):** `tellStatus`, `getFiles`, `getServers`, `changeOption`, `getOption`, `changePosition`

3. **Table 3 (Unimplementable):** `addTorrent`, `addMetalink`, `getPeers`, `saveSession`, `shutdown`, `forceShutdown` - these return appropriate errors or no-ops

Here's the complete rewrite:

## File: shim/types.ts
```typescript
/**
 * Aria2 JSON-RPC protocol types
 */

export interface Aria2RpcRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: string;
    params?: unknown[];
}

export interface Aria2RpcResponse {
    jsonrpc: "2.0";
    id: string | number;
    result?: unknown;
    error?: Aria2RpcError;
}

export interface Aria2RpcError {
    code: number;
    message: string;
}

/**
 * Aria2-style status strings (different from our internal DownloadStatus)
 */
export type Aria2Status = "active" | "waiting" | "paused" | "error" | "complete" | "removed";

/**
 * Aria2 tellStatus response shape
 * @see https://aria2.github.io/manual/en/html/aria2c.html#aria2.tellStatus
 */
export interface Aria2TellStatusResult {
    gid: string;
    status: Aria2Status;
    totalLength: string;
    completedLength: string;
    uploadLength: string;
    bitfield?: string;
    downloadSpeed: string;
    uploadSpeed: string;
    infoHash?: string;
    numSeeders?: string;
    seeder?: string;
    pieceLength?: string;
    numPieces?: string;
    connections: string;
    errorCode?: string;
    errorMessage?: string;
    followedBy?: string[];
    following?: string;
    belongsTo?: string;
    dir: string;
    files: Aria2FileResult[];
    bittorrent?: unknown;
}

/**
 * Aria2 getFiles response shape
 */
export interface Aria2FileResult {
    index: string;
    path: string;
    length: string;
    completedLength: string;
    selected: string;
    uris: Aria2UriResult[];
}

/**
 * Aria2 getUris / file uri entry
 */
export interface Aria2UriResult {
    uri: string;
    status: "used" | "waiting";
}

/**
 * Aria2 getServers response shape
 */
export interface Aria2ServerResult {
    index: string;
    servers: Array<{
        uri: string;
        currentUri: string;
        downloadSpeed: string;
    }>;
}

/**
 * Aria2 getVersion response
 */
export interface Aria2VersionResult {
    version: string;
    enabledFeatures: string[];
}

/**
 * Aria2 getSessionInfo response
 */
export interface Aria2SessionInfoResult {
    sessionId: string;
}

/**
 * Aria2 global stat
 */
export interface Aria2GlobalStatResult {
    downloadSpeed: string;
    uploadSpeed: string;
    numActive: string;
    numWaiting: string;
    numStopped: string;
    numStoppedTotal: string;
}

/**
 * Keys that can be requested in tellStatus
 */
export const TELL_STATUS_ALL_KEYS: readonly string[] = [
    "gid", "status", "totalLength", "completedLength", "uploadLength",
    "bitfield", "downloadSpeed", "uploadSpeed", "infoHash", "numSeeders",
    "seeder", "pieceLength", "numPieces", "connections", "errorCode",
    "errorMessage", "followedBy", "following", "belongsTo", "dir",
    "files", "bittorrent",
] as const;
```

## File: shim/errors.ts
```typescript
import type { Aria2RpcError } from "./types";

/**
 * Predefined Aria2 RPC error codes
 * @see https://aria2.github.io/manual/en/html/aria2c.html#rpc-errors
 */

/** GID not found */
export function gidNotFound(gid: string): Aria2RpcError {
    return { code: 1, message: `GID ${gid} is not found` };
}

/** Cannot remove active download without force */
export function cannotRemoveActive(): Aria2RpcError {
    return { code: 1, message: "Cannot remove an active download. Use forceRemove." };
}

/** Invalid params */
export function invalidParams(detail?: string): Aria2RpcError {
    return { code: -32602, message: detail ? `Invalid params: ${detail}` : "Invalid params" };
}

/** Method not found */
export function methodNotFound(method: string): Aria2RpcError {
    return { code: -32601, message: `Method not found: ${method}` };
}

/** Internal error */
export function internalError(detail: string): Aria2RpcError {
    return { code: -32603, message: `Internal error: ${detail}` };
}

/** Unsupported feature */
export function unsupported(feature: string): Aria2RpcError {
    return { code: 1, message: `Not supported by aria2-browser-shim: ${feature}` };
}
```

## File: shim/status-map.ts
```typescript
import type { DownloadStatus } from "@/core/types";
import type { Aria2Status } from "./types";

/**
 * Maps internal DownloadStatus to Aria2 status string
 */
export function toAria2Status(status: DownloadStatus): Aria2Status {
    switch (status) {
        case "pending":
            return "waiting";
        case "in_progress":
            return "active";
        case "paused":
            return "paused";
        case "complete":
            return "complete";
        case "error":
            return "error";
        case "cancelled":
            return "removed";
        default:
            return "error";
    }
}

/**
 * Aria2 error codes mapped from our error strings
 * @see https://aria2.github.io/manual/en/html/aria2c.html#exit-status
 */
export function toAria2ErrorCode(error?: string): string {
    if (!error) return "0";

    const lower = error.toLowerCase();

    if (lower.includes("timeout")) return "7";       // timed out
    if (lower.includes("not found") || lower.includes("404")) return "3"; // resource not found
    if (lower.includes("unauthorized") || lower.includes("403")) return "6"; // authorization failed
    if (lower.includes("network") || lower.includes("dns")) return "19"; // DNS resolve failed / network
    if (lower.includes("interrupted")) return "1";   // unknown error / interrupted
    if (lower.includes("cancelled")) return "0";     // user cancelled (not an error per se)

    return "1"; // generic unknown error
}
```

## File: shim/param-utils.ts
```typescript
import type { DownloadRequest } from "@/core/types";

const LOG_PREFIX = "[ParamUtils]";

/**
 * Strip optional "token:xxx" prefix from params array.
 * Aria2 RPC calls optionally pass a secret token as the first parameter.
 */
export function stripToken(params: unknown[]): unknown[] {
    if (
        params.length > 0 &&
        typeof params[0] === "string" &&
        (params[0] as string).startsWith("token:")
    ) {
        return params.slice(1);
    }
    return params;
}

/**
 * Parse aria2.addUri parameters into a DownloadRequest.
 *
 * aria2.addUri([secret], uris, [options], [position])
 *   - uris:    string[]  — list of HTTP/HTTPS URIs (we only use the first)
 *   - options: object    — { dir, out, header, referer, ... }
 *   - position: number   — insertion position (ignored in shim)
 *
 * @returns DownloadRequest or null if params are invalid
 */
export function parseAddUriParams(params: unknown[]): DownloadRequest | null {
    const uris = params[0] as string[] | undefined;
    if (!Array.isArray(uris) || uris.length === 0) {
        console.warn(`${LOG_PREFIX} addUri: no URIs provided`);
        return null;
    }

    // Validate that the first URI is a valid HTTP(S) URL
    const primaryUri = uris[0];
    try {
        const parsed = new URL(primaryUri);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            console.warn(`${LOG_PREFIX} addUri: unsupported protocol ${parsed.protocol}`);
            return null;
        }
    } catch {
        console.warn(`${LOG_PREFIX} addUri: invalid URL "${primaryUri}"`);
        return null;
    }

    const options = (params[1] as Record<string, unknown>) ?? {};
    const headers: Record<string, string> = {};

    // aria2 sends headers as string array: ["Cookie: xxx", "Referer: yyy"]
    const headerList = options.header as string[] | undefined;
    if (Array.isArray(headerList)) {
        for (const h of headerList) {
            const colonIdx = h.indexOf(":");
            if (colonIdx > 0) {
                const key = h.slice(0, colonIdx).trim();
                const value = h.slice(colonIdx + 1).trim();
                if (key && value) {
                    headers[key] = value;
                }
            }
        }
    }

    // aria2 also supports a top-level "referer" option
    if (typeof options.referer === "string" && options.referer && !headers["Referer"]) {
        headers["Referer"] = options.referer;
    }

    // "user-agent" option
    if (typeof options["user-agent"] === "string" && options["user-agent"] && !headers["User-Agent"]) {
        headers["User-Agent"] = options["user-agent"];
    }

    const result: DownloadRequest = {
        url: primaryUri,
        filename: typeof options.out === "string" ? options.out : undefined,
        directory: typeof options.dir === "string" ? options.dir : undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
    };

    return result;
}

/**
 * Extract option values from aria2 option object.
 * Returns a cleaned Record with only the options we actually support.
 */
export function parseOptions(raw: Record<string, unknown>): Record<string, string> {
    const supported: Record<string, string> = {};

    const stringKeys = [
        "dir", "out", "referer", "user-agent",
        "max-connection-per-server", "split", "min-split-size",
        "max-download-limit",
    ];

    for (const key of stringKeys) {
        if (typeof raw[key] === "string") {
            supported[key] = raw[key] as string;
        }
    }

    // header is an array, store as JSON
    if (Array.isArray(raw.header)) {
        supported["header"] = JSON.stringify(raw.header);
    }

    return supported;
}

/**
 * Filter an object to only include specified keys.
 * Used for tellStatus key filtering.
 */
export function filterKeys<T extends Record<string, unknown>>(
    obj: T,
    keys?: string[]
): Partial<T> {
    if (!keys || keys.length === 0) return obj;

    const filtered: Record<string, unknown> = {};
    for (const key of keys) {
        if (key in obj) {
            filtered[key] = obj[key];
        }
    }
    return filtered as Partial<T>;
}
```

## File: shim/session.ts
```typescript
/**
 * Session management for the Aria2 shim.
 * Generates and stores a session ID that persists for the lifetime
 * of the background service worker.
 */

let sessionId: string | null = null;

/**
 * Get or create the current session ID.
 * The session ID is a 16-character hex string, generated once per
 * service worker lifetime (analogous to one aria2 process run).
 */
export function getSessionId(): string {
    if (!sessionId) {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        sessionId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return sessionId;
}
```

## File: shim/handlers/add-uri.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { parseAddUriParams } from "../param-utils";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:addUri]";

/**
 * aria2.addUri([secret], uris, [options], [position])
 *
 * Creates a new download task. Returns the GID (task ID) on success.
 */
export async function addUri(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} params=`, params);

    const request = parseAddUriParams(params);
    if (!request) {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Invalid or missing URIs") };
    }

    try {
        const taskId = await downloadManager.create(request);
        console.log(`${LOG_PREFIX} Created task ${taskId} for ${request.url}`);
        return { jsonrpc: "2.0", id, result: taskId };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Failed to create task:`, msg);
        return { jsonrpc: "2.0", id, error: errors.internalError(msg) };
    }
}
```

## File: shim/handlers/remove.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:remove]";

/**
 * aria2.remove([secret], gid)
 *
 * Removes the download denoted by gid. If active, this effectively cancels it.
 * Returns the GID of the removed download.
 */
export async function remove(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} Removing gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    try {
        await downloadManager.cancel(gid);
        console.log(`${LOG_PREFIX} Removed gid=${gid}`);
        return { jsonrpc: "2.0", id, result: gid };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Failed:`, msg);
        return { jsonrpc: "2.0", id, error: errors.internalError(msg) };
    }
}

/**
 * aria2.forceRemove([secret], gid)
 *
 * Same as remove in our shim (we don't distinguish between graceful
 * and forced removal since browser downloads don't have that concept).
 */
export async function forceRemove(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    return remove(id, params);
}
```

## File: shim/handlers/pause.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:pause]";

/**
 * aria2.pause([secret], gid)
 *
 * Pauses the download denoted by gid.
 * Returns the GID on success.
 */
export async function pause(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} Pausing gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    try {
        await downloadManager.pause(gid);
        console.log(`${LOG_PREFIX} Paused gid=${gid}`);
        return { jsonrpc: "2.0", id, result: gid };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Failed:`, msg);
        return { jsonrpc: "2.0", id, error: errors.internalError(msg) };
    }
}

/**
 * aria2.forcePause([secret], gid)
 *
 * Same as pause in our shim.
 */
export async function forcePause(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    return pause(id, params);
}

/**
 * aria2.pauseAll([secret])
 *
 * Pauses all active/waiting downloads.
 */
export async function pauseAll(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} Pausing all tasks`);

    const activeTasks = downloadManager.queryTasks({ status: ["in_progress", "pending"] });
    const failed: string[] = [];

    for (const task of activeTasks) {
        try {
            await downloadManager.pause(task.id);
        } catch {
            failed.push(task.id);
        }
    }

    if (failed.length > 0) {
        console.warn(`${LOG_PREFIX} Failed to pause: ${failed.join(", ")}`);
    }

    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.forcePauseAll([secret])
 */
export async function forcePauseAll(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    return pauseAll(id, params);
}
```

## File: shim/handlers/unpause.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:unpause]";

/**
 * aria2.unpause([secret], gid)
 *
 * Resumes the paused download denoted by gid.
 * Returns the GID on success.
 */
export async function unpause(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} Unpausing gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    try {
        await downloadManager.resume(gid);
        console.log(`${LOG_PREFIX} Unpaused gid=${gid}`);
        return { jsonrpc: "2.0", id, result: gid };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Failed:`, msg);
        return { jsonrpc: "2.0", id, error: errors.internalError(msg) };
    }
}

/**
 * aria2.unpauseAll([secret])
 *
 * Resumes all paused downloads.
 */
export async function unpauseAll(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} Unpausing all tasks`);

    const pausedTasks = downloadManager.queryTasks({ status: "paused" });
    const failed: string[] = [];

    for (const task of pausedTasks) {
        try {
            await downloadManager.resume(task.id);
        } catch {
            failed.push(task.id);
        }
    }

    if (failed.length > 0) {
        console.warn(`${LOG_PREFIX} Failed to unpause: ${failed.join(", ")}`);
    }

    return { jsonrpc: "2.0", id, result: "OK" };
}
```

## File: shim/handlers/tell-status.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2TellStatusResult } from "../types";
import { toAria2Status, toAria2ErrorCode } from "../status-map";
import { filterKeys } from "../param-utils";
import * as errors from "../errors";
import { buildFileResult } from "./get-files";

const LOG_PREFIX = "[Aria2:tellStatus]";

/**
 * Build a full Aria2TellStatusResult from a DownloadTask.
 */
export function buildTellStatusResult(taskId: string): Aria2TellStatusResult | null {
    const task = downloadManager.getTask(taskId);
    if (!task) return null;

    const aria2Status = toAria2Status(task.status);
    const completedLength = String(task.bytesReceived);
    const totalLength = String(task.totalBytes > 0 ? task.totalBytes : 0);

    // Calculate download speed: for active downloads we can estimate
    // but without tracking intervals this is approximate
    let downloadSpeed = "0";
    if (task.status === "in_progress" && task.bytesReceived > 0 && task.createdAt) {
        const elapsed = (Date.now() - task.createdAt) / 1000;
        if (elapsed > 0) {
            downloadSpeed = String(Math.floor(task.bytesReceived / elapsed));
        }
    }

    const result: Aria2TellStatusResult = {
        gid: task.id,
        status: aria2Status,
        totalLength,
        completedLength,
        uploadLength: "0",
        downloadSpeed,
        uploadSpeed: "0",
        connections: task.status === "in_progress" ? "1" : "0",
        dir: task.request.directory ?? "",
        files: [buildFileResult(task)],
    };

    // Add error info if applicable
    if (task.status === "error" && task.error) {
        result.errorCode = toAria2ErrorCode(task.error);
        result.errorMessage = task.error;
    }

    return result;
}

/**
 * aria2.tellStatus([secret], gid, [keys])
 *
 * Returns the progress of the download denoted by gid.
 * If keys is specified, the response only contains those keys.
 */
export async function tellStatus(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    const keys = params[1] as string[] | undefined;

    console.log(`${LOG_PREFIX} gid=${gid}, keys=`, keys);

    const result = buildTellStatusResult(gid);
    if (!result) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    const filtered = filterKeys(result as unknown as Record<string, unknown>, keys);
    return { jsonrpc: "2.0", id, result: filtered };
}
```

## File: shim/handlers/tell-active.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { buildTellStatusResult } from "./tell-status";
import { filterKeys } from "../param-utils";

const LOG_PREFIX = "[Aria2:tellActive]";

/**
 * aria2.tellActive([secret], [keys])
 *
 * Returns a list of active downloads. The response is an array of
 * aria2.tellStatus-like structures.
 */
export async function tellActive(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const keys = params[0] as string[] | undefined;

    console.log(`${LOG_PREFIX} keys=`, keys);

    const activeTasks = downloadManager.queryTasks({ status: "in_progress" });
    const results = [];

    for (const task of activeTasks) {
        const status = buildTellStatusResult(task.id);
        if (status) {
            results.push(filterKeys(status as unknown as Record<string, unknown>, keys));
        }
    }

    console.log(`${LOG_PREFIX} Returning ${results.length} active tasks`);
    return { jsonrpc: "2.0", id, result: results };
}
```

## File: shim/handlers/tell-waiting.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { buildTellStatusResult } from "./tell-status";
import { filterKeys } from "../param-utils";

const LOG_PREFIX = "[Aria2:tellWaiting]";

/**
 * aria2.tellWaiting([secret], offset, num, [keys])
 *
 * Returns a list of waiting downloads (status = "pending" in our model).
 * offset: starting index (0-based); negative values count from end
 * num: maximum number of tasks to return
 */
export async function tellWaiting(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const offset = typeof params[0] === "number" ? (params[0] as number) : 0;
    const num = typeof params[1] === "number" ? (params[1] as number) : 1000;
    const keys = params[2] as string[] | undefined;

    console.log(`${LOG_PREFIX} offset=${offset}, num=${num}, keys=`, keys);

    // "waiting" in aria2 includes both queued and paused
    const waitingTasks = downloadManager.queryTasks({ status: ["pending", "paused"] });

    // Handle negative offset (count from end)
    let startIdx: number;
    if (offset >= 0) {
        startIdx = offset;
    } else {
        startIdx = Math.max(0, waitingTasks.length + offset);
    }

    const sliced = waitingTasks.slice(startIdx, startIdx + num);
    const results = [];

    for (const task of sliced) {
        const status = buildTellStatusResult(task.id);
        if (status) {
            results.push(filterKeys(status as unknown as Record<string, unknown>, keys));
        }
    }

    console.log(`${LOG_PREFIX} Returning ${results.length} waiting tasks`);
    return { jsonrpc: "2.0", id, result: results };
}
```

## File: shim/handlers/tell-stopped.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { buildTellStatusResult } from "./tell-status";
import { filterKeys } from "../param-utils";

const LOG_PREFIX = "[Aria2:tellStopped]";

/**
 * aria2.tellStopped([secret], offset, num, [keys])
 *
 * Returns a list of stopped downloads (complete, error, cancelled/removed).
 */
export async function tellStopped(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const offset = typeof params[0] === "number" ? (params[0] as number) : 0;
    const num = typeof params[1] === "number" ? (params[1] as number) : 1000;
    const keys = params[2] as string[] | undefined;

    console.log(`${LOG_PREFIX} offset=${offset}, num=${num}, keys=`, keys);

    const stoppedTasks = downloadManager.queryTasks({
        status: ["complete", "error", "cancelled"],
    });

    let startIdx: number;
    if (offset >= 0) {
        startIdx = offset;
    } else {
        startIdx = Math.max(0, stoppedTasks.length + offset);
    }

    const sliced = stoppedTasks.slice(startIdx, startIdx + num);
    const results = [];

    for (const task of sliced) {
        const status = buildTellStatusResult(task.id);
        if (status) {
            results.push(filterKeys(status as unknown as Record<string, unknown>, keys));
        }
    }

    console.log(`${LOG_PREFIX} Returning ${results.length} stopped tasks`);
    return { jsonrpc: "2.0", id, result: results };
}
```

## File: shim/handlers/get-uris.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2UriResult } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:getUris]";

/**
 * aria2.getUris([secret], gid)
 *
 * Returns the URIs used in the download denoted by gid.
 * Since we only support single-URI downloads, this returns an array
 * with one entry.
 */
export async function getUris(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    const uris: Aria2UriResult[] = [
        {
            uri: task.request.url,
            status: "used",
        },
    ];

    return { jsonrpc: "2.0", id, result: uris };
}
```

## File: shim/handlers/get-files.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { DownloadTask } from "@/core/types";
import type { Aria2RpcResponse, Aria2FileResult } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:getFiles]";

/**
 * Build a single Aria2FileResult from a DownloadTask.
 * Exported for reuse by tellStatus.
 */
export function buildFileResult(task: DownloadTask): Aria2FileResult {
    const filename = task.request.filename ?? extractFilenameFromUrl(task.request.url);
    const dir = task.request.directory ?? "";
    const path = dir ? `${dir}/${filename}` : filename;

    return {
        index: "1",
        path,
        length: String(task.totalBytes > 0 ? task.totalBytes : 0),
        completedLength: String(task.bytesReceived),
        selected: "true",
        uris: [
            {
                uri: task.request.url,
                status: "used",
            },
        ],
    };
}

/**
 * Extract a reasonable filename from a URL.
 */
function extractFilenameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split("/");
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart) {
            return decodeURIComponent(lastPart);
        }
    } catch {
        // fall through
    }
    return "download";
}

/**
 * aria2.getFiles([secret], gid)
 *
 * Returns the file list of a download.
 * In our shim, each download has exactly one file.
 */
export async function getFiles(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    return { jsonrpc: "2.0", id, result: [buildFileResult(task)] };
}
```

## File: shim/handlers/get-servers.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2ServerResult } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:getServers]";

/**
 * aria2.getServers([secret], gid)
 *
 * Returns the servers currently connected for a download.
 * In our single-connection shim, this returns exactly one server entry.
 */
export async function getServers(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    // Calculate approximate speed
    let downloadSpeed = "0";
    if (task.status === "in_progress" && task.bytesReceived > 0 && task.createdAt) {
        const elapsed = (Date.now() - task.createdAt) / 1000;
        if (elapsed > 0) {
            downloadSpeed = String(Math.floor(task.bytesReceived / elapsed));
        }
    }

    const result: Aria2ServerResult[] = [
        {
            index: "1",
            servers: task.status === "in_progress"
                ? [
                    {
                        uri: task.request.url,
                        currentUri: task.request.url,
                        downloadSpeed,
                    },
                ]
                : [],
        },
    ];

    return { jsonrpc: "2.0", id, result };
}
```

## File: shim/handlers/options.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:options]";

/**
 * The set of options we can meaningfully report.
 * These reflect what our shim actually supports.
 */
function getDefaultOptions(): Record<string, string> {
    return {
        "allow-overwrite": "false",
        "allow-piece-length-change": "false",
        "always-resume": "true",
        "auto-file-renaming": "true",
        "conditional-get": "false",
        "connect-timeout": "60",
        "continue": "true",
        "dir": "",
        "dry-run": "false",
        "enable-http-keep-alive": "true",
        "enable-http-pipelining": "false",
        "file-allocation": "none",
        "http-accept-gzip": "false",
        "max-connection-per-server": "1",
        "max-download-limit": "0",
        "max-file-not-found": "0",
        "max-tries": "5",
        "min-split-size": "20M",
        "no-netrc": "false",
        "out": "",
        "parameterized-uri": "false",
        "pause": "false",
        "piece-length": "1M",
        "proxy-method": "get",
        "remote-time": "false",
        "remove-control-file": "false",
        "retry-wait": "0",
        "reuse-uri": "true",
        "rpc-save-upload-metadata": "true",
        "split": "1",
        "timeout": "60",
        "uri-selector": "feedback",
    };
}

/**
 * aria2.getOption([secret], gid)
 *
 * Returns options of the download denoted by gid.
 * Returns only options that the shim recognizes.
 */
export async function getOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} getOption gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    const options = getDefaultOptions();

    // Fill in task-specific values
    if (task.request.directory) {
        options["dir"] = task.request.directory;
    }
    if (task.request.filename) {
        options["out"] = task.request.filename;
    }
    if (task.request.headers) {
        const headerArr = Object.entries(task.request.headers).map(
            ([k, v]) => `${k}: ${v}`
        );
        options["header"] = JSON.stringify(headerArr);
    }

    return { jsonrpc: "2.0", id, result: options };
}

/**
 * aria2.changeOption([secret], gid, options)
 *
 * Changes options of the download denoted by gid dynamically.
 * In our shim, this is a limited no-op for most options since
 * browser downloads can't be reconfigured mid-flight.
 * We accept the call and log it, but only a few options have real effect.
 */
export async function changeOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    const options = params[1] as Record<string, unknown> | undefined;

    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} changeOption gid=${gid}`, options);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    // Log the options but note we can't actually change most things mid-download
    if (options) {
        console.warn(
            `${LOG_PREFIX} changeOption: options received but most cannot be applied ` +
            `to in-progress browser downloads. Options:`, options
        );
    }

    // Accept the call gracefully
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.getGlobalOption([secret])
 *
 * Returns global options.
 */
export async function getGlobalOption(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getGlobalOption`);

    const options = getDefaultOptions();
    // Add global-only options
    options["max-concurrent-downloads"] = "5";
    options["max-overall-download-limit"] = "0";
    options["max-overall-upload-limit"] = "0";
    options["save-session"] = "";
    options["save-session-interval"] = "0";
    options["log-level"] = "debug";

    return { jsonrpc: "2.0", id, result: options };
}

/**
 * aria2.changeGlobalOption([secret], options)
 *
 * Changes global options. In our shim, accepted but mostly ignored.
 */
export async function changeGlobalOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const options = params[0] as Record<string, unknown> | undefined;
    console.log(`${LOG_PREFIX} changeGlobalOption`, options);

    // Accept gracefully; we don't have real global config to modify
    return { jsonrpc: "2.0", id, result: "OK" };
}
```

## File: shim/handlers/position.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:changePosition]";

/**
 * aria2.changePosition([secret], gid, pos, how)
 *
 * Changes the position of a download in the waiting queue.
 *
 * how:
 *   POS_SET: Set position to pos (absolute)
 *   POS_CUR: Move relative to current position
 *   POS_END: Move relative to end of queue
 *
 * In our shim, this is a logical no-op since we don't have a real
 * download queue with scheduling. We accept the call and return
 * the requested position.
 */
export async function changePosition(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    const pos = params[1] as number | undefined;
    const how = params[2] as string | undefined;

    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }
    if (typeof pos !== "number") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing pos") };
    }

    console.log(`${LOG_PREFIX} gid=${gid}, pos=${pos}, how=${how}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    // We don't actually reorder anything, but we return the position
    // to satisfy the caller's expectation
    const resultPos = Math.max(0, pos);

    console.log(`${LOG_PREFIX} Accepted position change (logical only): pos=${resultPos}`);
    return { jsonrpc: "2.0", id, result: resultPos };
}
```

## File: shim/handlers/global-stat.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2GlobalStatResult } from "../types";

const LOG_PREFIX = "[Aria2:getGlobalStat]";

/**
 * aria2.getGlobalStat([secret])
 *
 * Returns overall statistics such as download/upload speed, number of
 * active/waiting/stopped downloads.
 */
export async function getGlobalStat(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} Calculating global stats`);

    const active = downloadManager.queryTasks({ status: "in_progress" });
    const waiting = downloadManager.queryTasks({ status: ["pending", "paused"] });
    const stopped = downloadManager.queryTasks({
        status: ["complete", "error", "cancelled"],
    });

    // Aggregate download speed from all active tasks
    let totalDownloadSpeed = 0;
    for (const task of active) {
        if (task.bytesReceived > 0 && task.createdAt) {
            const elapsed = (Date.now() - task.createdAt) / 1000;
            if (elapsed > 0) {
                totalDownloadSpeed += Math.floor(task.bytesReceived / elapsed);
            }
        }
    }

    const result: Aria2GlobalStatResult = {
        downloadSpeed: String(totalDownloadSpeed),
        uploadSpeed: "0",
        numActive: String(active.length),
        numWaiting: String(waiting.length),
        numStopped: String(stopped.length),
        numStoppedTotal: String(stopped.length),
    };

    console.log(`${LOG_PREFIX} Stats:`, result);
    return { jsonrpc: "2.0", id, result };
}
```

## File: shim/handlers/meta.ts
```typescript
import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2VersionResult, Aria2SessionInfoResult } from "../types";
import { getSessionId } from "../session";

const LOG_PREFIX = "[Aria2:meta]";

/**
 * The version string we report.
 * The format "shim/x.y.z" makes it clear this is not real aria2.
 */
const SHIM_VERSION = "1.37.0";

/**
 * Features we actually support (honestly reported).
 */
const ENABLED_FEATURES: string[] = [
    "GZip",
    "HTTPS",
];

/**
 * aria2.getVersion([secret])
 *
 * Returns version info and enabled features.
 */
export async function getVersion(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getVersion`);

    const result: Aria2VersionResult = {
        version: SHIM_VERSION,
        enabledFeatures: ENABLED_FEATURES,
    };

    return { jsonrpc: "2.0", id, result };
}

/**
 * aria2.getSessionInfo([secret])
 *
 * Returns session information. The sessionId persists for the lifetime
 * of the background service worker.
 */
export async function getSessionInfo(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getSessionInfo`);

    const result: Aria2SessionInfoResult = {
        sessionId: getSessionId(),
    };

    return { jsonrpc: "2.0", id, result };
}

/**
 * aria2.purgeDownloadResult([secret])
 *
 * Purges completed/error/removed download results from memory.
 */
export async function purgeDownloadResult(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} purgeDownloadResult`);

    downloadManager.purgeResults();
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.removeDownloadResult([secret], gid)
 *
 * Removes a specific completed download result from memory.
 */
export async function removeDownloadResult(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing GID" },
        };
    }

    console.log(`${LOG_PREFIX} removeDownloadResult gid=${gid}`);

    const removed = downloadManager.removeResult(gid);
    if (!removed) {
        return {
            jsonrpc: "2.0",
            id,
            error: { code: 1, message: `Cannot remove result for GID ${gid}` },
        };
    }

    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.shutdown([secret])
 *
 * In real aria2, this shuts down the process.
 * We accept the call but do nothing — a browser extension cannot shut itself down.
 */
export async function shutdown(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} shutdown called (no-op)`);
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.forceShutdown([secret])
 *
 * Same as shutdown — accepted but not executed.
 */
export async function forceShutdown(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} forceShutdown called (no-op)`);
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.saveSession([secret])
 *
 * In real aria2, this saves the session to disk.
 * Browser extensions cannot write arbitrary files, so we accept but no-op.
 */
export async function saveSession(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} saveSession called (no-op, browser cannot write session files)`);
    return { jsonrpc: "2.0", id, result: "OK" };
}
```

## File: shim/handlers/unsupported.ts
```typescript
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:unsupported]";

/**
 * aria2.addTorrent
 *
 * Cannot be implemented: browsers cannot create TCP/UDP listeners
 * for DHT/P2P connections required by BitTorrent.
 */
export async function addTorrent(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} addTorrent called — not supported`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported(
            "BitTorrent downloads are not supported. " +
            "Browser extensions cannot establish P2P connections. " +
            "Please use the real aria2 client for torrent downloads."
        ),
    };
}

/**
 * aria2.addMetalink
 *
 * Cannot be meaningfully implemented: Metalink files describe complex
 * multi-source/multi-file downloads with chunk verification, which
 * the browser download API cannot handle.
 */
export async function addMetalink(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} addMetalink called — not supported`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported(
            "Metalink downloads are not supported. " +
            "Please parse the Metalink file and use addUri for individual HTTP URLs."
        ),
    };
}

/**
 * aria2.getPeers
 *
 * Only applicable to BitTorrent, which we don't support.
 */
export async function getPeers(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.warn(`${LOG_PREFIX} getPeers called — not supported (no P2P)`);
    return {
        jsonrpc: "2.0",
        id,
        error: errors.unsupported("getPeers is only applicable to BitTorrent downloads"),
    };
}
```

## File: shim/handlers/system.ts
```typescript
import type { Aria2RpcRequest, Aria2RpcResponse } from "../types";
import { stripToken } from "../param-utils";

const LOG_PREFIX = "[Aria2:system]";

/**
 * The complete list of RPC methods we support.
 * Used by system.listMethods and for documentation.
 */
export const SUPPORTED_METHODS: readonly string[] = [
    // Fully implemented
    "aria2.addUri",
    "aria2.remove",
    "aria2.forceRemove",
    "aria2.pause",
    "aria2.forcePause",
    "aria2.pauseAll",
    "aria2.forcePauseAll",
    "aria2.unpause",
    "aria2.unpauseAll",
    "aria2.tellStatus",
    "aria2.tellActive",
    "aria2.tellWaiting",
    "aria2.tellStopped",
    "aria2.getUris",
    "aria2.getFiles",
    "aria2.getServers",
    "aria2.getOption",
    "aria2.changeOption",
    "aria2.getGlobalOption",
    "aria2.changeGlobalOption",
    "aria2.changePosition",
    "aria2.getGlobalStat",
    "aria2.getVersion",
    "aria2.getSessionInfo",
    "aria2.purgeDownloadResult",
    "aria2.removeDownloadResult",
    "aria2.saveSession",
    "aria2.shutdown",
    "aria2.forceShutdown",
    "system.multicall",
    "system.listMethods",
    "system.listNotifications",
    // Declared but unsupported (return errors)
    "aria2.addTorrent",
    "aria2.addMetalink",
    "aria2.getPeers",
] as const;

/**
 * Notifications that the real aria2 would emit.
 * We list them for compatibility, though we don't currently
 * push WebSocket notifications.
 */
const NOTIFICATIONS: readonly string[] = [
    "aria2.onDownloadStart",
    "aria2.onDownloadPause",
    "aria2.onDownloadStop",
    "aria2.onDownloadComplete",
    "aria2.onDownloadError",
    "aria2.onBtDownloadComplete",
] as const;

/**
 * system.listMethods()
 *
 * Returns an array of all supported RPC method names.
 */
export async function listMethods(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} listMethods`);
    return { jsonrpc: "2.0", id, result: [...SUPPORTED_METHODS] };
}

/**
 * system.listNotifications()
 *
 * Returns an array of all notification method names.
 */
export async function listNotifications(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} listNotifications`);
    return { jsonrpc: "2.0", id, result: [...NOTIFICATIONS] };
}

/**
 * system.multicall([methods])
 *
 * Executes multiple RPC calls in a single request.
 * Each item in methods is { methodName: string, params: unknown[] }.
 *
 * @param dispatch - The router function to dispatch individual calls
 */
export function createMulticallHandler(
    dispatch: (req: Aria2RpcRequest) => Promise<Aria2RpcResponse>
) {
    return async function multicall(
        id: string | number,
        params: unknown[]
    ): Promise<Aria2RpcResponse> {
        const calls = params[0] as Array<{ methodName: string; params: unknown[] }> | undefined;

        if (!Array.isArray(calls)) {
            return {
                jsonrpc: "2.0",
                id,
                error: { code: -32602, message: "Invalid params: expected array of method calls" },
            };
        }

        console.log(`${LOG_PREFIX} multicall with ${calls.length} calls`);

        const results: unknown[] = [];

        for (const call of calls) {
            if (!call.methodName || !Array.isArray(call.params)) {
                results.push({
                    code: -32602,
                    message: "Invalid method call structure",
                });
                continue;
            }

            try {
                const response = await dispatch({
                    jsonrpc: "2.0",
                    id: "multicall-sub",
                    method: call.methodName,
                    params: call.params,
                });

                if (response.error) {
                    results.push(response.error);
                } else {
                    // multicall wraps each result in an array per the spec
                    results.push([response.result]);
                }
            } catch (err) {
                results.push({
                    code: -32603,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return { jsonrpc: "2.0", id, result: results };
    };
}
```

## File: shim/router.ts
```typescript
import type { Aria2RpcRequest, Aria2RpcResponse } from "./types";
import { stripToken } from "./param-utils";
import * as errors from "./errors";

// Handler imports
import { addUri } from "./handlers/add-uri";
import { remove, forceRemove } from "./handlers/remove";
import { pause, forcePause, pauseAll, forcePauseAll } from "./handlers/pause";
import { unpause, unpauseAll } from "./handlers/unpause";
import { tellStatus } from "./handlers/tell-status";
import { tellActive } from "./handlers/tell-active";
import { tellWaiting } from "./handlers/tell-waiting";
import { tellStopped } from "./handlers/tell-stopped";
import { getUris } from "./handlers/get-uris";
import { getFiles } from "./handlers/get-files";
import { getServers } from "./handlers/get-servers";
import { getOption, changeOption, getGlobalOption, changeGlobalOption } from "./handlers/options";
import { changePosition } from "./handlers/position";
import { getGlobalStat } from "./handlers/global-stat";
import {
    getVersion,
    getSessionInfo,
    purgeDownloadResult,
    removeDownloadResult,
    saveSession,
    shutdown,
    forceShutdown,
} from "./handlers/meta";
import { addTorrent, addMetalink, getPeers } from "./handlers/unsupported";
import { listMethods, listNotifications, createMulticallHandler } from "./handlers/system";

const LOG_PREFIX = "[Aria2Router]";

/**
 * Handler function signature.
 * Each handler receives (id, params) and returns an Aria2RpcResponse.
 */
type RpcHandler = (
    id: string | number,
    params: unknown[]
) => Promise<Aria2RpcResponse>;

/**
 * Method routing table.
 * Maps aria2 method names to their handler functions.
 */
const METHOD_MAP: Readonly<Record<string, RpcHandler>> = {
    // Core download operations
    "aria2.addUri": addUri,
    "aria2.remove": remove,
    "aria2.forceRemove": forceRemove,
    "aria2.pause": pause,
    "aria2.forcePause": forcePause,
    "aria2.pauseAll": pauseAll,
    "aria2.forcePauseAll": forcePauseAll,
    "aria2.unpause": unpause,
    "aria2.unpauseAll": unpauseAll,

    // Status queries
    "aria2.tellStatus": tellStatus,
    "aria2.tellActive": tellActive,
    "aria2.tellWaiting": tellWaiting,
    "aria2.tellStopped": tellStopped,

    // Task details
    "aria2.getUris": getUris,
    "aria2.getFiles": getFiles,
    "aria2.getServers": getServers,

    // Options
    "aria2.getOption": getOption,
    "aria2.changeOption": changeOption,
    "aria2.getGlobalOption": getGlobalOption,
    "aria2.changeGlobalOption": changeGlobalOption,

    // Queue management
    "aria2.changePosition": changePosition,

    // Global stats
    "aria2.getGlobalStat": getGlobalStat,

    // Meta / lifecycle
    "aria2.getVersion": getVersion,
    "aria2.getSessionInfo": getSessionInfo,
    "aria2.purgeDownloadResult": purgeDownloadResult,
    "aria2.removeDownloadResult": removeDownloadResult,
    "aria2.saveSession": saveSession,
    "aria2.shutdown": shutdown,
    "aria2.forceShutdown": forceShutdown,

    // Unsupported (return descriptive errors)
    "aria2.addTorrent": addTorrent,
    "aria2.addMetalink": addMetalink,
    "aria2.getPeers": getPeers,

    // System
    "system.listMethods": listMethods,
    "system.listNotifications": listNotifications,
    // system.multicall is handled separately (needs dispatch reference)
};

/**
 * Dispatch a single Aria2 RPC request to the appropriate handler.
 */
async function dispatchRequest(req: Aria2RpcRequest): Promise<Aria2RpcResponse> {
    const { id, method, params = [] } = req;

    console.log(`${LOG_PREFIX} Dispatching: ${method} (id=${id})`);

    // Strip optional "token:xxx" from params
    const cleanParams = stripToken(params);

    // Handle system.multicall specially (needs access to dispatch)
    if (method === "system.multicall") {
        const multicallHandler = createMulticallHandler(dispatchRequest);
        return multicallHandler(id, cleanParams);
    }

    // Look up handler
    const handler = METHOD_MAP[method];
    if (!handler) {
        console.warn(`${LOG_PREFIX} Unknown method: ${method}`);
        return { jsonrpc: "2.0", id, error: errors.methodNotFound(method) };
    }

    try {
        return await handler(id, cleanParams);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Handler error for ${method}:`, msg);
        return { jsonrpc: "2.0", id, error: errors.internalError(msg) };
    }
}

/**
 * Main entry point for Aria2 RPC request handling.
 * Supports both single requests and batch (array) requests.
 */
export async function handleAria2Request(
    body: Aria2RpcRequest | Aria2RpcRequest[]
): Promise<Aria2RpcResponse | Aria2RpcResponse[]> {
    if (Array.isArray(body)) {
        console.log(`${LOG_PREFIX} Batch request with ${body.length} items`);
        return Promise.all(body.map(dispatchRequest));
    }
    return dispatchRequest(body);
}
```

Now update the old single-file entry point to re-export from the new router:

## File: shim/aria2-interceptor.ts
```typescript
/**
 * @module aria2-interceptor
 *
 * Re-exports the main entry point from the refactored router module.
 * This file exists for backward compatibility with existing imports.
 */
export { handleAria2Request } from "./router";
```

The `entrypoints/background.ts` file does **not** need changes — it imports `handleAria2Request` from `@/shim/aria2-interceptor`, which now re-exports from the router.

---

### Summary of changes

**Deleted / replaced:**
- `shim/aria2-interceptor.ts` — the entire monolithic implementation is replaced by a thin re-export

**New files created:**

| File | Purpose |
|------|---------|
| `shim/types.ts` | All Aria2 RPC protocol type definitions |
| `shim/errors.ts` | Structured error factory functions matching aria2 error codes |
| `shim/status-map.ts` | Mapping between internal `DownloadStatus` and aria2's status strings/error codes |
| `shim/param-utils.ts` | Token stripping, `addUri` param parsing, option parsing, key filtering |
| `shim/session.ts` | Session ID generation and storage |
| `shim/router.ts` | Central dispatch: method→handler routing, batch support |
| `shim/handlers/add-uri.ts` | `aria2.addUri` — core download creation |
| `shim/handlers/remove.ts` | `aria2.remove`, `aria2.forceRemove` |
| `shim/handlers/pause.ts` | `aria2.pause`, `aria2.forcePause`, `aria2.pauseAll`, `aria2.forcePauseAll` |
| `shim/handlers/unpause.ts` | `aria2.unpause`, `aria2.unpauseAll` |
| `shim/handlers/tell-status.ts` | `aria2.tellStatus` with key filtering |
| `shim/handlers/tell-active.ts` | `aria2.tellActive` |
| `shim/handlers/tell-waiting.ts` | `aria2.tellWaiting` with offset/num pagination |
| `shim/handlers/tell-stopped.ts` | `aria2.tellStopped` with offset/num pagination |
| `shim/handlers/get-uris.ts` | `aria2.getUris` |
| `shim/handlers/get-files.ts` | `aria2.getFiles` (single-file only) |
| `shim/handlers/get-servers.ts` | `aria2.getServers` (single connection) |
| `shim/handlers/options.ts` | `aria2.getOption`, `changeOption`, `getGlobalOption`, `changeGlobalOption` |
| `shim/handlers/position.ts` | `aria2.changePosition` (logical no-op) |
| `shim/handlers/global-stat.ts` | `aria2.getGlobalStat` |
| `shim/handlers/meta.ts` | `getVersion`, `getSessionInfo`, `purgeDownloadResult`, `removeDownloadResult`, `saveSession`, `shutdown`, `forceShutdown` |
| `shim/handlers/unsupported.ts` | `addTorrent`, `addMetalink`, `getPeers` — return descriptive errors |
| `shim/handlers/system.ts` | `system.multicall`, `system.listMethods`, `system.listNotifications` |