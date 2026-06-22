import { describe, it, expect, vi } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './change-global-option';

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

describe('aria2.changeGlobalOption', () => {
  it('returns "OK" for any params', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.changeGlobalOption',
      params: [{ 'max-concurrent-downloads': '5' }],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
    expect(response).not.toHaveProperty('error');
  });

  it('returns "OK" even with empty params', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '2',
      method: 'aria2.changeGlobalOption',
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toBe('OK');
    expect(response).not.toHaveProperty('error');
  });
});
