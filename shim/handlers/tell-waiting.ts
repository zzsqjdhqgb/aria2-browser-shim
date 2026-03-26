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