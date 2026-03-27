import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { buildTellStatusResult } from "./tell-status";
import { filterKeys, parseOptionalStringArray } from "../param-utils";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:tellActive]";

/**
 * aria2.tellActive([secret], [keys])
 *
 * Returns a list of active downloads. The response is an array of
 * aria2.tellStatus-like structures.
 */
export async function tellActive(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const parsedKeys = parseOptionalStringArray(params[0]);
    if (parsedKeys === null) {
        return {
            jsonrpc: "2.0",
            id,
            error: errors.invalidParams("keys must be an array of strings"),
        };
    }
    const keys = parsedKeys;

    console.log(`${LOG_PREFIX} keys=`, keys);

    const activeTasks = downloadManager.queryTasks({ status: "in_progress" });
    const results = [];

    for (const task of activeTasks) {
        const status = buildTellStatusResult(task.id);
        if (status) {
            results.push(filterKeys(status as unknown as Record<string, unknown>, keys));
        }
    }

    console.log(`${LOG_PREFIX} Returning ${results.length} active tasks`);
    return { jsonrpc: "2.0", id, result: results };
}