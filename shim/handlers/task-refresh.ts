import { downloadManager } from "@/core/download-manager";

/**
 * downloads.onChanged does not carry bytesReceived in our browser typings,
 * so we refresh from downloads.search before reporting progress-sensitive data.
 */
export async function refreshTaskIfPossible(taskId: string): Promise<void> {
    const snapshot = downloadManager.getTask(taskId);
    if (!snapshot || snapshot.browserDownloadId === undefined) {
        return;
    }

    try {
        await downloadManager.refreshTask(taskId);
    } catch {
        // Ignore refresh failures and let callers return best-effort status.
    }
}
