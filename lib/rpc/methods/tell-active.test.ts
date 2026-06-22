import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './tell-active';

function createMockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '4800000000000001',
    request: {
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
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

describe('aria2.tellActive', () => {
  it('returns active tasks with status "in_progress"', async () => {
    const registry = new MethodRegistry();
    const tasks = [
      createMockTask({ gid: '001', status: 'in_progress' }),
      createMockTask({ gid: '002', status: 'in_progress' }),
    ];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.tellActive',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('active');
    expect(result[0].gid).toBe('001');
    expect(result[1].status).toBe('active');
    expect(result[1].gid).toBe('002');
    expect(queryTasksMock).toHaveBeenCalledWith({ status: 'in_progress', offset: undefined, limit: undefined });
  });

  it('supports offset and num options from params', async () => {
    const registry = new MethodRegistry();
    const tasks = [createMockTask({ gid: '003', status: 'in_progress' })];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.tellActive',
      params: [{ offset: 5, num: 10 }],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeUndefined();
    expect(queryTasksMock).toHaveBeenCalledWith({ status: 'in_progress', offset: 5, limit: 10 });
  });

  it('returns empty array when no active tasks', async () => {
    const registry = new MethodRegistry();
    const queryTasksMock = vi.fn().mockReturnValue([]);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'aria2.tellActive',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('does not include non-active tasks', async () => {
    const registry = new MethodRegistry();
    const tasks = [
      createMockTask({ gid: '004', status: 'in_progress' }),
      createMockTask({ gid: '005', status: 'in_progress' }),
    ];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '4',
      method: 'aria2.tellActive',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    // Verify the filter passed to queryTasks only asks for in_progress
    expect(queryTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' }),
    );
    expect(response.error).toBeUndefined();
  });

  it('formats task with all required aria2 fields', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      gid: '006',
      status: 'in_progress',
      request: {
        url: 'https://example.com/video.mp4',
        filename: 'video.mp4',
        directory: '/downloads',
      },
      bytesReceived: 512,
      totalBytes: 1024,
      error: undefined,
    });
    const queryTasksMock = vi.fn().mockReturnValue([task]);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '5',
      method: 'aria2.tellActive',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = (response.result as Array<Record<string, unknown>>)[0];

    expect(result.gid).toBe('006');
    expect(result.status).toBe('active');
    expect(result.totalLength).toBe('1024');
    expect(result.completedLength).toBe('512');
    expect(result.dir).toBe('/downloads');
    expect(result.errorCode).toBe('0');
    expect(result.errorMessage).toBe('');
  });
});
