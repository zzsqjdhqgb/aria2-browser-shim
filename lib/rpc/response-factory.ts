import type { Aria2RpcResponse } from './types';
import { ErrorCode } from './types';

export { ErrorCode };

/**
 * Creates a JSON-RPC 2.0 success response.
 */
export function successResponse(
  id: string | number | null,
  result: unknown,
): Aria2RpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Creates a JSON-RPC 2.0 error response.
 */
export function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): Aria2RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Creates a METHOD_NOT_FOUND error response for unimplemented methods.
 */
export function notImplementedResponse(
  id: string | number | null,
): Aria2RpcResponse {
  return errorResponse(id, ErrorCode.METHOD_NOT_FOUND, 'Method not found');
}

/**
 * Creates an INTERNAL_ERROR response, extracting the message from an Error,
 * a string, or converting via String().
 */
export function internalErrorResponse(
  id: string | number | null,
  err: unknown,
): Aria2RpcResponse {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err);
  return errorResponse(id, ErrorCode.INTERNAL_ERROR, message);
}

/**
 * Creates a SERVER_ERROR response indicating a feature is not supported
 * by this browser-based aria2 emulator.
 */
export function notSupportedResponse(
  id: string | number | null,
  feature: string,
): Aria2RpcResponse {
  return errorResponse(
    id,
    ErrorCode.SERVER_ERROR,
    `${feature} is not supported — this is a browser-based aria2 emulator`,
  );
}
