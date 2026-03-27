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