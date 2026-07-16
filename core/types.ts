// =============================================================================
// Aria2 JSON-RPC 2.0 protocol types
// =============================================================================

export interface Aria2RpcRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: string;
    params?: unknown[];
}

export interface Aria2RpcResponse {
    jsonrpc: "2.0";
    id: string | number;
    result?: unknown;
    error?: { code: number; message: string };
}

export interface Aria2VersionResult {
    version: string;
    enabledFeatures: string[];
}

/** Aria2 task status as returned in RPC responses */
export type Aria2TaskStatus = "active" | "waiting" | "paused" | "error" | "complete" | "removed";

/** Full aria2 task info returned by tellStatus */
export interface Aria2TaskInfo {
    gid: string;
    status: Aria2TaskStatus;
    totalLength: string;
    completedLength: string;
    uploadLength: string;
    downloadSpeed: string;
    uploadSpeed: string;
    dir?: string;
    files?: Aria2FileInfo[];
    errorCode?: string;
    errorMessage?: string;
    followedBy?: string[];
    following?: string;
    belongsTo?: string;
}

export interface Aria2FileInfo {
    index: string;
    path: string;
    length: string;
    completedLength: string;
    selected: string;
    uris: Aria2UriInfo[];
}

export interface Aria2UriInfo {
    uri: string;
    status: string;
}

export interface Aria2GlobalStat {
    downloadSpeed: string;
    uploadSpeed: string;
    numActive: string;
    numWaiting: string;
    numStopped: string;
    numStoppedTotal: string;
}

export interface Aria2SessionInfo {
    sessionId: string;
}

/** A single call within a system.multicall batch */
export interface MultiCallItem {
    methodName: string;
    params: unknown[];
}

// =============================================================================
// Internal download task types
// =============================================================================

export interface DownloadRequest {
    url: string;
    urls?: string[];
    filename?: string;
    directory?: string;
    headers?: Record<string, string>;
    position?: number;
}

export interface DownloadTask {
    id: string;
    url: string;
    started: boolean;
    browserDownloadId?: number;
    request: DownloadRequest;
    status: InternalStatus;
    bytesReceived: number;
    totalBytes: number;
    speed: number;
    error?: string;
    errorCode?: string;
    createdAt: number;
    completedAt?: number;
}

export type InternalStatus = "pending" | "in_progress" | "paused" | "complete" | "error" | "cancelled";

export const TERMINAL_STATUSES: ReadonlySet<InternalStatus> = new Set([
    "complete", "error", "cancelled",
]);

export function toAria2Status(s: InternalStatus): Aria2TaskStatus {
    switch (s) {
        case "pending":    return "waiting";
        case "in_progress": return "active";
        case "paused":     return "paused";
        case "complete":   return "complete";
        case "error":      return "error";
        case "cancelled":  return "removed";
    }
}

export interface TaskQuery {
    status?: InternalStatus | InternalStatus[];
    limit?: number;
    offset?: number;
}

export type TaskChangeListener = (task: DownloadTask) => void;

// =============================================================================
// Storage types
// =============================================================================

export interface AppSettings {
    enabled: boolean;
    defaultDir: string;
    maxHistory: number;
    rpcSecret: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
    enabled: true,
    defaultDir: "",
    maxHistory: 500,
    rpcSecret: "",
};

export interface StoredTask {
    id: string;
    url: string;
    browserDownloadId?: number;
    filename: string;
    directory: string;
    status: InternalStatus;
    bytesReceived: number;
    totalBytes: number;
    error?: string;
    createdAt: number;
    completedAt?: number;
}
