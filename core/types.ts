/**
 * Download request provided by the caller — pure HTTP download semantics
 * Unrelated to any RPC protocol
 */
export interface DownloadRequest {
    /** Download URL (HTTP/HTTPS) */
    url: string;

    /** File name to save, e.g., "video.mp4" */
    filename?: string;

    /**
     * Subdirectory to save the file (relative to the browser's default download directory)
     * For example, "MyFolder/sub" → <Downloads>/MyFolder/sub/video.mp4
     */
    directory?: string;

    /**
     * HTTP request headers to inject
     * browser.downloads itself does not support custom headers,
     * so they need to be injected via declarativeNetRequest
     */
    headers?: Record<string, string>;
}

/**
 * Runtime state of a download task
 */
export interface DownloadTask {
    /** Internal unique identifier (16-char hex) */
    id: string;

    /** Browser's native download ID from browser.downloads API */
    browserDownloadId?: number;

    /** Original download request */
    request: DownloadRequest;

    /** Current task status */
    status: DownloadStatus;

    /** Bytes downloaded so far */
    bytesReceived: number;

    /** Total file size in bytes (-1 if unknown) */
    totalBytes: number;

    /** Error message if status is 'error' */
    error?: string;

    /** Timestamp when task was created */
    createdAt: number;

    /** Timestamp when task completed (success or failure) */
    completedAt?: number;
}

export type DownloadStatus =
    | "pending"
    | "in_progress"
    | "paused"
    | "complete"
    | "error"
    | "cancelled";

/**
 * Query filter conditions for tasks
 */
export interface TaskQuery {
    status?: DownloadStatus | DownloadStatus[];
    limit?: number;
    offset?: number;
}

/**
 * Callback for task status changes
 */
export type TaskChangeListener = (task: DownloadTask) => void;