import { describe, it, expect, vi } from 'vitest';
import { MethodRegistry } from '../dispatcher';
import type { Aria2RpcRequest, Aria2RpcResponse, HandlerContext } from '../types';
import type { DownloadManager } from '../../download-manager';
import { DEFAULT_SETTINGS } from '../../types';
import { register } from './get-version';

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

describe('aria2.getVersion', () => {
  it('returns the shim version string', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.getVersion',
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;

    expect(response.result).toHaveProperty('version');
    expect(response.result).toEqual({
      version: '1.37.0-shim',
      enabledFeatures: ['Firefox3Cookie', 'GZip', 'HTTPS', 'Message Digest'],
    });
    expect(response).not.toHaveProperty('error');
  });

  it('does not include BitTorrent or Metalink in enabledFeatures', async () => {
    const registry = new MethodRegistry();
    const ctx = createMockCtx();

    register(registry);

    const req: Aria2RpcRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'aria2.getVersion',
    };

    const response = await registry.dispatch(req, ctx) as Aria2RpcResponse;
    const features = (response.result as { enabledFeatures: string[] }).enabledFeatures;

    expect(features).not.toContain('BitTorrent');
    expect(features).not.toContain('Metalink');
  });
});
