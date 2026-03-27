import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { buildTellStatusResult } from "./tell-status";
import { filterKeys, parseOptionalStringArray } from "../param-utils";
import * as errors from "../errors";
import { refreshTaskIfPossible } from "./task-refresh";

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

    let stoppedTasks = downloadManager
        .queryTasks({ status: ["complete", "error", "cancelled"] })
        .slice()
        .sort((a, b) => {
            const aTs = a.completedAt ?? a.createdAt;
            const bTs = b.completedAt ?? b.createdAt;
            return aTs - bTs;
        });

    await Promise.all(stoppedTasks.map((task) => refreshTaskIfPossible(task.id)));

    stoppedTasks = downloadManager
        .queryTasks({ status: ["complete", "error", "cancelled"] })
        .slice()
        .sort((a, b) => {
            const aTs = a.completedAt ?? a.createdAt;
            const bTs = b.completedAt ?? b.createdAt;
            return aTs - bTs;
        });

    let sliced = [] as typeof stoppedTasks;
    if ((offset as number) >= 0) {
        sliced = stoppedTasks.slice(offset as number, (offset as number) + (num as number));
    } else {
        const start = stoppedTasks.length + (offset as number);
        if (start >= 0) {
            const endExclusive = start + 1;
            const begin = Math.max(0, endExclusive - (num as number));
            sliced = stoppedTasks.slice(begin, endExclusive).reverse();
        }
    }
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