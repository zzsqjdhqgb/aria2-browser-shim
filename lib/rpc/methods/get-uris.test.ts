import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './get-uris';

function createMockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '4800000000000001',
    request: { url: 'https://example.com/file.zip', filename: 'file.zip' },
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

describe('aria2.getUris', () => {
  it('returns URI array for known GID', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      request: { url: 'https://example.com/file.zip', filename: 'file.zip' },
    });
    const getTaskMock = vi.fn().mockReturnValue(task);
    const ctx = createMockCtx({
      downloadManager: { getTask: getTaskMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.getUris',
      params: ['4800000000000001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const uris = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(uris).toHaveLength(1);
    expect(uris[0].uri).toBe('https://example.com/file.zip');
    expect(getTaskMock).toHaveBeenCalledWith('4800000000000001');
  });

  it('returns status "used"', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      request: { url: 'https://cdn.example.com/video.mp4' },
    });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.getUris',
      params: ['4800000000000001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const uris = response.result as Array<Record<string, unknown>>;

    expect(uris[0].status).toBe('used');
  });

  it('throws error for unknown GID', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(undefined) } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'aria2.getUris',
      params: ['nonexistent'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('Unknown GID');
  });
});
