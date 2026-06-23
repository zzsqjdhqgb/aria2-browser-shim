export type TaskStatus =
  | 'pending'
  | 'active'
  | 'waiting'
  | 'paused'
  | 'error'
  | 'complete'
  | 'removed';

export interface DownloadRequest {
  uris: string[];
  headers?: Record<string, string>;
  dir?: string;
  out?: string;
  split?: number;
}

export interface Aria2File {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: string;
  uris: Aria2Uri[];
}

export interface Aria2Uri {
  uri: string;
  status: string;
}

export interface DownloadTask {
  gid: string;
  uris: string[];
  status: TaskStatus;
  browserDownloadId: number | null;
  totalLength: number;
  completedLength: number;
  downloadSpeed: number;
  uploadSpeed: number;
  connections: number;
  dir: string;
  files: Aria2File[];
  errorCode: string | null;
  errorMessage: string | null;
  followedBy: string | null;
  following: string | null;
  belongsTo: string | null;
  bitfield: string;
  infoHash: string | null;
  numSeeders: string;
  seeder: string;
  pieceLength: string;
  numPieces: string;
  verifiedLength: string;
  verifyIntegrityPending: string;
  options: Aria2Option;
  createdAt: number;
  updatedAt: number;
  tabId: number | null;
  ruleId: number | null;
}

export interface Aria2Option {
  dir?: string;
  out?: string;
  split?: string;
  header?: string[];
  'max-connection-per-server'?: string;
  'check-certificate'?: string;
  'remote-time'?: string;
  'user-agent'?: string;
  referer?: string;
  'http-proxy'?: string;
  [key: string]: string | string[] | undefined;
}

export interface Aria2GlobalOption {
  'max-concurrent-downloads'?: string;
  'max-connection-per-server'?: string;
  'rpc-listen-port'?: string;
  'rpc-secret'?: string;
  dir?: string;
  [key: string]: string | undefined;
}

export interface Aria2Status {
  gid: string;
  status: TaskStatus;
  totalLength: string;
  completedLength: string;
  uploadLength: string;
  bitfield: string;
  downloadSpeed: string;
  uploadSpeed: string;
  infoHash: string;
  numSeeders: string;
  seeder: string;
  pieceLength: string;
  numPieces: string;
  connections: string;
  errorCode: string;
  errorMessage: string;
  followedBy: string[];
  following: string;
  belongsTo: string;
  dir: string;
  files: Aria2File[];
  bittorrent: Record<string, string>;
  verifiedLength: string;
  verifyIntegrityPending: string;
}

export interface Aria2Version {
  version: string;
  enabledFeatures: string[];
}

export interface Aria2GlobalStat {
  downloadSpeed: string;
  uploadSpeed: string;
  numActive: string;
  numWaiting: string;
  numStopped: string;
  numStoppedTotal: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
}

export interface ServerContext {
  downloadManager: unknown;
  taskStore: unknown;
  wsBridge: unknown;
  globalOptions: Aria2GlobalOption;
  sessionId: string;
  nextRuleId: number;
}

export const ARIA2_TARGET_ORIGINS = ['localhost:6800', '127.0.0.1:6800'];

export const ARIA2_ERRORS = {
  PARSE: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL: { code: -32603, message: 'Internal error' },
  UNKNOWN_GID: (gid: string): JsonRpcError => ({ code: 1, message: `Unknown GID ${gid}` }),
  NOT_SUPPORTED: (msg: string): JsonRpcError => ({ code: 4, message: msg }),
  FILE_IO: (msg: string): JsonRpcError => ({ code: 5, message: msg }),
  NOT_ACTIVE: (gid: string): JsonRpcError => ({ code: 8, message: `GID ${gid} is not active` }),
};
