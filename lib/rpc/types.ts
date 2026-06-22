import type { DownloadManager } from '../download-manager';
import type { AppSettings } from '../types';
import { SessionStore, LocalStore } from '../storage';

export interface Aria2RpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown[];
}

export interface Aria2RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: Aria2RpcError;
}

export interface Aria2RpcError {
  code: number;
  message: string;
}

export interface HandlerContext {
  downloadManager: DownloadManager;
  settings: AppSettings;
  store: {
    session: typeof SessionStore;
    local: typeof LocalStore;
  };
}

export type MethodHandler = (
  params: unknown[],
  ctx: HandlerContext,
) => Promise<unknown>;

export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000,
} as const;
