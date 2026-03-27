import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2UriResult } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:getUris]";

/**
 * aria2.getUris([secret], gid)
 *
 * Returns the URIs used in the download denoted by gid.
 * Since we only support single-URI downloads, this returns an array
 * with one entry.
 */
export async function getUris(
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

    const uris: Aria2UriResult[] = [
        {
            uri: task.request.url,
            status: "used",
        },
    ];

    return { jsonrpc: "2.0", id, result: uris };
}