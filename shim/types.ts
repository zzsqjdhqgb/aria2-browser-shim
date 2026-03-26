/**
 * Aria2 JSON-RPC protocol types
 */

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
    error?: Aria2RpcError;
}

export interface Aria2RpcError {
    code: number;
    message: string;
}

/**
 * Aria2-style status strings (different from our internal DownloadStatus)
 */
export type Aria2Status = "active" | "waiting" | "paused" | "error" | "complete" | "removed";

/**
 * Aria2 tellStatus response shape
 * @see https://aria2.github.io/manual/en/html/aria2c.html#aria2.tellStatus
 */
export interface Aria2TellStatusResult {
    gid: string;
    status: Aria2Status;
    totalLength: string;
    completedLength: string;
    uploadLength: string;
    bitfield?: string;
    downloadSpeed: string;
    uploadSpeed: string;
    infoHash?: string;
    numSeeders?: string;
    seeder?: string;
    pieceLength?: string;
    numPieces?: string;
    connections: string;
    errorCode?: string;
    errorMessage?: string;
    followedBy?: string[];
    following?: string;
    belongsTo?: string;
    dir: string;
    files: Aria2FileResult[];
    bittorrent?: unknown;
}

/**
 * Aria2 getFiles response shape
 */
export interface Aria2FileResult {
    index: string;
    path: string;
    length: string;
    completedLength: string;
    selected: string;
    uris: Aria2UriResult[];
}

/**
 * Aria2 getUris / file uri entry
 */
export interface Aria2UriResult {
    uri: string;
    status: "used" | "waiting";
}

/**
 * Aria2 getServers response shape
 */
export interface Aria2ServerResult {
    index: string;
    servers: Array<{
        uri: string;
        currentUri: string;
        downloadSpeed: string;
    }>;
}

/**
 * Aria2 getVersion response
 */
export interface Aria2VersionResult {
    version: string;
    enabledFeatures: string[];
}

/**
 * Aria2 getSessionInfo response
 */
export interface Aria2SessionInfoResult {
    sessionId: string;
}

/**
 * Aria2 global stat
 */
export interface Aria2GlobalStatResult {
    downloadSpeed: string;
    uploadSpeed: string;
    numActive: string;
    numWaiting: string;
    numStopped: string;
    numStoppedTotal: string;
}

/**
 * Keys that can be requested in tellStatus
 */
export const TELL_STATUS_ALL_KEYS: readonly string[] = [
    "gid", "status", "totalLength", "completedLength", "uploadLength",
    "bitfield", "downloadSpeed", "uploadSpeed", "infoHash", "numSeeders",
    "seeder", "pieceLength", "numPieces", "connections", "errorCode",
    "errorMessage", "followedBy", "following", "belongsTo", "dir",
    "files", "bittorrent",
] as const;