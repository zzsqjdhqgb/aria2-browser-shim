import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './get-global-stat';

function createMockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '4800000000000001',
    request: { url: 'https://example.com/file.zip' },
    status: 'in_progress',
    bytesReceived: 0,
    totalBytes: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

function createMockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    downloadManager: {} as DownloadManager,
    settings: { ...DEFAULT_SETTINGS },
    store: {
      session: { putTask: vi.fn(), getTask: vi.fn(), getAllTasks: vi.fn(), removeTask: vi.fn() },
      local: { getSettings: vi.fn(), putSettings: vi.fn(), getPerSiteEnabled: vi.fn(), setPerSiteEnabled: vi.fn(), getDownloadHistory: vi.fn(), addToHistory: vi.fn() },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('browser', {
    downloads: { onCreated: { addListener: vi.fn() }, onChanged: { addListener: vi.fn() } },
    storage: {
      session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aria2.getGlobalStat', () => {
  it('returns zeros when no tasks exist', async () => {
    const registry = new MethodRegistry();
    const queryTasksMock = vi.fn().mockReturnValue([]);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '1', method: 'aria2.getGlobalStat',
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(result.numActive).toBe('0');
    expect(result.numWaiting).toBe('0');
    expect(result.numStopped).toBe('0');
    expect(result.downloadSpeed).toBe('0');
    expect(result.uploadSpeed).toBe('0');
  });

  it('counts active tasks', async () => {
    const registry = new MethodRegistry();
    const tasks: DownloadTask[] = [
      createMockTask({ gid: 'g1', status: 'in_progress' }),
      createMockTask({ gid: 'g2', status: 'in_progress' }),
      createMockTask({ gid: 'g3', status: 'in_progress' }),
    ];
    const ctx = createMockCtx({
      downloadManager: { queryTasks: vi.fn().mockReturnValue(tasks) } as unknown as DownloadManager,
    });

    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '2', method: 'aria2.getGlobalStat' };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(result.numActive).toBe('3');
    expect(result.numWaiting).toBe('0');
    expect(result.numStopped).toBe('0');
  });

  it('counts waiting (pending + paused) tasks', async () => {
    const registry = new MethodRegistry();
    const tasks: DownloadTask[] = [
      createMockTask({ gid: 'g1', status: 'pending' }),
      createMockTask({ gid: 'g2', status: 'paused' }),
    ];
    const ctx = createMockCtx({
      downloadManager: { queryTasks: vi.fn().mockReturnValue(tasks) } as unknown as DownloadManager,
    });

    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '3', method: 'aria2.getGlobalStat' };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(result.numActive).toBe('0');
    expect(result.numWaiting).toBe('2');
    expect(result.numStopped).toBe('0');
  });

  it('counts stopped (complete/error/cancelled) tasks', async () => {
    const registry = new MethodRegistry();
    const tasks: DownloadTask[] = [
      createMockTask({ gid: 'g1', status: 'complete' }),
      createMockTask({ gid: 'g2', status: 'error' }),
      createMockTask({ gid: 'g3', status: 'cancelled' }),
    ];
    const ctx = createMockCtx({
      downloadManager: { queryTasks: vi.fn().mockReturnValue(tasks) } as unknown as DownloadManager,
    });

    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '4', method: 'aria2.getGlobalStat' };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(result.numStopped).toBe('3');
    expect(result.numStoppedTotal).toBe('3');
  });

  it('returns mixed counts', async () => {
    const registry = new MethodRegistry();
    const tasks: DownloadTask[] = [
      createMockTask({ gid: 'g1', status: 'in_progress' }),
      createMockTask({ gid: 'g2', status: 'in_progress' }),
      createMockTask({ gid: 'g3', status: 'pending' }),
      createMockTask({ gid: 'g4', status: 'complete' }),
      createMockTask({ gid: 'g5', status: 'error' }),
    ];
    const ctx = createMockCtx({
      downloadManager: { queryTasks: vi.fn().mockReturnValue(tasks) } as unknown as DownloadManager,
    });

    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '5', method: 'aria2.getGlobalStat' };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(result.numActive).toBe('2');
    expect(result.numWaiting).toBe('1');
    expect(result.numStopped).toBe('2');
  });

  it('returns all values as strings', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx({
      downloadManager: { queryTasks: vi.fn().mockReturnValue([createMockTask()]) } as unknown as DownloadManager,
    });

    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '6', method: 'aria2.getGlobalStat' };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(typeof result.numActive).toBe('string');
    expect(typeof result.numWaiting).toBe('string');
    expect(typeof result.numStopped).toBe('string');
    expect(typeof result.downloadSpeed).toBe('string');
  });
});
