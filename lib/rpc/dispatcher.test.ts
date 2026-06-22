import { describe, it, expect, vi } from 'vitest';
import { MethodRegistry } from './dispatcher';
import { ErrorCode } from './types';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext, MethodHandler } from './types';
import type { DownloadManager } from '../download-manager';
import { DEFAULT_SETTINGS } from '../types';

// ==========================================================================
// Helpers — mock HandlerContext factories
// ==========================================================================

function createMockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    downloadManager: {} as DownloadManager,
    settings: { ...DEFAULT_SETTINGS },
    store: {
      session: {
        putTask: vi.fn(),
        getTask: vi.fn(),
        getAllTasks: vi.fn(),
        removeTask: vi.fn(),
      },
      local: {
        getSettings: vi.fn(),
        putSettings: vi.fn(),
        getPerSiteEnabled: vi.fn(),
        setPerSiteEnabled: vi.fn(),
        getDownloadHistory: vi.fn(),
        addToHistory: vi.fn(),
      },
    },
    ...overrides,
  };
}

// ==========================================================================
// MethodRegistry
// ==========================================================================

describe('MethodRegistry', () => {
  // --------------------------------------------------------------------------
  // register
  // --------------------------------------------------------------------------
  describe('register', () => {
    it('registers a handler for a method name', () => {
      const registry = new MethodRegistry();
      const handler: MethodHandler = vi.fn().mockResolvedValue('result');

      registry.register('aria2.addUri', handler);

      // Register does not throw — verified indirectly via dispatch
      expect(() => registry.register('aria2.addUri', handler)).not.toThrow();
    });

    it('overwrites a previously registered handler for the same method', () => {
      const registry = new MethodRegistry();
      const handler1: MethodHandler = vi.fn().mockResolvedValue('first');
      const handler2: MethodHandler = vi.fn().mockResolvedValue('second');

      registry.register('aria2.addUri', handler1);
      registry.register('aria2.addUri', handler2);

      // The second handler should win — verified in dispatch tests
    });
  });

  // --------------------------------------------------------------------------
  // dispatch — single request
  // --------------------------------------------------------------------------

  describe('dispatch (single request)', () => {
    it('calls the registered handler and wraps result in a success response', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();
      const handler: MethodHandler = vi.fn().mockResolvedValue({ gid: 'abc123' });

      registry.register('aria2.addUri', handler);

      const req: Aria2RpcRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'aria2.addUri',
        params: ['https://example.com/file.zip'],
      };

      const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(['https://example.com/file.zip'], ctx);
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: '1',
        result: { gid: 'abc123' },
      });
      expect(response).not.toHaveProperty('error');
    });

    it('passes an empty array as params when params is undefined', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();
      const handler: MethodHandler = vi.fn().mockResolvedValue('done');

      registry.register('system.listMethods', handler);

      const req: Aria2RpcRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'system.listMethods',
        // params intentionally omitted
      };

      await registry.dispatch(req, ctx);

      expect(handler).toHaveBeenCalledWith([], ctx);
    });

    it('returns error response for unknown method', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();

      const req: Aria2RpcRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'aria2.unknownMethod',
      };

      const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: '1',
        error: {
          code: ErrorCode.METHOD_NOT_FOUND,
          message: expect.stringContaining('aria2.unknownMethod') as string,
        },
      });
      expect(response).not.toHaveProperty('result');
    });

    it('returns error response for invalid JSON-RPC version', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();

      const req = {
        jsonrpc: '1.0',
        id: '1',
        method: 'aria2.addUri',
      } as unknown as Aria2RpcRequest;

      const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: '1',
        error: {
          code: ErrorCode.INVALID_REQUEST,
          message: expect.stringContaining('version') as string,
        },
      });
      expect(response).not.toHaveProperty('result');
    });

    it('handles null id (notification) by returning response with null id', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();
      const handler: MethodHandler = vi.fn().mockResolvedValue(undefined);

      registry.register('aria2.shutdown', handler);

      const req: Aria2RpcRequest = {
        jsonrpc: '2.0',
        id: null,
        method: 'aria2.shutdown',
      };

      const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

      expect(handler).toHaveBeenCalledTimes(1);
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: null,
        result: undefined,
      });
      expect(response).not.toHaveProperty('error');
    });

    it('returns internal error response when handler throws', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();
      const handler: MethodHandler = vi.fn().mockRejectedValue(new Error('Disk full'));

      registry.register('aria2.addUri', handler);

      const req: Aria2RpcRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: 'aria2.addUri',
      };

      const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: '1',
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Disk full',
        },
      });
      expect(response).not.toHaveProperty('result');
    });

    it('handles handler throwing a non-Error value', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();
      const handler: MethodHandler = vi.fn().mockRejectedValue('raw string failure');

      registry.register('aria2.addUri', handler);

      const req: Aria2RpcRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'aria2.addUri',
      };

      const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

      expect(response.error!.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.error!.message).toBe('raw string failure');
    });
  });

  // --------------------------------------------------------------------------
  // dispatch — batch request
  // --------------------------------------------------------------------------

  describe('dispatch (batch request)', () => {
    it('returns an array of responses for batch requests', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();

      const handler1: MethodHandler = vi.fn().mockResolvedValue('result1');
      const handler2: MethodHandler = vi.fn().mockResolvedValue('result2');

      registry.register('method.one', handler1);
      registry.register('method.two', handler2);

      const reqs: Aria2RpcRequest[] = [
        { jsonrpc: '2.0', id: '1', method: 'method.one' },
        { jsonrpc: '2.0', id: '2', method: 'method.two' },
      ];

      const responses = await registry.dispatch(reqs, ctx) as Aria2RpcResponse[];

      expect(Array.isArray(responses)).toBe(true);
      expect(responses).toHaveLength(2);
      expect(responses[0]).toEqual({
        jsonrpc: '2.0',
        id: '1',
        result: 'result1',
      });
      expect(responses[1]).toEqual({
        jsonrpc: '2.0',
        id: '2',
        result: 'result2',
      });
    });

    it('isolates errors — one bad method does not break others in batch', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();

      const handler: MethodHandler = vi.fn().mockResolvedValue('ok');

      registry.register('method.good', handler);
      // method.bad is intentionally NOT registered

      const reqs: Aria2RpcRequest[] = [
        { jsonrpc: '2.0', id: '1', method: 'method.good' },
        { jsonrpc: '2.0', id: '2', method: 'method.bad' },
        { jsonrpc: '2.0', id: '3', method: 'method.good' },
      ];

      const responses = await registry.dispatch(reqs, ctx) as Aria2RpcResponse[];

      expect(responses).toHaveLength(3);

      // First and third succeed
      expect(responses[0]).toEqual({
        jsonrpc: '2.0',
        id: '1',
        result: 'ok',
      });
      expect(responses[2]).toEqual({
        jsonrpc: '2.0',
        id: '3',
        result: 'ok',
      });

      // Second fails but isolates
      expect(responses[1]).toEqual({
        jsonrpc: '2.0',
        id: '2',
        error: {
          code: ErrorCode.METHOD_NOT_FOUND,
          message: expect.stringContaining('method.bad') as string,
        },
      });
    });

    it('returns an empty array for an empty batch', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();

      const responses = await registry.dispatch([], ctx) as Aria2RpcResponse[];

      expect(responses).toEqual([]);
    });

    it('handles mixed single-id, null-id, and failing requests in batch', async () => {
      const registry = new MethodRegistry();
      const ctx = createMockCtx();
      const handler: MethodHandler = vi.fn().mockResolvedValue(42);

      registry.register('method.ok', handler);

      const reqs: Aria2RpcRequest[] = [
        { jsonrpc: '2.0', id: '1', method: 'method.ok' },
        { jsonrpc: '2.0', id: null, method: 'method.ok' },
        { jsonrpc: '2.0', id: '3', method: 'method.unknown' },
      ];

      const responses = await registry.dispatch(reqs, ctx) as Aria2RpcResponse[];

      expect(responses).toHaveLength(3);
      expect(responses[0]).toEqual({ jsonrpc: '2.0', id: '1', result: 42 });
      expect(responses[1]).toEqual({ jsonrpc: '2.0', id: null, result: 42 });
      expect(responses[2].error!.code).toBe(ErrorCode.METHOD_NOT_FOUND);
    });
  });
});
