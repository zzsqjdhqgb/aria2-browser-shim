import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './tell-waiting';

function createMockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '4800000000000001',
    request: {
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
    },
    status: 'pending',
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

describe('aria2.tellWaiting', () => {
  it('returns waiting tasks with status "pending"', async () => {
    const registry = new MethodRegistry();
    const tasks = [
      createMockTask({ gid: '001', status: 'pending' }),
      createMockTask({ gid: '002', status: 'pending' }),
    ];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.tellWaiting',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('waiting');
    expect(result[0].gid).toBe('001');
    expect(result[1].status).toBe('waiting');
    expect(result[1].gid).toBe('002');
    expect(queryTasksMock).toHaveBeenCalledWith({ status: 'pending', offset: undefined, limit: undefined });
  });

  it('supports offset and num options from params', async () => {
    const registry = new MethodRegistry();
    const tasks = [createMockTask({ gid: '003', status: 'pending' })];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.tellWaiting',
      params: [{ offset: 3, num: 5 }],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeUndefined();
    expect(queryTasksMock).toHaveBeenCalledWith({ status: 'pending', offset: 3, limit: 5 });
  });

  it('returns empty array when no waiting tasks', async () => {
    const registry = new MethodRegistry();
    const queryTasksMock = vi.fn().mockReturnValue([]);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'aria2.tellWaiting',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('does not include non-pending tasks', async () => {
    const registry = new MethodRegistry();
    const tasks = [createMockTask({ gid: '004', status: 'pending' })];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '4',
      method: 'aria2.tellWaiting',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(queryTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(response.error).toBeUndefined();
  });

  it('formats task with mapped "waiting" status', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      gid: '005',
      status: 'pending',
      request: {
        url: 'https://example.com/file.bin',
        filename: 'file.bin',
        directory: '/downloads',
      },
    });
    const queryTasksMock = vi.fn().mockReturnValue([task]);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '5',
      method: 'aria2.tellWaiting',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = (response.result as Array<Record<string, unknown>>)[0];

    expect(result.gid).toBe('005');
    expect(result.status).toBe('waiting');
    expect(result.totalLength).toBe('0');
    expect(result.completedLength).toBe('0');
    expect(result.dir).toBe('/downloads');
  });
});
