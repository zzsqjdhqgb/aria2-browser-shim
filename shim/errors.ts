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