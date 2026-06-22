import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './system-multicall';

beforeEach(() => {
  vi.stubGlobal('browser', {
    downloads: {
      onCreated: { addListener: vi.fn() },
      onChanged: { addListener: vi.fn() },
    },
    storage: {
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('system.multicall', () => {
  it('executes multiple sub-requests and wraps results', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx({
      downloadManager: {
        getTask: vi.fn().mockReturnValue({
          gid: 'gid1',
          request: { url: 'https://example.com/file.zip', filename: 'file.zip' },
          status: 'in_progress',
          bytesReceived: 0,
          totalBytes: 0,
          createdAt: Date.now(),
        }),
      } as unknown as DownloadManager,
    });

    registry.register('aria2.getVersion', async () => ({
      version: '1.37.0-shim',
      enabledFeatures: [],
    }));

    registry.register('aria2.tellStatus', async (params: unknown[], handlerCtx: HandlerContext) => {
      const gid = params[0] as string;
      const task = handlerCtx.downloadManager.getTask(gid);
      if (!task) throw new Error(`Unknown GID: ${gid}`);
      return { gid: task.gid, status: 'active' };
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'system.multicall',
      params: [[
        { methodName: 'aria2.getVersion', params: [] },
        { methodName: 'aria2.tellStatus', params: ['gid1'] },
      ]],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const results = response.result as unknown[][];

    expect(results).toHaveLength(2);
    // First result is success: [result]
    expect(results[0]).toHaveLength(1);
    expect(results[0][0]).toHaveProperty('version');
    // Second result is success: [result]
    expect(results[1]).toHaveLength(1);
    expect((results[1][0] as Record<string, unknown>).gid).toBe('gid1');
  });

  it('wraps errors as [{ code, message }]', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    registry.register('aria2.addUri', async () => {
      throw new Error('Download failed');
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'system.multicall',
      params: [[
        { methodName: 'aria2.addUri', params: [['http://example.com']] },
      ]],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const results = response.result as unknown[][];

    expect(results).toHaveLength(1);
    // Error is wrapped as [{ code, message }]
    const errorResult = results[0][0] as { code: number; message: string };
    expect(errorResult.code).toBe(-32603);
    expect(errorResult.message).toContain('Download failed');
  });

  it('handles unknown method in sub-request', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'system.multicall',
      params: [[
        { methodName: 'aria2.unknownMethod', params: [] },
      ]],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const results = response.result as unknown[][];

    expect(results).toHaveLength(1);
    const errorResult = results[0][0] as { code: number; message: string };
    expect(errorResult.code).toBe(-32601);
    expect(errorResult.message).toContain('unknownMethod');
  });

  it('handles empty array of sub-requests', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '4',
      method: 'system.multicall',
      params: [[]],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    expect(response.result).toEqual([]);
  });

  it('continues processing after individual sub-request failure', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx({
      downloadManager: {
        getTask: vi.fn().mockReturnValue({
          gid: 'gid1',
          request: { url: 'https://example.com/file.zip' },
          status: 'in_progress',
          bytesReceived: 0,
          totalBytes: 0,
          createdAt: Date.now(),
        }),
      } as unknown as DownloadManager,
    });

    registry.register('aria2.getVersion', async () => ({ version: '1.37.0-shim' }));
    registry.register('aria2.tellStatus', async (params: unknown[], handlerCtx: HandlerContext) => {
      const gid = params[0] as string;
      const task = handlerCtx.downloadManager.getTask(gid);
      if (!task) throw new Error('Unknown GID');
      return { gid: task.gid, status: 'active' };
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '5',
      method: 'system.multicall',
      params: [[
        { methodName: 'aria2.unknownMethod', params: [] },
        { methodName: 'aria2.getVersion', params: [] },
        { methodName: 'aria2.tellStatus', params: ['gid1'] },
      ]],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const results = response.result as unknown[][];

    expect(results).toHaveLength(3);
    // First failed
    expect((results[0][0] as { code: number }).code).toBe(-32601);
    // Second succeeded
    expect(results[1][0]).toHaveProperty('version');
    // Third succeeded
    expect((results[2][0] as Record<string, unknown>).gid).toBe('gid1');
  });
});
