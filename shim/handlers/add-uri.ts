import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import { parseAddUriParams } from "../param-utils";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:addUri]";

/**
 * aria2.addUri([secret], uris, [options], [position])
 *
 * Creates a new download task. Returns the GID (task ID) on success.
 */
export async function addUri(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} params=`, params);

    const request = parseAddUriParams(params);
    if (!request) {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Invalid or missing URIs") };
    }

    try {
        const taskId = await downloadManager.create(request);
        console.log(`${LOG_PREFIX} Created task ${taskId} for ${request.url}`);
        return { jsonrpc: "2.0", id, result: taskId };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Failed to create task:`, msg);
        return { jsonrpc: "2.0", id, error: errors.internalError(msg) };
    }
}