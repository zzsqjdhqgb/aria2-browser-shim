import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './remove-download-result';

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

function createMockHistoryTask(gid: string): DownloadTask {
  return {
    gid,
    request: { url: `https://example.com/${gid}.zip` },
    status: 'complete',
    bytesReceived: 1024,
    totalBytes: 1024,
    createdAt: Date.now() - 10000,
    completedAt: Date.now(),
  };
}

describe('aria2.removeDownloadResult', () => {
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

  it('removes task from history by GID', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    const task = createMockHistoryTask('gid-001');
    localGet.mockResolvedValue({ [HISTORY_KEY]: [task] });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '1', method: 'aria2.removeDownloadResult',
      params: ['gid-001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
    expect(localSet).toHaveBeenCalledWith({ [HISTORY_KEY]: [] });
  });

  it('returns OK even when GID not found', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    localGet.mockResolvedValue({ [HISTORY_KEY]: [] });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '2', method: 'aria2.removeDownloadResult',
      params: ['nonexistent'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
  });

  it('preserves other tasks in history', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();
    const task1 = createMockHistoryTask('gid-001');
    const task2 = createMockHistoryTask('gid-002');
    localGet.mockResolvedValue({ [HISTORY_KEY]: [task1, task2] });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '3', method: 'aria2.removeDownloadResult',
      params: ['gid-001'],
    };

    await registry.dispatch(req, ctx);

    const setCall = localSet.mock.calls[0][0];
    const updatedHistory = setCall[HISTORY_KEY] as DownloadTask[];
    expect(updatedHistory).toHaveLength(1);
    expect(updatedHistory[0].gid).toBe('gid-002');
  });

  it('throws error when GID is missing', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '4', method: 'aria2.removeDownloadResult',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('No GID provided');
  });
});
