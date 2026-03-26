import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2ServerResult } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:getServers]";

/**
 * aria2.getServers([secret], gid)
 *
 * Returns the servers currently connected for a download.
 * In our single-connection shim, this returns exactly one server entry.
 */
export async function getServers(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    // Calculate approximate speed
    let downloadSpeed = "0";
    if (task.status === "in_progress" && task.bytesReceived > 0 && task.createdAt) {
        const elapsed = (Date.now() - task.createdAt) / 1000;
        if (elapsed > 0) {
            downloadSpeed = String(Math.floor(task.bytesReceived / elapsed));
        }
    }

    const result: Aria2ServerResult[] = [
        {
            index: "1",
            servers: task.status === "in_progress"
                ? [
                    {
                        uri: task.request.url,
                        currentUri: task.request.url,
                        downloadSpeed,
                    },
                ]
                : [],
        },
    ];

    return { jsonrpc: "2.0", id, result };
}