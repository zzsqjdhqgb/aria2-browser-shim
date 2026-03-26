import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2TellStatusResult } from "../types";
import { toAria2Status, toAria2ErrorCode } from "../status-map";
import { filterKeys } from "../param-utils";
import * as errors from "../errors";
import { buildFileResult } from "./get-files";

const LOG_PREFIX = "[Aria2:tellStatus]";

/**
 * Build a full Aria2TellStatusResult from a DownloadTask.
 */
export function buildTellStatusResult(taskId: string): Aria2TellStatusResult | null {
    const task = downloadManager.getTask(taskId);
    if (!task) return null;

    const aria2Status = toAria2Status(task.status);
    const completedLength = String(task.bytesReceived);
    const totalLength = String(task.totalBytes > 0 ? task.totalBytes : 0);

    // Calculate download speed: for active downloads we can estimate
    // but without tracking intervals this is approximate
    let downloadSpeed = "0";
    if (task.status === "in_progress" && task.bytesReceived > 0 && task.createdAt) {
        const elapsed = (Date.now() - task.createdAt) / 1000;
        if (elapsed > 0) {
            downloadSpeed = String(Math.floor(task.bytesReceived / elapsed));
        }
    }

    const result: Aria2TellStatusResult = {
        gid: task.id,
        status: aria2Status,
        totalLength,
        completedLength,
        uploadLength: "0",
        downloadSpeed,
        uploadSpeed: "0",
        connections: task.status === "in_progress" ? "1" : "0",
        dir: task.request.directory ?? "",
        files: [buildFileResult(task)],
    };

    // Add error info if applicable
    if (task.status === "error" && task.error) {
        result.errorCode = toAria2ErrorCode(task.error);
        result.errorMessage = task.error;
    }

    return result;
}

/**
 * aria2.tellStatus([secret], gid, [keys])
 *
 * Returns the progress of the download denoted by gid.
 * If keys is specified, the response only contains those keys.
 */
export async function tellStatus(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    const keys = params[1] as string[] | undefined;

    console.log(`${LOG_PREFIX} gid=${gid}, keys=`, keys);

    const result = buildTellStatusResult(gid);
    if (!result) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    const filtered = filterKeys(result as unknown as Record<string, unknown>, keys);
    return { jsonrpc: "2.0", id, result: filtered };
}