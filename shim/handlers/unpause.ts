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