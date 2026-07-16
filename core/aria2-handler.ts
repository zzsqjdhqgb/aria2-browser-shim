import { downloadManager } from "./download-manager";
import { isEnabled, setEnabled, loadSettings, saveSettings } from "./storage";
import { loadSessionId, saveSessionId } from "./storage";
import type {
    Aria2RpcRequest, Aria2RpcResponse, Aria2TaskInfo, Aria2GlobalStat,
    Aria2FileInfo, Aria2UriInfo, Aria2VersionResult, Aria2SessionInfo,
    MultiCallItem,
} from "./types";
import { toAria2Status, type DownloadTask, type InternalStatus, type DownloadRequest } from "./types";

const LOG_PREFIX = "[Aria2Handler]";

// =============================================================================
// Session ID — persisted across SW restarts
// =============================================================================

let _sessionId: string | null = null;

async function getSessionId(): Promise<string> {
    if (_sessionId) return _sessionId;
    const stored = await loadSessionId();
    if (stored) {
        _sessionId = stored;
    } else {
        _sessionId = Array.from(
            crypto.getRandomValues(new Uint8Array(8)),
            (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        await saveSessionId(_sessionId);
    }
    return _sessionId;
}

// =============================================================================
// Helpers
// =============================================================================

function rpcError(id: string | number, code: number, message: string): Aria2RpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcOk(id: string | number, result: unknown): Aria2RpcResponse {
    return { jsonrpc: "2.0", id, result };
}

/** Strip secret token prefix if present. Returns [cleaned params, had token] */
function stripToken(params: unknown[]): [unknown[], boolean] {
    if (params.length > 0 && typeof params[0] === "string" && params[0].startsWith("token:")) {
        return [params.slice(1), true];
    }
    return [params, false];
}

/** Build full Aria2TaskInfo from internal DownloadTask */
function buildTaskInfo(task: DownloadTask, keys?: string[]): Aria2TaskInfo {
    const status = toAria2Status(task.status);
    const info: Aria2TaskInfo = {
        gid: task.id,
        status,
        totalLength: String(task.totalBytes > 0 ? task.totalBytes : 0),
        completedLength: String(task.bytesReceived),
        uploadLength: "0",
        downloadSpeed: String(task.speed),
        uploadSpeed: "0",
        dir: task.request.directory ?? "",
        files: [{
            index: "1",
            path: task.request.filename ?? task.url.split("/").pop() ?? "download",
            length: String(task.totalBytes > 0 ? task.totalBytes : 0),
            completedLength: String(task.bytesReceived),
            selected: "true",
            uris: [{ uri: task.url, status: task.started ? "used" : "waiting" }],
        }],
        errorCode: task.errorCode,
        errorMessage: task.error,
    };

    // Filter by requested keys if provided
    if (keys && keys.length > 0) {
        const filtered: Record<string, unknown> = {};
        for (const k of keys) {
            if (k in info) filtered[k] = (info as unknown as Record<string, unknown>)[k];
        }
        return filtered as unknown as Aria2TaskInfo;
    }

    return info;
}

/** Parse aria2.adUri params into DownloadRequest */
function parseAddUri(params: unknown[]): DownloadRequest | null {
    const uris = params[0] as string[] | undefined;
    if (!uris || uris.length === 0) return null;

    const options = (params[1] as Record<string, unknown>) ?? {};

    const headers: Record<string, string> = {};
    const headerList = options.header as string[] | undefined;
    if (headerList) {
        for (const h of headerList) {
            const idx = h.indexOf(":");
            if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
        }
    }

    return {
        url: uris[0],
        urls: uris.length > 1 ? uris.slice(1) : undefined,
        filename: options.out as string | undefined,
        directory: options.dir as string | undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        position: options["position"] as number | undefined,
    };
}

/** Build global statistics */
function buildGlobalStat(): Aria2GlobalStat {
    const all = downloadManager.queryTasks();
    let numActive = 0, numWaiting = 0, numStopped = 0;
    let speed = 0;
    for (const t of all) {
        if (t.status === "in_progress") { numActive++; speed += t.speed; }
        else if (t.status === "pending") numWaiting++;
        else if (t.status === "complete" || t.status === "error" || t.status === "cancelled") numStopped++;
    }
    return {
        downloadSpeed: String(speed),
        uploadSpeed: "0",
        numActive: String(numActive),
        numWaiting: String(numWaiting),
        numStopped: String(numStopped),
        numStoppedTotal: String(numStopped),
    };
}

// =============================================================================
// RPC method dispatcher
// =============================================================================

async function callMethod(
    method: string,
    params: unknown[],
): Promise<unknown> {
    switch (method) {
        // ---- Downloads ----
        case "aria2.addUri": {
            const req = parseAddUri(params);
            if (!req) throw { code: -32602, message: "Invalid params: uris array required" };
            return downloadManager.create(req);
        }
        case "aria2.addTorrent":
            throw { code: -32000, message: "BitTorrent not supported" };
        case "aria2.addMetalink":
            throw { code: -32000, message: "Metalink not supported" };

        // ---- Control ----
        case "aria2.pause":
        case "aria2.forcePause":
            if (!params[0]) throw { code: -32602, message: "GID required" };
            await downloadManager.pause(params[0] as string);
            return params[0];
        case "aria2.unpause":
            if (!params[0]) throw { code: -32602, message: "GID required" };
            await downloadManager.resume(params[0] as string);
            return params[0];
        case "aria2.pauseAll":
        case "aria2.forcePauseAll": {
            const all = downloadManager.queryTasks({ status: "in_progress" });
            for (const t of all) await downloadManager.pause(t.id);
            return "OK";
        }
        case "aria2.unpauseAll": {
            const all = downloadManager.queryTasks({ status: "paused" });
            for (const t of all) await downloadManager.resume(t.id);
            return "OK";
        }
        case "aria2.remove":
        case "aria2.forceRemove":
            if (!params[0]) throw { code: -32602, message: "GID required" };
            await downloadManager.cancel(params[0] as string);
            return params[0];
        case "aria2.removeDownloadResult":
            if (!params[0]) throw { code: -32602, message: "GID required" };
            return downloadManager.removeTask(params[0] as string) ? "OK" : { code: 1, message: "GID not found or not removable" };
        case "aria2.purgeDownloadResult":
            return String(downloadManager.purgeCompleted());

        // ---- Query ----
        case "aria2.tellStatus": {
            if (!params[0]) throw { code: -32602, message: "GID required" };
            const task = downloadManager.getTask(params[0] as string);
            if (!task) throw { code: 1, message: `GID ${params[0]} not found` };
            return buildTaskInfo(task, params[1] as string[] | undefined);
        }
        case "aria2.tellActive":
            return downloadManager.queryTasks({ status: "in_progress" }).map((t) => buildTaskInfo(t, params[0] as string[] | undefined));
        case "aria2.tellWaiting": {
            const offset = (params[0] as number) ?? 0;
            const num = (params[1] as number) ?? 100;
            return downloadManager.queryTasks({ status: ["pending", "paused"] }).slice(offset, offset + num).map((t) => buildTaskInfo(t, params[2] as string[] | undefined));
        }
        case "aria2.tellStopped": {
            const offset = (params[0] as number) ?? 0;
            const num = (params[1] as number) ?? 100;
            return downloadManager.queryTasks({ status: ["complete", "error", "cancelled"] }).slice(offset, offset + num).map((t) => buildTaskInfo(t, params[2] as string[] | undefined));
        }

        // ---- URIs & Files ----
        case "aria2.getUris": {
            if (!params[0]) throw { code: -32602, message: "GID required" };
            const task = downloadManager.getTask(params[0] as string);
            if (!task) throw { code: 1, message: "GID not found" };
            return [{ uri: task.url, status: task.started ? "used" : "waiting" }];
        }
        case "aria2.getFiles": {
            if (!params[0]) throw { code: -32602, message: "GID required" };
            const task = downloadManager.getTask(params[0] as string);
            if (!task) throw { code: 1, message: "GID not found" };
            return [{
                index: "1",
                path: task.request.filename ?? task.url.split("/").pop() ?? "download",
                length: String(task.totalBytes > 0 ? task.totalBytes : 0),
                completedLength: String(task.bytesReceived),
                selected: "true",
                uris: [{ uri: task.url, status: "used" }],
            }];
        }

        // ---- Not applicable (no BT/P2P) ----
        case "aria2.getPeers":
        case "aria2.getServers":
            return [];

        // ---- Options ----
        case "aria2.getOption": {
            if (!params[0]) throw { code: -32602, message: "GID required" };
            const task = downloadManager.getTask(params[0] as string);
            if (!task) throw { code: 1, message: "GID not found" };
            return {
                dir: task.request.directory ?? "",
                out: task.request.filename ?? "",
                header: task.request.headers
                    ? Object.entries(task.request.headers).map(([k, v]) => `${k}: ${v}`)
                    : [],
                split: "1",
                "max-connection-per-server": "1",
                "check-certificate": "true",
            };
        }
        case "aria2.changeOption": {
            if (!params[0]) throw { code: -32602, message: "GID required" };
            // Options are immutable after creation in our model
            return "OK";
        }
        case "aria2.getGlobalOption":
            return {
                dir: "",
                "max-concurrent-downloads": "5",
                "max-connection-per-server": "1",
                "min-split-size": "20M",
                split: "1",
                "check-certificate": "true",
            };
        case "aria2.changeGlobalOption": {
            const opts = params[0] as Record<string, unknown> | undefined;
            if (opts) {
                const settings = await loadSettings();
                if (typeof opts.dir === "string") settings.defaultDir = opts.dir;
                if (typeof opts["max-concurrent-downloads"] === "string") {
                    // Just store — we don't enforce concurrency yet
                }
                await saveSettings(settings);
            }
            return "OK";
        }

        // ---- Stats ----
        case "aria2.getGlobalStat":
            return buildGlobalStat();

        // ---- System ----
        case "aria2.getVersion": {
            const result: Aria2VersionResult = {
                version: "1.37.0-shim",
                enabledFeatures: ["Async DNS", "HTTP", "HTTPS", "GZip", "Cookie", "Firefox3 Cookie"],
            };
            return result;
        }
        case "aria2.getSessionInfo": {
            const result: Aria2SessionInfo = { sessionId: await getSessionId() };
            return result;
        }
        case "aria2.shutdown":
        case "aria2.forceShutdown":
            await downloadManager.cancelAll();
            await setEnabled(false);
            return "OK";

        // ---- Queue ----
        case "aria2.changePosition":
            // In this shim, we don't have a real queue — accept silently
            return 0;
        case "aria2.changeUri":
            // URI change not supported after creation
            return [1];

        // ---- System introspection ----
        case "system.listMethods":
            return [
                "aria2.addUri", "aria2.addTorrent", "aria2.addMetalink",
                "aria2.pause", "aria2.forcePause", "aria2.unpause",
                "aria2.pauseAll", "aria2.forcePauseAll", "aria2.unpauseAll",
                "aria2.remove", "aria2.forceRemove",
                "aria2.removeDownloadResult", "aria2.purgeDownloadResult",
                "aria2.tellStatus", "aria2.tellActive", "aria2.tellWaiting", "aria2.tellStopped",
                "aria2.getUris", "aria2.getFiles", "aria2.getPeers", "aria2.getServers",
                "aria2.getOption", "aria2.changeOption",
                "aria2.getGlobalOption", "aria2.changeGlobalOption",
                "aria2.getGlobalStat",
                "aria2.getVersion", "aria2.getSessionInfo",
                "aria2.shutdown", "aria2.forceShutdown",
                "aria2.changePosition", "aria2.changeUri",
                "system.multicall", "system.listMethods", "system.listNotifications",
            ];
        case "system.listNotifications":
            return [];

        default:
            throw { code: -32601, message: `Method not found: ${method}` };
    }
}

// =============================================================================
// Request handler (entry point)
// =============================================================================

async function handleSingle(request: Aria2RpcRequest): Promise<Aria2RpcResponse> {
    const { id, method, params: rawParams = [] } = request;

    // Check if extension is enabled
    if (!(await isEnabled())) {
        return rpcError(id, -32000, "Aria2 shim is disabled. Enable it via the extension popup.");
    }

    // Auth check: if rpcSecret is set, require token matching
    const settings = await loadSettings();
    const [cleanParams, hadToken] = stripToken(rawParams);
    if (settings.rpcSecret && !hadToken) {
        return rpcError(id, -32001, "Unauthorized: secret token required");
    }
    if (hadToken && settings.rpcSecret && rawParams[0] !== `token:${settings.rpcSecret}`) {
        return rpcError(id, -32001, "Unauthorized: secret token mismatch");
    }

    try {
        const result = await callMethod(method, cleanParams);
        return rpcOk(id, result);
    } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
            return rpcError(id, (err as { code: number }).code, (err as { message: string }).message);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return rpcError(id, -32603, msg);
    }
}

/**
 * Main entry point. Handles both single and batch requests.
 */
export async function handleAria2Request(
    body: Aria2RpcRequest | Aria2RpcRequest[],
): Promise<Aria2RpcResponse | Aria2RpcResponse[]> {
    if (Array.isArray(body)) {
        return Promise.all(body.map(handleSingle));
    }

    // Handle system.multicall (batch within a single request)
    if (body.method === "system.multicall") {
        const calls = (body.params?.[0] as MultiCallItem[]) ?? [];
        const results: unknown[] = [];
        for (const call of calls) {
            try {
                const result = await callMethod(call.methodName, call.params);
                results.push([result]);
            } catch (err: unknown) {
                if (typeof err === "object" && err !== null && "code" in err) {
                    const e = err as unknown as { code: number; message: string };
                    results.push({ code: e.code, message: e.message });
                } else {
                    results.push({ code: -32603, message: String(err) });
                }
            }
        }
        return rpcOk(body.id, results);
    }

    return handleSingle(body);
}
