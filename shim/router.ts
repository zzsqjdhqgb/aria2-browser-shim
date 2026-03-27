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
import { addTorrent, addMetalink, getPeers, changeUri } from "./handlers/unsupported";
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
    "aria2.changeUri": changeUri,

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