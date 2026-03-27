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