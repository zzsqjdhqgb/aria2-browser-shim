import type { JsonRpcRequest, JsonRpcResponse, JsonRpcError } from './types';
import { ARIA2_ERRORS } from './types';

type MethodFn = (params: unknown[]) => Promise<unknown>;

export class Aria2Server {
  private methods: Record<string, MethodFn>;
  private token: string | null;

  constructor(methods: Record<string, MethodFn>, options: { token?: string } = {}) {
    this.methods = methods;
    this.token = options.token || null;
  }

  async handleRequest(
    body: unknown
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    let parsed: JsonRpcRequest | JsonRpcRequest[];
    try {
      if (typeof body === 'string') {
        parsed = JSON.parse(body);
      } else if (typeof body === 'object' && body !== null) {
        parsed = body as JsonRpcRequest | JsonRpcRequest[];
      } else {
        return this.errorResponse(null, ARIA2_ERRORS.PARSE);
      }
    } catch {
      return this.errorResponse(null, ARIA2_ERRORS.PARSE);
    }

    if (Array.isArray(parsed)) {
      const results = await Promise.all(
        parsed.map((req) => this.handleSingle(req))
      );
      return results.filter((r): r is JsonRpcResponse => r !== null);
    }

    return this.handleSingle(parsed);
  }

  private async handleSingle(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse | null> {
    const isNotification = request.id === undefined || request.id === null;

    if (request.jsonrpc !== '2.0') {
      if (isNotification) return null;
      return this.errorResponse(request.id, ARIA2_ERRORS.INVALID_REQUEST);
    }

    if (!request.method || typeof request.method !== 'string') {
      if (isNotification) return null;
      return this.errorResponse(request.id, ARIA2_ERRORS.INVALID_REQUEST);
    }

    let params = request.params || [];
    if (!Array.isArray(params)) {
      params = [params];
    }

    if (this.token) {
      const firstParam = params[0];
      if (typeof firstParam === 'string' && firstParam.startsWith('token:')) {
        const providedToken = firstParam.slice(6);
        if (providedToken !== this.token) {
          if (isNotification) return null;
          return this.errorResponse(request.id, {
            code: -32600,
            message: 'Invalid token',
          });
        }
        params = params.slice(1);
      } else {
        if (isNotification) return null;
        return this.errorResponse(request.id, {
          code: -32600,
          message: 'Token required',
        });
      }
    }

    const fn = this.methods[request.method];
    if (!fn) {
      if (isNotification) return null;
      return this.errorResponse(request.id, ARIA2_ERRORS.METHOD_NOT_FOUND);
    }

    try {
      const result = await fn(params);
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (err: any) {
      if (isNotification) return null;
      return this.errorResponse(request.id, {
        code: err.code ?? ARIA2_ERRORS.INTERNAL.code,
        message: err.message ?? ARIA2_ERRORS.INTERNAL.message,
      });
    }
  }

  handleNotification(method: string, params: unknown[]): void {
    const fn = this.methods[method];
    if (fn) {
      fn(params).catch(() => {});
    }
  }

  private errorResponse(
    id: string | number | null,
    error: JsonRpcError
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error,
    };
  }
}
