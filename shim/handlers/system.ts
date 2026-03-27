import type { Aria2RpcRequest, Aria2RpcResponse } from "../types";

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
    "aria2.changeUri",
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
        const calls = params[0] as Array<{ methodName: string; params?: unknown[] }> | undefined;

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
            if (!call.methodName || (call.params !== undefined && !Array.isArray(call.params))) {
                results.push({
                    code: -32602,
                    message: "Invalid method call structure",
                });
                continue;
            }

            const nestedParams = Array.isArray(call.params) ? call.params : [];

            try {
                const response = await dispatch({
                    jsonrpc: "2.0",
                    id: "multicall-sub",
                    method: call.methodName,
                    params: nestedParams,
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