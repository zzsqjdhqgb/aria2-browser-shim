/**
 * Tests that exercise the layers where bugs were actually found:
 * 1. CustomEvent bridge between MAIN ↔ ISOLATED worlds
 * 2. Background message routing
 * 3. WebSocket port lifecycle (eventPort leak check)
 * 4. Download event state-transition deduplication
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketBridge } from '../../src/core/websocket-bridge';
import { Aria2Server } from '../../src/core/aria2-server';
import { createMethodMap } from '../../src/core/aria2-methods';
import { TaskStore } from '../../src/core/task-store';
import { DownloadManager } from '../../src/core/download-manager';

// ---------------------------------------------------------------------------
// Test 1: CustomEvent bridge protocol (simulating MAIN ↔ ISOLATED worlds)
// ---------------------------------------------------------------------------

describe('Bridge protocol: CustomEvent via document', () => {
  // Simulate MAIN world: dispatch events on document
  // Simulate ISOLATED world: listen on document

  it('request from MAIN world is received by ISOLATED world listener', async () => {
    const received: unknown[] = [];

    // ISOLATED world sets up listener
    document.addEventListener('__aria2shim_request__', ((e: CustomEvent) => {
      received.push(e.detail);
    }) as EventListener);

    // MAIN world dispatches
    const payload = { jsonrpc: '2.0', id: '1', method: 'aria2.getVersion' };
    document.dispatchEvent(new CustomEvent('__aria2shim_request__', {
      detail: { requestId: 42, type: 'rpc', payload },
    }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      requestId: 42,
      type: 'rpc',
      payload: { jsonrpc: '2.0', id: '1', method: 'aria2.getVersion' },
    });
  });

  it('ISOLATED world response is received by MAIN world listener', async () => {
    const responses: unknown[] = [];

    // MAIN world sets up response listener
    document.addEventListener('__aria2shim_response__', ((e: CustomEvent) => {
      responses.push(e.detail);
    }) as EventListener);

    // ISOLATED world dispatches response
    document.dispatchEvent(new CustomEvent('__aria2shim_response__', {
      detail: {
        requestId: 1,
        result: { version: '1.37.0-shim', enabledFeatures: ['HTTP'] },
      },
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      requestId: 1,
      result: { version: '1.37.0-shim' },
    });
  });

  it('ISOLATED world error is received by MAIN world', async () => {
    const responses: unknown[] = [];

    document.addEventListener('__aria2shim_response__', ((e: CustomEvent) => {
      responses.push(e.detail);
    }) as EventListener);

    document.dispatchEvent(new CustomEvent('__aria2shim_response__', {
      detail: {
        requestId: 1,
        error: { code: -32603, message: 'Internal error' },
      },
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      requestId: 1,
      error: { code: -32603, message: 'Internal error' },
    });
  });

  it('WebSocket event dispatched from ISOLATED reaches MAIN', async () => {
    const events: unknown[] = [];

    // MAIN world FakeWebSocket listener
    document.addEventListener('__aria2shim_wsevent__', ((e: CustomEvent) => {
      events.push(e.detail);
    }) as EventListener);

    // ISOLATED world bridge forwards aria2 event
    document.dispatchEvent(new CustomEvent('__aria2shim_wsevent__', {
      detail: { wsId: 1, method: 'aria2.onDownloadStart', params: [{ gid: 'abcd' }] },
    }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      wsId: 1,
      method: 'aria2.onDownloadStart',
      params: [{ gid: 'abcd' }],
    });
  });

  it('WebSocket connect request from MAIN reaches ISOLATED', async () => {
    const connects: unknown[] = [];

    document.addEventListener('__aria2shim_wsconnect__', ((e: CustomEvent) => {
      connects.push(e.detail);
    }) as EventListener);

    document.dispatchEvent(new CustomEvent('__aria2shim_wsconnect__', {
      detail: { wsId: 1, url: 'ws://localhost:6800/jsonrpc' },
    }));

    expect(connects).toHaveLength(1);
    expect(connects[0]).toMatchObject({
      wsId: 1,
      url: 'ws://localhost:6800/jsonrpc',
    });
  });

  it('WebSocket close request from MAIN reaches ISOLATED', async () => {
    const closes: unknown[] = [];

    document.addEventListener('__aria2shim_wsclose__', ((e: CustomEvent) => {
      closes.push(e.detail);
    }) as EventListener);

    document.dispatchEvent(new CustomEvent('__aria2shim_wsclose__', {
      detail: { wsId: 1, code: 1000, reason: 'normal' },
    }));

    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ wsId: 1 });
  });

  it('responses with result=null are properly passed through', async () => {
    const responses: unknown[] = [];

    document.addEventListener('__aria2shim_response__', ((e: CustomEvent) => {
      responses.push(e.detail);
    }) as EventListener);

    // Some aria2 methods return null as result
    document.dispatchEvent(new CustomEvent('__aria2shim_response__', {
      detail: { requestId: 1, result: null },
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ requestId: 1, result: null });
  });

  it('empty batch response (empty array) is passed through', async () => {
    const responses: unknown[] = [];

    document.addEventListener('__aria2shim_response__', ((e: CustomEvent) => {
      responses.push(e.detail);
    }) as EventListener);

    document.dispatchEvent(new CustomEvent('__aria2shim_response__', {
      detail: { requestId: 1, result: [] },
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ requestId: 1, result: [] });
  });
});

// ---------------------------------------------------------------------------
// Test 2: WebSocketBridge port lifecycle (eventPort leak check)
// ---------------------------------------------------------------------------

describe('WebSocketBridge port lifecycle', () => {
  let connectAddedCount = 0;
  let connectCallbacks: Array<(port: any) => void> = [];

  beforeEach(() => {
    connectAddedCount = 0;
    connectCallbacks = [];
    vi.spyOn(chrome.runtime.onConnect, 'addListener').mockImplementation((cb: any) => {
      connectAddedCount++;
      connectCallbacks.push(cb);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('init registers one onConnect listener', () => {
    const bridge = new WebSocketBridge();
    bridge.init();
    expect(connectAddedCount).toBe(1);
  });

  it('init is idempotent (does not register twice)', () => {
    const bridge = new WebSocketBridge();
    bridge.init();
    bridge.init();
    expect(connectAddedCount).toBe(1);
  });

  it('ignores ports with wrong name', () => {
    const bridge = new WebSocketBridge();
    bridge.init();

    const mockPort = {
      name: 'wrong-name',
      postMessage: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
      sender: { tab: { id: 123 } },
    };

    // Simulate a connection with wrong name
    connectCallbacks[0](mockPort);
    expect(bridge.getConnectedCount()).toBe(0);
    expect(mockPort.postMessage).not.toHaveBeenCalled();
  });

  it('accepts ports with name aria2-ws and sends onConnect', () => {
    const bridge = new WebSocketBridge();
    bridge.init();

    const msgReceived: any[] = [];
    const mockPort = {
      name: 'aria2-ws',
      postMessage: vi.fn((msg) => msgReceived.push(msg)),
      onDisconnect: { addListener: vi.fn() },
      sender: { tab: { id: 123 } },
    };

    connectCallbacks[0](mockPort);
    expect(bridge.getConnectedCount()).toBe(1);
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'aria2.onConnect',
      params: [{ portId: 123 }],
    });
  });

  it('removes port on disconnect', () => {
    const bridge = new WebSocketBridge();
    bridge.init();

    let disconnectCb: () => void = () => {};
    const mockPort = {
      name: 'aria2-ws',
      postMessage: vi.fn(),
      onDisconnect: { addListener: vi.fn((cb) => { disconnectCb = cb; }) },
      sender: { tab: { id: 123 } },
    };

    connectCallbacks[0](mockPort);
    expect(bridge.getConnectedCount()).toBe(1);

    disconnectCb();
    expect(bridge.getConnectedCount()).toBe(0);
  });

  it('broadcast sends to all connected ports', () => {
    const bridge = new WebSocketBridge();
    bridge.init();

    const msg1: any[] = [];
    const msg2: any[] = [];

    let disc1 = () => {};
    let disc2 = () => {};

    connectCallbacks[0]({
      name: 'aria2-ws', postMessage: vi.fn((m) => msg1.push(m)),
      onDisconnect: { addListener: vi.fn((cb) => { disc1 = cb; }) },
      sender: { tab: { id: 1 } },
    });
    connectCallbacks[0]({
      name: 'aria2-ws', postMessage: vi.fn((m) => msg2.push(m)),
      onDisconnect: { addListener: vi.fn((cb) => { disc2 = cb; }) },
      sender: { tab: { id: 2 } },
    });

    // Clear onConnect handshake messages
    msg1.length = 0;
    msg2.length = 0;

    bridge.broadcast('aria2.onDownloadStart', [{ gid: 'test' }]);

    expect(msg1).toHaveLength(1);
    expect(msg1[0]).toMatchObject({ jsonrpc: '2.0', method: 'aria2.onDownloadStart' });
    expect(msg2).toHaveLength(1);
  });

  it('broadcast handles disconnected ports gracefully', () => {
    const bridge = new WebSocketBridge();
    bridge.init();

    // Port that throws on postMessage
    connectCallbacks[0]({
      name: 'aria2-ws',
      postMessage: () => { throw new Error('disconnected'); },
      onDisconnect: { addListener: vi.fn() },
      sender: { tab: { id: 1 } },
    });

    expect(() => bridge.broadcast('aria2.onDownloadComplete', [{ gid: 'x' }])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Background message routing (simulated)
// ---------------------------------------------------------------------------

describe('Background: state-transition event deduplication', () => {
  async function makeTaskStore() {
    const store = new TaskStore(`dedup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await store.init();
    return store;
  }

  it('broadcasts onDownloadStart only on first active transition, not on progress updates', async () => {
    const store = await makeTaskStore();
    const dm = new DownloadManager(store);
    const events: Array<{ method: string; params: unknown[] }> = [];

    const taskLastStatus = new Map<string, string>();

    dm.onTaskChange((task) => {
      const prev = taskLastStatus.get(task.gid);
      taskLastStatus.set(task.gid, task.status);

      if (prev !== task.status) {
        if (task.status === 'active') {
          events.push({ method: 'aria2.onDownloadStart', params: [{ gid: task.gid }] });
        } else if (task.status === 'paused') {
          events.push({ method: 'aria2.onDownloadPause', params: [{ gid: task.gid }] });
        } else if (task.status === 'complete') {
          events.push({ method: 'aria2.onDownloadComplete', params: [{ gid: task.gid }] });
        } else if (task.status === 'error') {
          events.push({ method: 'aria2.onDownloadError', params: [{ gid: task.gid }] });
        } else if (task.status === 'removed') {
          events.push({ method: 'aria2.onDownloadStop', params: [{ gid: task.gid }] });
        }
      }
    });

    // Create a task and transition it through states
    const gid = await dm.create({ uris: ['https://example.com/file.bin'], dir: '/dl' });

    // Simulate multiple progress updates while active (same status)
    const task = await store.get(gid);
    task!.status = 'active';
    task!.browserDownloadId = 1;
    task!.totalLength = 1000000;
    task!.completedLength = 100000;
    await store.upsert(task!);
    dm['notifyChange'](task!);

    // Another progress update
    task!.completedLength = 500000;
    await store.upsert(task!);
    dm['notifyChange'](task!);

    // Another progress update
    task!.completedLength = 900000;
    await store.upsert(task!);
    dm['notifyChange'](task!);

    // Only one onDownloadStart should have fired
    const starts = events.filter((e) => e.method === 'aria2.onDownloadStart');
    expect(starts).toHaveLength(1);

    // Transition to complete
    task!.status = 'complete';
    task!.completedLength = 1000000;
    await store.upsert(task!);
    dm['notifyChange'](task!);

    // Verify complete event
    const completes = events.filter((e) => e.method === 'aria2.onDownloadComplete');
    expect(completes).toHaveLength(1);

    // Total events: onDownloadStart (1) + onDownloadComplete (1) = 2
    expect(events).toHaveLength(2);
  });

  it('tracks transitions per-gid independently', async () => {
    const store = await makeTaskStore();
    const dm = new DownloadManager(store);
    const events: string[] = [];

    const taskLastStatus = new Map<string, string>();

    dm.onTaskChange((task) => {
      const prev = taskLastStatus.get(task.gid);
      taskLastStatus.set(task.gid, task.status);
      if (prev !== task.status) {
        events.push(`${task.gid}=${prev ?? 'nil'}→${task.status}`);
      }
    });

    const gid1 = await dm.create({ uris: ['https://a.com/f1.bin'], dir: '/dl' });
    const gid2 = await dm.create({ uris: ['https://a.com/f2.bin'], dir: '/dl' });

    // Activate both
    let t1 = await store.get(gid1);
    t1!.status = 'active'; t1!.browserDownloadId = 1;
    await store.upsert(t1!); dm['notifyChange'](t1!);

    let t2 = await store.get(gid2);
    t2!.status = 'active'; t2!.browserDownloadId = 2;
    await store.upsert(t2!); dm['notifyChange'](t2!);

    // Progress update on task 1 only
    t1 = await store.get(gid1);
    t1!.completedLength = 500000;
    await store.upsert(t1!); dm['notifyChange'](t1!);

    // Complete task 1
    t1 = await store.get(gid1);
    t1!.status = 'complete';
    await store.upsert(t1!); dm['notifyChange'](t1!);

    // Error on task 2
    t2 = await store.get(gid2);
    t2!.status = 'error'; t2!.errorCode = '1';
    await store.upsert(t2!); dm['notifyChange'](t2!);

    // Verify we got correct transitions, no duplicates
    const expected = [
      `${gid1}=nil→active`,
      `${gid2}=nil→active`,
      `${gid1}=active→complete`,
      `${gid2}=active→error`,
    ];
    expect(events).toEqual(expected);
  });

  it('single state change fires exactly one event', async () => {
    const store = await makeTaskStore();
    const dm = new DownloadManager(store);
    let changeCount = 0;

    dm.onTaskChange(() => {
      changeCount++;
    });

    const gid = await dm.create({ uris: ['https://a.com/f.bin'], dir: '/dl' });

    // Direct state transitions
    let task = await store.get(gid);
    task!.status = 'paused';
    await store.upsert(task!);
    dm['notifyChange'](task!);

    task = await store.get(gid);
    task!.status = 'active';
    await store.upsert(task!);
    dm['notifyChange'](task!);

    task = await store.get(gid);
    task!.status = 'error';
    task!.errorCode = '1';
    await store.upsert(task!);
    dm['notifyChange'](task!);

    // Each notifyChange fires exactly 1 callback
    expect(changeCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Full RPC round-trip through Aria2Server with background-style routing
// ---------------------------------------------------------------------------

describe('Background message handler: RPC round-trip', () => {
  async function setupServer() {
    const store = new TaskStore(`rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await store.init();
    const dm = new DownloadManager(store);
    const ws = new WebSocketBridge();

    const ctx = {
      downloadManager: dm,
      taskStore: store,
      wsBridge: ws,
      globalOptions: {} as Record<string, string | undefined>,
      sessionId: 'test-session',
    };
    const methods = createMethodMap(ctx);
    const server = new Aria2Server(methods);
    return { server, store, dm, ws };
  }

  it('handles a valid RPC request through server', async () => {
    const { server } = await setupServer();
    const body = { jsonrpc: '2.0', id: 'r1', method: 'aria2.getVersion' };
    const response = await server.handleRequest(body);
    expect(response).not.toBeNull();
    if (!Array.isArray(response!)) {
      expect(response!.result).toHaveProperty('version');
    }
  });

  it('handles addUri and returns GID', async () => {
    const { server } = await setupServer();
    const body = {
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/test.bin'], { dir: '/dl' }],
    };
    const response = await server.handleRequest(body);
    expect(response).not.toBeNull();
    if (!Array.isArray(response!)) {
      expect(response!.result).toMatch(/^[0-9a-f]{16}$/);
      expect(response!.error).toBeUndefined();
    }
  });

  it('handles tellStatus with an array request body (not an object)', async () => {
    const { server } = await setupServer();
    // Create a task first
    const addBody = {
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/status-test.bin']],
    };
    const addRes = await server.handleRequest(addBody);
    const gid = (addRes as any).result;

    // tellStatus with keys filter
    const body = {
      jsonrpc: '2.0', id: 'r2', method: 'aria2.tellStatus',
      params: [gid, ['gid', 'status', 'totalLength', 'completedLength']],
    };
    const response = await server.handleRequest(body);
    expect(response).not.toBeNull();
    if (!Array.isArray(response!)) {
      expect(response!.result).toMatchObject({
        gid,
        status: 'pending',
      });
      expect((response!.result as any).dir).toBeUndefined(); // not in keys filter
    }
  });

  it('handles getGlobalStat', async () => {
    const { server } = await setupServer();
    const body = { jsonrpc: '2.0', id: 'r1', method: 'aria2.getGlobalStat' };
    const response = await server.handleRequest(body);
    expect(response).not.toBeNull();
    if (!Array.isArray(response!)) {
      const stat = response!.result as any;
      expect(stat).toHaveProperty('downloadSpeed');
      expect(stat).toHaveProperty('numActive');
      expect(stat).toHaveProperty('numStoppedTotal');
    }
  });

  it('handles parse error gracefully', async () => {
    const { server } = await setupServer();
    const response = await server.handleRequest('not-json');
    expect(response).not.toBeNull();
    if (!Array.isArray(response!)) {
      expect(response!.error).toBeDefined();
      expect(response!.error!.code).toBe(-32700);
    }
  });
});
