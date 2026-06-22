import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask, DownloadStatus } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './purge-download-result';

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

const HISTORY_KEY = 'aria2_download_history';

function createMockHistoryTask(gid: string, status: DownloadStatus): DownloadTask {
  return {
    gid,
    request: { url: `https://example.com/${gid}.zip` },
    status,
    bytesReceived: 1024,
    totalBytes: 1024,
    createdAt: Date.now() - 10000,
    completedAt: status === 'complete' ? Date.now() : undefined,
  };
}

describe('aria2.purgeDownloadResult', () => {
  let localGet: ReturnType<typeof vi.fn>;
  let localSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localGet = vi.fn().mockResolvedValue({});
    localSet = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('browser', {
      downloads: { onCreated: { addListener: vi.fn() }, onChanged: { addListener: vi.fn() } },
      storage: {
        session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
        local: { get: localGet, set: localSet },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('purges completed/error/cancelled tasks from history', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    const tasks = [
      createMockHistoryTask('gid-001', 'complete'),
      createMockHistoryTask('gid-002', 'error'),
      createMockHistoryTask('gid-003', 'cancelled'),
    ];
    localGet.mockResolvedValue({ [HISTORY_KEY]: tasks });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '1', method: 'aria2.purgeDownloadResult',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
    expect(localSet).toHaveBeenCalledWith({ [HISTORY_KEY]: [] });
  });

  it('preserves pending/in_progress/paused tasks', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    const tasks = [
      createMockHistoryTask('gid-001', 'pending'),
      createMockHistoryTask('gid-002', 'in_progress'),
      createMockHistoryTask('gid-003', 'paused'),
      createMockHistoryTask('gid-004', 'complete'),
    ];
    localGet.mockResolvedValue({ [HISTORY_KEY]: tasks });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '2', method: 'aria2.purgeDownloadResult',
      params: [],
    };

    await registry.dispatch(req, ctx);

    const setCall = localSet.mock.calls[0][0];
    const updatedHistory = setCall[HISTORY_KEY] as DownloadTask[];
    expect(updatedHistory).toHaveLength(3);
    expect(updatedHistory.map((t) => t.status).sort()).toEqual(['in_progress', 'paused', 'pending']);
  });

  it('returns OK on empty history', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    localGet.mockResolvedValue({ [HISTORY_KEY]: [] });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '3', method: 'aria2.purgeDownloadResult',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
  });

  it('handles missing history key gracefully', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    localGet.mockResolvedValue({});

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '4', method: 'aria2.purgeDownloadResult',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
  });
});
