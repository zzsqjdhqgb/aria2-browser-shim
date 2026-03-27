import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { buildTellStatusResult } from "./tell-status";
import { filterKeys, parseOptionalStringArray } from "../param-utils";
import * as errors from "../errors";

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
    const offset = params[0];
    const num = params[1];

    if (!Number.isInteger(offset)) {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("offset must be an integer") };
    }
    if (!Number.isInteger(num) || (num as number) < 0) {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("num must be a non-negative integer") };
    }

    const parsedKeys = parseOptionalStringArray(params[2]);
    if (parsedKeys === null) {
        return {
            jsonrpc: "2.0",
            id,
            error: errors.invalidParams("keys must be an array of strings"),
        };
    }
    const keys = parsedKeys;

    console.log(`${LOG_PREFIX} offset=${offset}, num=${num}, keys=`, keys);

    // "waiting" in aria2 includes both queued and paused
    const waitingTasks = downloadManager
        .queryTasks({ status: ["pending", "paused"] })
        .slice()
        .reverse();

    let sliced = [] as typeof waitingTasks;
    if ((offset as number) >= 0) {
        sliced = waitingTasks.slice(offset as number, (offset as number) + (num as number));
    } else {
        const start = waitingTasks.length + (offset as number);
        if (start >= 0) {
            const endExclusive = start + 1;
            const begin = Math.max(0, endExclusive - (num as number));
            sliced = waitingTasks.slice(begin, endExclusive).reverse();
        }
    }
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