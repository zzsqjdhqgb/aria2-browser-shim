import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './tell-status';

function createMockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '4800000000000001',
    request: {
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
      directory: '/downloads',
    },
    status: 'in_progress',
    bytesReceived: 1024,
    totalBytes: 2048,
    createdAt: Date.now(),
    ...overrides,
  };
}

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

describe('aria2.tellStatus', () => {
  it('returns "active" status for in_progress task', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({ status: 'in_progress' });
    const getTaskMock = vi.fn().mockReturnValue(task);
    const ctx = createMockCtx({
      downloadManager: { getTask: getTaskMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.tellStatus',
      params: ['4800000000000001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;

    expect(response.error).toBeUndefined();
    expect(result.status).toBe('active');
    expect(result.gid).toBe('4800000000000001');
    expect(getTaskMock).toHaveBeenCalledWith('4800000000000001');
  });

  it('maps paused to "paused"', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({ status: 'paused' });
    const getTaskMock = vi.fn().mockReturnValue(task);
    const ctx = createMockCtx({
      downloadManager: { getTask: getTaskMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '2', method: 'aria2.tellStatus',
      params: ['gid2'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    expect((response.result as Record<string, unknown>).status).toBe('paused');
  });

  it('maps pending to "waiting"', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({ status: 'pending' });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });
    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '3', method: 'aria2.tellStatus', params: ['gid3'] };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    expect((response.result as Record<string, unknown>).status).toBe('waiting');
  });

  it('maps complete to "complete"', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({ status: 'complete', completedAt: Date.now() });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });
    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '4', method: 'aria2.tellStatus', params: ['gid4'] };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    expect((response.result as Record<string, unknown>).status).toBe('complete');
  });

  it('maps error to "error"', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({ status: 'error', error: 'Network failure' });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });
    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '5', method: 'aria2.tellStatus', params: ['gid5'] };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('1');
    expect(result.errorMessage).toBe('Network failure');
  });

  it('maps cancelled to "removed"', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({ status: 'cancelled' });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });
    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '6', method: 'aria2.tellStatus', params: ['gid6'] };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    expect((response.result as Record<string, unknown>).status).toBe('removed');
  });

  it('throws error for unknown GID', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(undefined) } as unknown as DownloadManager,
    });
    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '7', method: 'aria2.tellStatus', params: ['nonexistent'] };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('Unknown GID');
  });

  it('includes files array with URI data', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      request: { url: 'https://example.com/video.mp4', filename: 'video.mp4' },
    });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });
    register(registry);
    const req: Aria2RpcRequest = { jsonrpc: '2.0', id: '8', method: 'aria2.tellStatus', params: ['gid8'] };
    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Record<string, unknown>;
    const files = result.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('video.mp4');
    expect(files[0].uris).toEqual([{ uri: 'https://example.com/video.mp4', status: 'used' }]);
  });
});
