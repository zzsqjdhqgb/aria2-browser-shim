import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './add-uri';

// Mock browser APIs
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

describe('aria2.addUri', () => {
  it('creates download with URL and returns GID', async () => {
    const registry = new MethodRegistry();
    const createMock = vi.fn().mockResolvedValue('gid-001');
    const ctx = createMockCtx({
      downloadManager: { create: createMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.addUri',
      params: [['https://example.com/file.zip']],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('gid-001');
    expect(createMock).toHaveBeenCalledWith({
      url: 'https://example.com/file.zip',
      filename: undefined,
      directory: undefined,
      headers: undefined,
    });
  });

  it('parses dir, out, and header options', async () => {
    const registry = new MethodRegistry();
    const createMock = vi.fn().mockResolvedValue('gid-002');
    const ctx = createMockCtx({
      downloadManager: { create: createMock } as unknown as DownloadManager,
    });

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.addUri',
      params: [
        ['https://example.com/file.zip'],
        {
          dir: '/downloads',
          out: 'myfile.zip',
          header: ['User-Agent: Mozilla', 'Accept: application/json'],
        },
      ],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('gid-002');
    expect(createMock).toHaveBeenCalledWith({
      url: 'https://example.com/file.zip',
      filename: 'myfile.zip',
      directory: '/downloads',
      headers: {
        'User-Agent': 'Mozilla',
        'Accept': 'application/json',
      },
    });
  });

  it('throws error when no URIs provided', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '3',
      method: 'aria2.addUri',
      params: [[]],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('No URIs');
  });
});
