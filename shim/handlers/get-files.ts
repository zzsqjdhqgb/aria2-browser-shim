import { downloadManager } from "@/core/download-manager";
import type { DownloadTask } from "@/core/types";
import type { Aria2RpcResponse, Aria2FileResult } from "../types";
import * as errors from "../errors";
import { refreshTaskIfPossible } from "./task-refresh";

const LOG_PREFIX = "[Aria2:getFiles]";
const DEFAULT_PIECE_LENGTH = 1024 * 1024;

/**
 * Build a single Aria2FileResult from a DownloadTask.
 * Exported for reuse by tellStatus.
 */
export function buildFileResult(task: DownloadTask): Aria2FileResult {
    const filename = task.request.filename ?? extractFilenameFromUrl(task.request.url);
    const dir = task.request.directory ?? "";
    const path = dir ? `${dir}/${filename}` : filename;
    const totalLength = task.totalBytes > 0 ? task.totalBytes : 0;

    let completedLength = task.bytesReceived;
    if (totalLength > 0) {
        // aria2.getFiles reports completed bytes by fully completed pieces.
        const completedPieces = task.bytesReceived >= totalLength
            ? Math.ceil(totalLength / DEFAULT_PIECE_LENGTH)
            : Math.floor(task.bytesReceived / DEFAULT_PIECE_LENGTH);
        completedLength = Math.min(totalLength, completedPieces * DEFAULT_PIECE_LENGTH);
    }

    return {
        index: "1",
        path,
        length: String(totalLength),
        completedLength: String(completedLength),
        selected: "true",
        uris: [
            {
                uri: task.request.url,
                status: "used",
            },
        ],
    };
}

/**
 * Extract a reasonable filename from a URL.
 */
function extractFilenameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split("/");
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart) {
            return decodeURIComponent(lastPart);
        }
    } catch {
        // fall through
    }
    return "download";
}

/**
 * aria2.getFiles([secret], gid)
 *
 * Returns the file list of a download.
 * In our shim, each download has exactly one file.
 */
export async function getFiles(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} gid=${gid}`);

    await refreshTaskIfPossible(gid);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    return { jsonrpc: "2.0", id, result: [buildFileResult(task)] };
}