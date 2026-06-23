import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '@/core/task-store';
import type { DownloadTask } from '@/core/types';

function makeTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: 'abcd123400000001',
    uris: ['https://example.com/file.zip'],
    status: 'pending',
    browserDownloadId: null,
    totalLength: 0,
    completedLength: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    connections: 0,
    dir: '/downloads',
    files: [],
    errorCode: null,
    errorMessage: null,
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
    ...overrides,
  };
}

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(async () => {
    store = new TaskStore('test-tasks-' + Date.now());
    await store.init();
  });

  it('upserts and retrieves a task', async () => {
    const task = makeTask();
    await store.upsert(task);
    const retrieved = await store.get(task.gid);
    expect(retrieved).toBeDefined();
    expect(retrieved!.gid).toBe(task.gid);
    expect(retrieved!.uris).toEqual(task.uris);
  });

  it('updates existing task on upsert', async () => {
    const task = makeTask();
    await store.upsert(task);

    const updated = { ...task, status: 'active' as const, totalLength: 1024 };
    await store.upsert(updated);

    const retrieved = await store.get(task.gid);
    expect(retrieved!.status).toBe('active');
    expect(retrieved!.totalLength).toBe(1024);
  });

  it('returns undefined for missing gid', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('finds task by browser download id', async () => {
    const task = makeTask({ browserDownloadId: 42, status: 'active' });
    await store.upsert(task);

    const result = await store.getByBrowserId(42);
    expect(result).toBeDefined();
    expect(result!.gid).toBe(task.gid);
  });

  it('finds pending task by URL', async () => {
    const url = 'https://example.com/file.zip';
    const task = makeTask({ uris: [url], status: 'pending' });
    await store.upsert(task);

    const result = await store.getPendingByUrl(url);
    expect(result).toBeDefined();
    expect(result!.gid).toBe(task.gid);
  });

  it('queries tasks by status with pagination', async () => {
    await store.upsert(makeTask({ gid: 'a000000000000001', status: 'active' }));
    await store.upsert(makeTask({ gid: 'a000000000000002', status: 'active' }));
    await store.upsert(makeTask({ gid: 'a000000000000003', status: 'complete' }));

    const active = await store.query({ status: 'active' });
    expect(active).toHaveLength(2);

    const paged = await store.query({ status: 'active', offset: 1, num: 1 });
    expect(paged).toHaveLength(1);
  });

  it('counts tasks by status', async () => {
    await store.upsert(makeTask({ gid: 'a000000000000001', status: 'active' }));
    await store.upsert(makeTask({ gid: 'a000000000000002', status: 'waiting' }));
    await store.upsert(makeTask({ gid: 'a000000000000003', status: 'active' }));

    expect(await store.count('active')).toBe(2);
    expect(await store.count('waiting')).toBe(1);
    expect(await store.count()).toBe(3);
  });

  it('deletes a task', async () => {
    const task = makeTask();
    await store.upsert(task);
    await store.delete(task.gid);
    expect(await store.get(task.gid)).toBeUndefined();
  });

  it('purges tasks by status', async () => {
    await store.upsert(makeTask({ gid: 'a000000000000001', status: 'complete' }));
    await store.upsert(makeTask({ gid: 'a000000000000002', status: 'error' }));
    await store.upsert(makeTask({ gid: 'a000000000000003', status: 'active' }));

    await store.purge('complete');
    await store.purge('error');

    expect(await store.count()).toBe(1);
  });
});
