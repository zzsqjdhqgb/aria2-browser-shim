import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext, Aria2RpcResponse } from '../types';

interface MulticallSubRequest {
  methodName: string;
  params: unknown[];
}

export function register(registry: MethodRegistry): void {
  registry.register('system.multicall', async (params: unknown[], ctx: HandlerContext) => {
    const subRequests = params[0] as MulticallSubRequest[];
    if (!Array.isArray(subRequests)) {
      throw new Error('system.multicall requires an array of method calls');
    }

    const results: unknown[] = [];

    for (const sub of subRequests) {
      try {
        const response: Aria2RpcResponse = await registry.dispatch(
          {
            jsonrpc: '2.0',
            id: null,
            method: sub.methodName,
            params: sub.params,
          },
          ctx,
        ) as Aria2RpcResponse;

        if (response.error) {
          results.push([{ code: response.error.code, message: response.error.message }]);
        } else {
          results.push([response.result]);
        }
      } catch {
        results.push([{ code: -32603, message: 'Internal error in multicall' }]);
      }
    }

    return results;
  });
}
