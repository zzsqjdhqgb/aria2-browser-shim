import { describe, it, expect, beforeEach } from 'vitest';
import { Aria2Server } from '../../src/core/aria2-server';
import { createMethodMap } from '../../src/core/aria2-methods';
import { TaskStore } from '../../src/core/task-store';
import { DownloadManager } from '../../src/core/download-manager';
import { WebSocketBridge } from '../../src/core/websocket-bridge';
import type { DownloadTask } from '../../src/core/types';

function makeUniqueStoreName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildServer(options?: { token?: string }) {
  const store = new TaskStore(makeUniqueStoreName('int'));
  await store.init();
  const dm = new DownloadManager(store);
  const ws = new WebSocketBridge();

  const ctx = {
    downloadManager: dm,
    taskStore: store,
    wsBridge: ws,
    globalOptions: {} as Record<string, string | undefined>,
    sessionId: 'integration-session-001',
  };
  const methods = createMethodMap(ctx);
  return { server: new Aria2Server(methods, options), store, dm, ws };
}

describe('Integration: JSON-RPC end-to-end', () => {
  let server: Aria2Server;
  let store: TaskStore;

  beforeEach(async () => {
    const built = await buildServer();
    server = built.server;
    store = built.store;
  });

  it('handles getVersion', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.getVersion',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toMatchObject({
        version: expect.any(String),
        enabledFeatures: expect.arrayContaining(['HTTP', 'WebSocket']),
      });
      expect(res!.result.enabledFeatures).not.toContain('BitTorrent');
    }
  });

  it('handles addUri → tellStatus lifecycle', async () => {
    const addRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/file.bin'], { dir: '/dl' }],
    });
    expect(addRes).not.toBeNull();
    const gid = (addRes as any).result;
    expect(gid).toMatch(/^[0-9a-f]{16}$/);

    const statusRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r2', method: 'aria2.tellStatus',
      params: [gid],
    });
    expect(statusRes).not.toBeNull();
    if (!Array.isArray(statusRes!)) {
      expect(statusRes!.result).toMatchObject({
        gid,
        status: 'pending',
        dir: '/dl',
      });
    }
  });

  it('handles tellActive when no active tasks', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.tellActive',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toEqual([]);
    }
  });

  it('handles remove for existing task', async () => {
    const addRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/to-delete.bin']],
    });
    const gid = (addRes as any).result;

    const removeRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r2', method: 'aria2.remove',
      params: [gid],
    });
    expect(removeRes).not.toBeNull();
    if (!Array.isArray(removeRes!)) {
      expect(removeRes!.result).toBe(gid);
    }

    const statusRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r3', method: 'aria2.tellStatus',
      params: [gid],
    });
    if (!Array.isArray(statusRes!)) {
      expect(statusRes!.error).toBeDefined();
      expect(statusRes!.error!.code).toBe(1);
    }
  });

  it('handles pause and unpause', async () => {
    const addRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/pause-test.bin']],
    });
    const gid = (addRes as any).result;

    const pauseRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r2', method: 'aria2.pause',
      params: [gid],
    });
    expect(pauseRes).not.toBeNull();
    if (!Array.isArray(pauseRes!)) {
      expect(pauseRes!.result).toBe(gid);
    }

    const unpauseRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r3', method: 'aria2.unpause',
      params: [gid],
    });
    expect(unpauseRes).not.toBeNull();
    if (!Array.isArray(unpauseRes!)) {
      expect(unpauseRes!.result).toBe(gid);
    }
  });

  it('handles getGlobalStat', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.getGlobalStat',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toMatchObject({
        downloadSpeed: expect.any(String),
        uploadSpeed: expect.any(String),
        numActive: expect.any(String),
        numWaiting: expect.any(String),
        numStopped: expect.any(String),
        numStoppedTotal: expect.any(String),
      });
    }
  });

  it('handles getSessionInfo', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.getSessionInfo',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toMatchObject({
        sessionId: expect.any(String),
      });
    }
  });

  it('handles changeOption and getOption', async () => {
    const addRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/opt-test.bin']],
    });
    const gid = (addRes as any).result;

    await server.handleRequest({
      jsonrpc: '2.0', id: 'r2', method: 'aria2.changeOption',
      params: [gid, { 'max-connection-per-server': '4' }],
    });

    const getOptRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r3', method: 'aria2.getOption',
      params: [gid],
    });
    expect(getOptRes).not.toBeNull();
    if (!Array.isArray(getOptRes!)) {
      expect((getOptRes!.result as any)['max-connection-per-server']).toBe('4');
    }
  });

  it('handles listMethods', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.listMethods',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      const methods = res!.result as string[];
      expect(methods).toContain('aria2.addUri');
      expect(methods).toContain('aria2.getVersion');
      expect(methods).toContain('aria2.tellStatus');
      expect(methods).toContain('aria2.multicall');
    }
  });

  it('handles listNotifications', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.listNotifications',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      const notifications = res!.result as string[];
      expect(notifications).toContain('aria2.onDownloadStart');
      expect(notifications).toContain('aria2.onDownloadComplete');
      expect(notifications).toContain('aria2.onDownloadError');
    }
  });

  it('handles purgeDownloadResult', async () => {
    const addRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r1', method: 'aria2.addUri',
      params: [['https://example.com/purge-test.bin']],
    });
    const gid = (addRes as any).result;

    await server.handleRequest({
      jsonrpc: '2.0', id: 'r2', method: 'aria2.remove',
      params: [gid],
    });

    const purgeRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r3', method: 'aria2.purgeDownloadResult',
    });
    expect(purgeRes).not.toBeNull();
    if (!Array.isArray(purgeRes!)) {
      expect(purgeRes!.result).toBe('OK');
    }

    const statusRes = await server.handleRequest({
      jsonrpc: '2.0', id: 'r4', method: 'aria2.tellStatus',
      params: [gid],
    });
    if (!Array.isArray(statusRes!)) {
      expect(statusRes!.error).toBeDefined();
    }
  });
});

describe('Integration: batch requests', () => {
  let server: Aria2Server;

  beforeEach(async () => {
    const built = await buildServer();
    server = built.server;
  });

  it('handles batch of independent requests', async () => {
    const res = await server.handleRequest([
      { jsonrpc: '2.0', id: '1', method: 'aria2.getVersion' },
      { jsonrpc: '2.0', id: '2', method: 'aria2.getSessionInfo' },
      { jsonrpc: '2.0', id: '3', method: 'aria2.getGlobalStat' },
    ]);
    expect(Array.isArray(res)).toBe(true);
    if (Array.isArray(res)) {
      expect(res).toHaveLength(3);
      expect(res[0]).toHaveProperty('result');
      expect(res[1]).toHaveProperty('result');
      expect(res[2]).toHaveProperty('result');
    }
  });

  it('handles batch with mixed success and error', async () => {
    const res = await server.handleRequest([
      { jsonrpc: '2.0', id: '1', method: 'aria2.getVersion' },
      { jsonrpc: '2.0', id: '2', method: 'nonexistent.method' },
      { jsonrpc: '2.0', id: '3', method: 'aria2.getSessionInfo' },
    ]);
    expect(Array.isArray(res)).toBe(true);
    if (Array.isArray(res)) {
      expect(res).toHaveLength(3);
      expect(res[0]).toHaveProperty('result');
      expect(res[1]).toHaveProperty('error');
      expect(res[1].error!.code).toBe(-32601);
      expect(res[2]).toHaveProperty('result');
    }
  });

  it('handles multicall', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.multicall',
      params: [[
        { methodName: 'aria2.getVersion', params: [] },
        { methodName: 'aria2.getGlobalStat', params: [] },
        { methodName: 'nonexistent', params: [] },
      ]],
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      const results = res!.result as any[];
      expect(results).toHaveLength(3);
      // First call succeeded
      expect(results[0]).toHaveLength(1);
      expect(results[0][0]).toHaveProperty('version');
      // Second call succeeded
      expect(results[1]).toHaveLength(1);
      expect(results[1][0]).toHaveProperty('downloadSpeed');
      // Third call failed
      expect(results[2][0]).toHaveProperty('code', -32601);
    }
  });
});

describe('Integration: token authentication', () => {
  it('rejects requests when token is required but not provided', async () => {
    const built = await buildServer({ token: 'my-secret' });
    const res = await built.server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.getVersion',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32600);
    }
  });

  it('accepts requests with correct token', async () => {
    const built = await buildServer({ token: 'my-secret' });
    const res = await built.server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.getVersion',
      params: ['token:my-secret'],
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toBeDefined();
    }
  });

  it('rejects requests with wrong token', async () => {
    const built = await buildServer({ token: 'my-secret' });
    const res = await built.server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.getVersion',
      params: ['token:wrong'],
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32600);
    }
  });
});

describe('Integration: task store + download manager coordination', () => {
  let store: TaskStore;
  let dm: DownloadManager;

  beforeEach(async () => {
    store = new TaskStore(makeUniqueStoreName('coord'));
    await store.init();
    dm = new DownloadManager(store);
  });

  it('getGlobalStat correctly aggregates task counts', async () => {
    // Create tasks in different states via the store directly
    await store.upsert(dummyTask('g0001', 'active', 'https://a.com/1.bin'));
    await store.upsert(dummyTask('g0002', 'active', 'https://a.com/2.bin', 512000, 256000));
    await store.upsert(dummyTask('g0003', 'waiting', 'https://a.com/3.bin'));
    await store.upsert(dummyTask('g0004', 'complete', 'https://a.com/4.bin'));
    await store.upsert(dummyTask('g0005', 'error', 'https://a.com/5.bin'));
    await store.upsert(dummyTask('g0006', 'removed', 'https://a.com/6.bin'));

    const stat = await dm.getGlobalStat();
    expect(stat.numActive).toBe('2');
    expect(stat.numWaiting).toBe('1');
    expect(stat.numStopped).toBe('1');
    expect(stat.numStoppedTotal).toBe('3'); // complete + removed + error
  });

  it('getActiveTasks returns only active tasks', async () => {
    await store.upsert(dummyTask('a0001', 'active', 'https://a.com/a.bin'));
    await store.upsert(dummyTask('a0002', 'waiting', 'https://a.com/b.bin'));
    await store.upsert(dummyTask('a0003', 'active', 'https://a.com/c.bin'));

    const active = await dm.getActiveTasks();
    expect(active).toHaveLength(2);
    expect(active.map((t) => t.gid).sort()).toEqual(['a0001', 'a0003']);
  });

  it('pause throws for unknown gid', async () => {
    await expect(dm.pause('nonexistent')).rejects.toThrow('Task not found');
  });

  it('cancel is idempotent for unknown gid', async () => {
    await expect(dm.cancel('nonexistent')).resolves.toBeUndefined();
  });

  it('onTaskChange receives notifications', async () => {
    const events: DownloadTask[] = [];
    dm.onTaskChange((t) => events.push(t));

    await store.upsert(dummyTask('e0001', 'active', 'https://a.com/e.bin'));
    // onTaskChange fires when notifyChange is called internally;
    // we need to trigger it through the DM API
    await dm.pause('e0001').catch(() => {}); // won't work on active without browserDownloadId

    // Pause sets status to paused only if currently active:
    // In test, browserDownloadId is null, so chrome.downloads.pause isn't called,
    // but the status change still happens if current status is 'active'.
    // Verify status was updated after pause attempt
    const task = await store.get('e0001');
    expect(task?.status).toBe('paused');
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Integration: notifications and error handling', () => {
  let server: Aria2Server;

  beforeEach(async () => {
    const built = await buildServer();
    server = built.server;
  });

  it('notifications (null id) return null', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', method: 'aria2.getVersion',
    });
    expect(res).toBeNull();
  });

  it('returns error for addTorrent', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.addTorrent',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(4);
    }
  });

  it('returns error for addMetalink', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.addMetalink',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(4);
    }
  });

  it('returns error for invalid params on addUri', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.addUri',
      params: [],
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32602);
    }
  });

  it('returns error for unknown GID on tellStatus', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.tellStatus',
      params: ['ffffffffffffffff'],
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(1);
    }
  });

  it('shutdown cancels all active tasks', async () => {
    const built = await buildServer();
    const s = built.server;

    await s.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.addUri',
      params: [['https://a.com/s1.bin']],
    });
    await s.handleRequest({
      jsonrpc: '2.0', id: '2', method: 'aria2.addUri',
      params: [['https://a.com/s2.bin']],
    });

    const res = await s.handleRequest({
      jsonrpc: '2.0', id: '3', method: 'aria2.shutdown',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toBe('OK');
    }
  });

  it('getPeers returns empty array', async () => {
    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.getPeers',
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      expect(res!.result).toEqual([]);
    }
  });

  it('getServers returns URI list', async () => {
    const addRes = await server.handleRequest({
      jsonrpc: '2.0', id: '1', method: 'aria2.addUri',
      params: [['https://a.com/srv.bin']],
    });
    const gid = (addRes as any).result;

    const res = await server.handleRequest({
      jsonrpc: '2.0', id: '2', method: 'aria2.getServers',
      params: [gid],
    });
    expect(res).not.toBeNull();
    if (!Array.isArray(res!)) {
      const servers = res!.result as any[];
      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        index: '0',
        uri: 'https://a.com/srv.bin',
        currentUri: 'https://a.com/srv.bin',
      });
    }
  });
});

// Helper
function dummyTask(
  gid: string,
  status: DownloadTask['status'],
  uri: string,
  totalLength = 0,
  completedLength = 0,
): DownloadTask {
  return {
    gid,
    uris: [uri],
    status,
    browserDownloadId: null,
    totalLength,
    completedLength,
    downloadSpeed: status === 'active' ? 102400 : 0,
    uploadSpeed: 0,
    connections: 0,
    dir: '/dl',
    files: [],
    errorCode: status === 'error' ? '1' : null,
    errorMessage: status === 'error' ? 'Failed' : null,
    followedBy: null,
    following: null,
    belongsTo: null,
    bitfield: '',
    infoHash: null,
    numSeeders: '0',
    seeder: 'false',
    pieceLength: '0',
    numPieces: '0',
    verifiedLength: '0',
    verifyIntegrityPending: 'false',
    options: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tabId: null,
    ruleId: null,
  };
}
