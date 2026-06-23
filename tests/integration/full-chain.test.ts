import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskStore } from '../../src/core/task-store';
import { DownloadManager } from '../../src/core/download-manager';
import { WebSocketBridge } from '../../src/core/websocket-bridge';
import { Aria2Server } from '../../src/core/aria2-server';
import { createMethodMap } from '../../src/core/aria2-methods';

async function setupBackground() {
  const store = new TaskStore(`chain-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await store.init();
  const dm = new DownloadManager(store);
  const ws = new WebSocketBridge();
  const globalOptions: Record<string, string | undefined> = {};
  const sessionId = 'chain-session-test';
  dm.init();
  ws.init();

  const methods = createMethodMap({ downloadManager: dm, taskStore: store, wsBridge: ws, globalOptions, sessionId });
  return { store, dm, ws, methods, globalOptions };
}

// Simulate MAIN world: dispatches request events, listens for response events.
// Returns the FULL JSON-RPC response object (jsonrpc/id/result or error).
function callAria2(method: string, params?: unknown[]): Promise<{ jsonrpc: string; id: string | null; result?: unknown; error?: { code: number; message: string } }> {
  return new Promise((resolve, reject) => {
    const requestId = ++_counter;
    const timer = setTimeout(() => reject(new Error('Timeout after 5s')), 5000);

    const handler = (e: CustomEvent) => {
      if (e.detail.requestId !== requestId) return;
      document.removeEventListener('__aria2shim_response__', handler as EventListener);
      clearTimeout(timer);

      // The bridge now passes the full JSON-RPC envelope as a (stringified) object.
      // The real MAIN world does JSON.stringify(result), so we parse it back.
      const raw = e.detail.result;
      if (raw && typeof raw === 'object') {
        resolve(raw);
      } else {
        try { resolve(JSON.parse(raw || '')); }
        catch { resolve({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Invalid response' } }); }
      }
    };
    document.addEventListener('__aria2shim_response__', handler as EventListener);

    document.dispatchEvent(new CustomEvent('__aria2shim_request__', {
      detail: { requestId, type: 'rpc', payload: { jsonrpc: '2.0', id: `t-${requestId}`, method, params } },
    }));
  });
}
let _counter = 0;

describe('Full call chain', () => {
  let bg: Awaited<ReturnType<typeof setupBackground>>;
  const messageHandlers: Array<(msg: any, sender: any, sendResponse: (r: any) => void) => boolean | undefined> = [];
  let bridgePort: any = null;
  let bridgeEventPort: any = null;
  let bridgeWsPorts = new Map<number, any>();

  beforeEach(async () => {
    _counter = 0;
    messageHandlers.length = 0;
    bridgePort = null;
    bridgeEventPort = null;
    bridgeWsPorts = new Map();

    // Mock sendMessage – iterates handlers synchronously, resolves via sendResponse
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg: any) => new Promise((resolve) => {
      for (const handler of messageHandlers) {
        const ret = handler(msg, {}, (response: any) => { resolve(response); });
        if (ret === true) return; // async handler
      }
      resolve(undefined);
    }));

    // Mock connect
    vi.spyOn(chrome.runtime, 'connect').mockImplementation((info: any) => {
      const port: any = {
        name: info.name,
        sender: { tab: { id: 1 } },
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      };
      return port;
    });

    bg = await setupBackground();

    // Background: port handler (aria2-rpc)
    chrome.runtime.connect = vi.fn((info: any) => {
      const port: any = {
        name: info.name,
        sender: { tab: { id: 1 } },
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      };
      if (info.name === 'aria2-rpc') {
        port.onMessage.addListener((message: any) => {
          const server = new Aria2Server(bg.methods);
          server.handleRequest(message.payload).then((response) => {
            port.postMessage({ requestId: message.requestId, response });
          }).catch((err: any) => {
            port.postMessage({ requestId: message.requestId, response: { jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message || 'Internal error' } } });
          });
        });
      }
      return port;
    });

    // Background: sendMessage handler for aria2-rpc
    messageHandlers.push((msg, _sender, sendResponse) => {
      if (msg.type === 'aria2-rpc' && msg.requestId) {
        const server = new Aria2Server(bg.methods);
        server.handleRequest(msg.payload).then((response) => {
          sendResponse({ requestId: msg.requestId, response });
        }).catch((err: any) => {
          sendResponse({ requestId: msg.requestId, response: { jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message || 'Internal error' } } });
        });
        return true;
      }
      return false;
    });

    // ISOLATED bridge: request listener
    document.addEventListener('__aria2shim_request__', ((e: CustomEvent) => {
      const { requestId, type, payload } = e.detail;
      if (type === 'rpc') {
        chrome.runtime.sendMessage({ type: 'aria2-rpc', requestId, payload } as any).then((response: any) => {
          const r = response?.response;
          document.dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: { requestId, result: r },
          }));
        });
      } else if (type === 'ws-rpc') {
        const wp = payload as { wsId: number; payload: unknown };
        const p = bridgeWsPorts.get(wp.wsId);
        if (p) p.postMessage({ requestId, payload: wp.payload });
      }
    }) as EventListener);

    // ISOLATED bridge: wsconnect listener
    document.addEventListener('__aria2shim_wsconnect__', ((e: CustomEvent) => {
      const { wsId } = e.detail;
      if (!bridgePort) {
        bridgePort = chrome.runtime.connect({ name: 'aria2-rpc' });
        bridgePort.onMessage.addListener((message: any) => {
          const { requestId, response } = message;
          if (!response) return;
          document.dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: { requestId, result: response },
          }));
        });
      }
      if (!bridgeEventPort) {
        bridgeEventPort = chrome.runtime.connect({ name: 'aria2-ws' });
        bridgeEventPort.onMessage.addListener((msg: any) => {
          if (msg.method && msg.method.startsWith('aria2.on')) {
            document.dispatchEvent(new CustomEvent('__aria2shim_wsevent__', {
              detail: { wsId, method: msg.method, params: msg.params },
            }));
          }
        });
      }
      bridgeWsPorts.set(wsId, bridgePort);
    }) as EventListener);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('getVersion returns proper JSON-RPC envelope', async () => {
    const r = await callAria2('aria2.getVersion');
    expect(r.jsonrpc).toBe('2.0');
    expect(r.result).toBeDefined();
    expect(r.error).toBeUndefined();
    expect((r.result as any).version).toBe('1.37.0-shim');
  });

  it('addUri → tellStatus full flow', async () => {
    const add = await callAria2('aria2.addUri', [['https://e.com/f.bin'], { dir: '/dl' }]);
    expect(add.result).toMatch(/^[0-9a-f]{16}$/);

    const status = await callAria2('aria2.tellStatus', [add.result as string]);
    expect(status.result).toMatchObject({ status: 'pending', dir: '/dl' });
  });

  it('remove task then tellStatus returns error', async () => {
    const add = await callAria2('aria2.addUri', [['https://e.com/rm.bin']]);
    await callAria2('aria2.remove', [add.result as string]);
    const st = await callAria2('aria2.tellStatus', [add.result as string]);
    expect(st.error).toBeDefined();
    expect(st.error!.code).toBe(1);
  });

  it('unknown method returns -32601', async () => {
    const r = await callAria2('aria2.unknown');
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe(-32601);
  });

  it('getGlobalStat returns counts', async () => {
    const r = await callAria2('aria2.getGlobalStat');
    expect(r.result).toMatchObject({
      downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0',
    });
  });

  it('listMethods includes expected methods', async () => {
    const r = await callAria2('aria2.listMethods');
    expect(r.result).toContain('aria2.addUri');
    expect(r.result).toContain('aria2.tellStatus');
  });

  it('batch request returns array of responses', async () => {
    const body = [
      { jsonrpc: '2.0', id: 'b1', method: 'aria2.getVersion' },
      { jsonrpc: '2.0', id: 'b2', method: 'aria2.getGlobalStat' },
    ];
    const requestId = ++_counter;
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 5000);
      const handler = (e: CustomEvent) => {
        if (e.detail.requestId !== requestId) return;
        document.removeEventListener('__aria2shim_response__', handler as EventListener);
        clearTimeout(timer);
        const raw = e.detail.result;
        resolve(raw && typeof raw === 'object' ? raw : JSON.parse(raw || '[]'));
      };
      document.addEventListener('__aria2shim_response__', handler as EventListener);
    });
    document.dispatchEvent(new CustomEvent('__aria2shim_request__', {
      detail: { requestId, type: 'rpc', payload: body },
    }));
    const result = await promise;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].result).toBeDefined();
  });

  it('notification (no id) returns null response', async () => {
    const body = { jsonrpc: '2.0', method: 'aria2.getVersion' };
    const requestId = ++_counter;
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 5000);
      const handler = (e: CustomEvent) => {
        if (e.detail.requestId !== requestId) return;
        document.removeEventListener('__aria2shim_response__', handler as EventListener);
        clearTimeout(timer);
        resolve(e.detail.result);
      };
      document.addEventListener('__aria2shim_response__', handler as EventListener);
    });
    document.dispatchEvent(new CustomEvent('__aria2shim_request__', {
      detail: { requestId, type: 'rpc', payload: body },
    }));
    const result = await promise;
    expect(result).toBeNull(); // server returns null for notifications
  });
});
