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