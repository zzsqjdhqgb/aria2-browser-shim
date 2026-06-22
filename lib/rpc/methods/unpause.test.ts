import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './unpause';

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

describe('aria2.unpause', () => {
  it('delegates to downloadManager.resume and returns GID', async () => {
    const registry = new MethodRegistry();
    const resumeMock = vi.fn().mockResolvedValue(undefined);
    const ctx = createMockCtx({
      downloadManager: { resume: resumeMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.unpause',
      params: ['gid-001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('gid-001');
    expect(resumeMock).toHaveBeenCalledWith('gid-001');
  });

  it('throws error when GID is missing', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.unpause',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('No GID provided');
  });
});
