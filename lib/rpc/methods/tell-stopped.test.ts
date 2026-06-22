import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './tell-stopped';

function createMockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '4800000000000001',
    request: {
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
    },
    status: 'complete',
    bytesReceived: 2048,
    totalBytes: 2048,
    createdAt: Date.now(),
    completedAt: Date.now(),
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

describe('aria2.tellStopped', () => {
  it('returns stopped tasks (complete, error, cancelled)', async () => {
    const registry = new MethodRegistry();
    const tasks = [
      createMockTask({ gid: '001', status: 'complete' }),
      createMockTask({ gid: '002', status: 'error', error: 'Network failure' }),
      createMockTask({ gid: '003', status: 'cancelled' }),
    ];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.tellStopped',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(result).toHaveLength(3);
    expect(result[0].status).toBe('complete');
    expect(result[0].gid).toBe('001');
    expect(result[1].status).toBe('error');
    expect(result[1].gid).toBe('002');
    expect(result[2].status).toBe('removed');
    expect(result[2].gid).toBe('003');
    expect(queryTasksMock).toHaveBeenCalledWith({
      status: ['complete', 'error', 'cancelled'],
      offset: undefined,
      limit: undefined,
    });
  });

  it('supports offset and num options from params', async () => {
    const registry = new MethodRegistry();
    const tasks = [createMockTask({ gid: '004', status: 'complete' })];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.tellStopped',
      params: [{ offset: 2, num: 8 }],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeUndefined();
    expect(queryTasksMock).toHaveBeenCalledWith({
      status: ['complete', 'error', 'cancelled'],
      offset: 2,
      limit: 8,
    });
  });

  it('returns empty array when no stopped tasks', async () => {
    const registry = new MethodRegistry();
    const queryTasksMock = vi.fn().mockReturnValue([]);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'aria2.tellStopped',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('does not include active or pending tasks', async () => {
    const registry = new MethodRegistry();
    const tasks = [createMockTask({ gid: '005', status: 'complete' })];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '4',
      method: 'aria2.tellStopped',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(queryTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['complete', 'error', 'cancelled'] }),
    );
    expect(response.error).toBeUndefined();
  });

  it('includes all three stopped status types', async () => {
    const registry = new MethodRegistry();
    const tasks = [
      createMockTask({ gid: '006', status: 'complete' }),
      createMockTask({ gid: '007', status: 'error', error: 'Timeout' }),
      createMockTask({ gid: '008', status: 'cancelled' }),
    ];
    const queryTasksMock = vi.fn().mockReturnValue(tasks);
    const ctx = createMockCtx({
      downloadManager: { queryTasks: queryTasksMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '5',
      method: 'aria2.tellStopped',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const result = response.result as Array<Record<string, unknown>>;

    const statuses = result.map((r) => r.status);
    expect(statuses).toContain('complete');
    expect(statuses).toContain('error');
    expect(statuses).toContain('removed');

    // Verify the error task has error fields
    const errorTask = result.find((r) => r.gid === '007');
    expect(errorTask?.errorCode).toBe('1');
    expect(errorTask?.errorMessage).toBe('Timeout');
  });
});
