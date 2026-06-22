import { MethodRegistry } from './rpc/dispatcher';
import type { HandlerContext, Aria2RpcResponse, Aria2RpcRequest } from './rpc/types';

// Message type constants for content script <-> background communication
export const MSG_ARIA2_RPC = 'aria2-rpc';
export const MSG_GET_SETTINGS = 'get-settings';
export const MSG_UPDATE_SETTINGS = 'update-settings';
export const MSG_GET_POPUP_STATE = 'get-popup-state';
export const MSG_UPDATE_PER_SITE = 'update-per-site';

/**
 * Validates that a payload is a valid JSON-RPC request: either an object
 * with a `method` property, or an array.  Dispatches valid payloads to the
 * provided MethodRegistry.  Returns a JSON-RPC parse-error response for
 * invalid payloads.
 */
export async function handleAria2RpcMessage(
  payload: unknown,
  registry: MethodRegistry,
  ctx: HandlerContext,
): Promise<Aria2RpcResponse | Aria2RpcResponse[]> {
  if (!isValidRpcPayload(payload)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    };
  }

  return registry.dispatch(payload as Aria2RpcRequest | Aria2RpcRequest[], ctx);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRpcPayload(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return true;
  }

  return isObject(payload) && typeof payload.method === 'string';
}
