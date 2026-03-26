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