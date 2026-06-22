import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import type { DownloadTask } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './get-files';

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

describe('aria2.getFiles', () => {
  it('returns single-file array for known GID', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask();
    const getTaskMock = vi.fn().mockReturnValue(task);
    const ctx = createMockCtx({
      downloadManager: { getTask: getTaskMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.getFiles',
      params: ['4800000000000001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const files = response.result as Array<Record<string, unknown>>;

    expect(response.error).toBeUndefined();
    expect(files).toHaveLength(1);
    expect(files[0].index).toBe('1');
    expect(files[0].path).toBe('file.zip');
    expect(files[0].length).toBe('2048');
    expect(files[0].completedLength).toBe('1024');
    expect(files[0].selected).toBe('true');
    expect(files[0].uris).toEqual([{ uri: 'https://example.com/file.zip', status: 'used' }]);
    expect(getTaskMock).toHaveBeenCalledWith('4800000000000001');
  });

  it('uses filename from request when available', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      request: { url: 'https://example.com/data.bin', filename: 'custom-name.bin' },
    });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.getFiles',
      params: ['4800000000000001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const files = response.result as Array<Record<string, unknown>>;

    expect(files[0].path).toBe('custom-name.bin');
  });

  it('falls back to URL basename when no filename', async () => {
    const registry = new MethodRegistry();
    const task = createMockTask({
      request: { url: 'https://example.com/downloads/archive.tar.gz' },
    });
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(task) } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'aria2.getFiles',
      params: ['4800000000000001'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const files = response.result as Array<Record<string, unknown>>;

    expect(files[0].path).toBe('archive.tar.gz');
  });

  it('throws error for unknown GID', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx({
      downloadManager: { getTask: vi.fn().mockReturnValue(undefined) } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '4',
      method: 'aria2.getFiles',
      params: ['nonexistent'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('Unknown GID');
  });

  it('throws error when GID is missing', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '5',
      method: 'aria2.getFiles',
      params: [],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('No GID provided');
  });
});
