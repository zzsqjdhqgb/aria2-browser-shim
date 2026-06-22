import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext, MethodHandler } from './types';
import { ErrorCode } from './types';
import { errorResponse, internalErrorResponse } from './response-factory';

export class MethodRegistry {
  private methods = new Map<string, MethodHandler>();

  /**
   * Registers a handler for a given RPC method name.
   */
  register(method: string, handler: MethodHandler): void {
    this.methods.set(method, handler);
  }

  /**
   * Dispatches a single request or a batch of requests.
   * Batch requests are processed in parallel with isolated error handling.
   */
  async dispatch(
    req: Aria2RpcRequest | Aria2RpcRequest[],
    ctx: HandlerContext,
  ): Promise<Aria2RpcResponse | Aria2RpcResponse[]> {
    if (Array.isArray(req)) {
      return Promise.all(req.map((r) => this.dispatchSingle(r, ctx)));
    }
    return this.dispatchSingle(req, ctx);
  }

  /**
   * Dispatches a single JSON-RPC request to the registered handler.
   */
  private async dispatchSingle(
    req: Aria2RpcRequest,
    ctx: HandlerContext,
  ): Promise<Aria2RpcResponse> {
    const id = req.id;

    // Validate JSON-RPC version
    if (req.jsonrpc !== '2.0') {
      return errorResponse(id, ErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC version');
    }

    // Look up handler
    const handler = this.methods.get(req.method);
    if (!handler) {
      return errorResponse(
        id,
        ErrorCode.METHOD_NOT_FOUND,
        `Method "${req.method}" not found`,
      );
    }

    // Execute handler
    try {
      const result = await handler(req.params ?? [], ctx);
      return { jsonrpc: '2.0', id, result };
    } catch (err: unknown) {
      return internalErrorResponse(id, err);
    }
  }
}
