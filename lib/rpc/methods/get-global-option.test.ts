import { describe, it, expect, vi } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './get-global-option';

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

describe('aria2.getGlobalOption', () => {
  it('returns same defaults as getOption', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.getGlobalOption',
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toEqual({
      dir: '.',
      out: '',
      split: 1,
      'max-connection-per-server': 1,
      header: [],
    });
    expect(response).not.toHaveProperty('error');
  });

  it('returns a new object each call', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.getGlobalOption',
    };

    const response1 = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const response2 = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response1.result).not.toBe(response2.result);
    expect(response1.result).toEqual(response2.result);
  });
});
