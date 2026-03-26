import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2GlobalStatResult } from "../types";

const LOG_PREFIX = "[Aria2:getGlobalStat]";

/**
 * aria2.getGlobalStat([secret])
 *
 * Returns overall statistics such as download/upload speed, number of
 * active/waiting/stopped downloads.
 */
export async function getGlobalStat(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} Calculating global stats`);

    const active = downloadManager.queryTasks({ status: "in_progress" });
    const waiting = downloadManager.queryTasks({ status: ["pending", "paused"] });
    const stopped = downloadManager.queryTasks({
        status: ["complete", "error", "cancelled"],
    });

    // Aggregate download speed from all active tasks
    let totalDownloadSpeed = 0;
    for (const task of active) {
        if (task.bytesReceived > 0 && task.createdAt) {
            const elapsed = (Date.now() - task.createdAt) / 1000;
            if (elapsed > 0) {
                totalDownloadSpeed += Math.floor(task.bytesReceived / elapsed);
            }
        }
    }

    const result: Aria2GlobalStatResult = {
        downloadSpeed: String(totalDownloadSpeed),
        uploadSpeed: "0",
        numActive: String(active.length),
        numWaiting: String(waiting.length),
        numStopped: String(stopped.length),
        numStoppedTotal: String(stopped.length),
    };

    console.log(`${LOG_PREFIX} Stats:`, result);
    return { jsonrpc: "2.0", id, result };
}