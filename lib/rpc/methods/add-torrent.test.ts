import { describe, it, expect, vi } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { ErrorCode } from '../types';
import { register } from './add-torrent';

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

describe('aria2.addTorrent', () => {
  it('returns error indicating BitTorrent is not supported', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.addTorrent',
      params: ['base64encodeddata'],
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response).toHaveProperty('error');
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(response.error!.message).toContain('BitTorrent');
    expect(response.error!.message).toContain('not supported');
    expect(response.result).toBeUndefined();
  });
});
