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
      local: {
        getSettings: vi.fn(),
        putSettings: vi.fn(),
        getPerSiteEnabled: vi.fn(),
        setPerSiteEnabled: vi.fn(),
        getDownloadHistory: vi.fn(),
        addToHistory: vi.fn(),
        removeFromHistory: vi.fn().mockResolvedValue(undefined),
        purgeTerminalHistory: vi.fn(),
      },
    },
    ...overrides,
  };
}

function createMockHistoryTask(gid: string): DownloadTask {
  return {
    gid,
    request: { url: 'https://example.com/' + gid + '.zip' },
    status: 'complete',
    bytesReceived: 1024,
    totalBytes: 1024,
    createdAt: Date.now() - 10000,
    completedAt: Date.now(),
  };
}

describe('aria2.removeDownloadResult', () => {
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

  it('calls LocalStore.removeFromHistory with the GID', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '1', method: 'aria2.removeDownloadResult',
      params: ['gid-001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
    expect(ctx.store.local.removeFromHistory).toHaveBeenCalledWith('gid-001');
  });

  it('returns OK when GID not found (LocalStore handles gracefully)', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '2', method: 'aria2.removeDownloadResult',
      params: ['nonexistent'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
    expect(ctx.store.local.removeFromHistory).toHaveBeenCalledWith('nonexistent');
  });

  it('throws error when GID is missing', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0', id: '3', method: 'aria2.removeDownloadResult',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('No GID provided');
  });
});
