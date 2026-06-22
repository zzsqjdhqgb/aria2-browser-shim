import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DownloadRequest, DownloadTask, DownloadResult, DownloadStrategy, TaskChangeListener } from './types';
import { DownloadManager } from './download-manager';
import { EXTENSION_PREFIX, PLACEHOLDER_BROWSER_ID } from './gid';

// ============================================================================
// Mock browser global -- all browser APIs
// ============================================================================

function createMockStorageArea() {
  const store = new Map<string, unknown>();

  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) {
        const result: Record<string, unknown> = {};
        store.forEach((value, key) => {
          result[key] = value;
        });
        return result;
      }
      if (typeof keys === 'string') {
        return { [keys]: store.get(keys) };
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (store.has(key)) {
            result[key] = store.get(key);
          }
        }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(keys)) {
        result[key] = store.has(key) ? store.get(key) : (keys as Record<string, unknown>)[key];
      }
      return result;
    }),
    set: vi.fn(async (keyOrItems: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrItems === 'string') {
        store.set(keyOrItems, value);
      } else {
        for (const [key, val] of Object.entries(keyOrItems)) {
          store.set(key, val);
        }
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        store.delete(key);
      }
    }),
    clear: vi.fn(async () => {
      store.clear();
    }),
  };
}

function createMockBrowserDownloads() {
  return {
    onCreated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTabs() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDnr() {
  return {
    updateSessionRules: vi.fn().mockResolvedValue(undefined),
  };
}

let sessionStore: ReturnType<typeof createMockStorageArea>;
let localStore: ReturnType<typeof createMockStorageArea>;
let mockDownloads: ReturnType<typeof createMockBrowserDownloads>;
let mockTabs: ReturnType<typeof createMockTabs>;
let mockDnr: ReturnType<typeof createMockDnr>;

function makeDownloadRequest(overrides: Partial<DownloadRequest> = {}): DownloadRequest {
  return {
    url: 'https://example.com/file.zip',
    filename: 'file.zip',
    headers: {},
    ...overrides,
  };
}

function makeDownloadTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '48a1b2c30000002d',
    request: makeDownloadRequest(),
    status: 'pending',
    bytesReceived: 0,
    totalBytes: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);

  sessionStore = createMockStorageArea();
  localStore = createMockStorageArea();
  mockDownloads = createMockBrowserDownloads();
  mockTabs = createMockTabs();
  mockDnr = createMockDnr();

  vi.stubGlobal('browser', {
    storage: {
      session: sessionStore,
      local: localStore,
    },
    downloads: mockDownloads,
    tabs: mockTabs,
    declarativeNetRequest: mockDnr,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================
describe('DownloadManager', () => {
  let manager: DownloadManager;

  beforeEach(() => {
    manager = new DownloadManager();
  });

  // ------------------------------------------------------------------
  // Constructor
  // ------------------------------------------------------------------
  describe('constructor', () => {
    it('registers onCreated listener on browser.downloads', () => {
      expect(mockDownloads.onCreated.addListener).toHaveBeenCalledTimes(1);
      expect(typeof mockDownloads.onCreated.addListener.mock.calls[0][0]).toBe('function');
    });

    it('registers onChanged listener on browser.downloads', () => {
      expect(mockDownloads.onChanged.addListener).toHaveBeenCalledTimes(1);
      expect(typeof mockDownloads.onChanged.addListener.mock.calls[0][0]).toBe('function');
    });

    it('registers TabDnrStrategy as a default strategy', () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      return expect(manager.create(request)).resolves.toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // registerStrategy
  // ------------------------------------------------------------------
  describe('registerStrategy', () => {
    it('allows adding a custom strategy that takes priority over defaults', async () => {
      const customExecute = vi.fn().mockResolvedValue({ success: true } as DownloadResult);
      const customStrategy: DownloadStrategy = {
        name: 'custom',
        canHandle: () => true,
        execute: customExecute,
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      manager.registerStrategy(customStrategy);

      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      await manager.create(request);

      expect(customExecute).toHaveBeenCalled();
    });

    it('falls back to next strategy when custom strategy cannot handle', async () => {
      const customStrategy: DownloadStrategy = {
        name: 'custom',
        canHandle: () => false,
        execute: vi.fn(),
        cancel: vi.fn(),
      };

      manager.registerStrategy(customStrategy);

      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      await manager.create(request);

      // TabDnrStrategy should handle it, tabs.create should be called
      expect(mockTabs.create).toHaveBeenCalledWith({
        url: 'https://example.com/file.zip',
        active: false,
      });
    });
  });

  // ------------------------------------------------------------------
  // create
  // ------------------------------------------------------------------
  describe('create', () => {
    it('returns a 16-character GID starting with "48"', async () => {
      const request = makeDownloadRequest();
      const gid = await manager.create(request);

      expect(gid).toHaveLength(16);
      expect(gid.startsWith(EXTENSION_PREFIX)).toBe(true);
    });

    it('creates a task with status "pending" in memory cache', async () => {
      const request = makeDownloadRequest();
      const gid = await manager.create(request);
      const task = manager.getTask(gid);

      expect(task).toBeDefined();
      expect(task!.status).toBe('pending');
      expect(task!.gid).toBe(gid);
      expect(task!.request.url).toBe(request.url);
    });

    it('persists the task via SessionStore', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      const result = await sessionStore.get('aria2_active_tasks');
      const sessionTasks = (result['aria2_active_tasks'] as DownloadTask[]) ?? [];
      expect(sessionTasks).toHaveLength(1);
      expect(sessionTasks[0].gid).toBe(gid);
      expect(sessionTasks[0].status).toBe('pending');
    });

    it('sets createdAt on the task', async () => {
      const request = makeDownloadRequest();
      const gid = await manager.create(request);
      const task = manager.getTask(gid);

      expect(task!.createdAt).toBeGreaterThan(0);
      expect(task!.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('sets up a 120s auto-cancel timeout for pending tasks', async () => {
      const request = makeDownloadRequest();
      const gid = await manager.create(request);

      // Advance time by 120s to trigger the timeout (async to flush microtasks)
      await vi.advanceTimersByTimeAsync(120_001);

      // After timeout, task is finalized (removed from cache)
      const tasks = manager.queryTasks({});
      expect(tasks).toHaveLength(0);

      // Verify it was cancelled and added to history
      const result = await localStore.get('aria2_download_history');
      const history = (result['aria2_download_history'] as DownloadTask[]) ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('cancelled');
      expect(history[0].error).toBeDefined();
    });

    it('calls strategy.execute with the request and task', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      await manager.create(request);

      // TabDnrStrategy should have called declarativeNetRequest.updateSessionRules
      expect(mockDnr.updateSessionRules).toHaveBeenCalled();
    });

    it('marks task as error when strategy.execute fails (but keeps in cache)', async () => {
      mockDnr.updateSessionRules.mockRejectedValueOnce(new Error('DNR failure'));

      const request = makeDownloadRequest({ url: 'https://example.com/fail.zip' });
      const gid = await manager.create(request);

      // Task should still be in cache with error status
      const task = manager.getTask(gid);
      expect(task).toBeDefined();
      expect(task!.status).toBe('error');
      expect(task!.error).toBe('DNR failure');
    });

    it('generates unique GIDs for concurrent requests', async () => {
      const gid1 = await manager.create(makeDownloadRequest({ url: 'https://a.com/file1.zip' }));
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://b.com/file2.zip' }));

      expect(gid1).not.toBe(gid2);
      expect(manager.getTask(gid1)).toBeDefined();
      expect(manager.getTask(gid2)).toBeDefined();
    });

    it('marks error when no strategy can handle the request', async () => {
      // Use ftp URL which TabDnrStrategy does not handle
      const request = makeDownloadRequest({ url: 'ftp://example.com/file.zip' });
      const gid = await manager.create(request);

      // Task stays in cache with error status (does NOT finalize)
      const task = manager.getTask(gid);
      expect(task).toBeDefined();
      expect(task!.status).toBe('error');
      expect(task!.error).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // getTask
  // ------------------------------------------------------------------
  describe('getTask', () => {
    it('returns the task for a known GID', async () => {
      const request = makeDownloadRequest();
      const gid = await manager.create(request);

      const task = manager.getTask(gid);
      expect(task).toBeDefined();
      expect(task!.gid).toBe(gid);
    });

    it('returns undefined for an unknown GID', () => {
      const task = manager.getTask('ffffffffffffffff');
      expect(task).toBeUndefined();
    });

    it('returns undefined for an empty string GID', () => {
      const task = manager.getTask('');
      expect(task).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // pause
  // ------------------------------------------------------------------
  describe('pause', () => {
    it('calls browser.downloads.pause with the browserDownloadId', async () => {
      const gid = await manager.create(makeDownloadRequest());
      const task = manager.getTask(gid)!;
      task.browserDownloadId = 42;

      await manager.pause(gid);
      expect(mockDownloads.pause).toHaveBeenCalledWith(42);
    });

    it('throws for an unknown GID', async () => {
      await expect(manager.pause('nonexistent')).rejects.toThrow(/unknown gid/i);
    });
  });

  // ------------------------------------------------------------------
  // resume
  // ------------------------------------------------------------------
  describe('resume', () => {
    it('calls browser.downloads.resume with the browserDownloadId', async () => {
      const gid = await manager.create(makeDownloadRequest());
      const task = manager.getTask(gid)!;
      task.browserDownloadId = 42;

      await manager.resume(gid);
      expect(mockDownloads.resume).toHaveBeenCalledWith(42);
    });

    it('throws for an unknown GID', async () => {
      await expect(manager.resume('nonexistent')).rejects.toThrow(/unknown gid/i);
    });
  });

  // ------------------------------------------------------------------
  // cancel
  // ------------------------------------------------------------------
  describe('cancel', () => {
    it('calls browser.downloads.cancel with the browserDownloadId', async () => {
      const gid = await manager.create(makeDownloadRequest());
      const task = manager.getTask(gid)!;
      task.browserDownloadId = 42;

      await manager.cancel(gid);
      expect(mockDownloads.cancel).toHaveBeenCalledWith(42);
    });

    it('marks the task as cancelled and removes from cache', async () => {
      const gid = await manager.create(makeDownloadRequest());
      const task = manager.getTask(gid)!;
      task.browserDownloadId = 42;

      await manager.cancel(gid);

      // After cancel finalizes, task should be removed from memory
      expect(manager.getTask(gid)).toBeUndefined();
    });

    it('throws for an unknown GID', async () => {
      await expect(manager.cancel('nonexistent')).rejects.toThrow(/unknown gid/i);
    });

    it('can cancel a pending task without browserDownloadId', async () => {
      const gid = await manager.create(makeDownloadRequest());
      const task = manager.getTask(gid)!;
      expect(task.browserDownloadId).toBeUndefined();

      await manager.cancel(gid);

      // Should be finalized (removed from cache)
      expect(manager.getTask(gid)).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // queryTasks
  // ------------------------------------------------------------------
  describe('queryTasks', () => {
    it('returns all tasks sorted by createdAt descending when no filter', async () => {
      vi.setSystemTime(1000);
      const gid1 = await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      vi.setSystemTime(2000);
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://b.com' }));
      vi.setSystemTime(3000);
      const gid3 = await manager.create(makeDownloadRequest({ url: 'https://c.com' }));

      const results = manager.queryTasks({});
      expect(results).toHaveLength(3);
      expect(results[0].gid).toBe(gid3);
      expect(results[1].gid).toBe(gid2);
      expect(results[2].gid).toBe(gid1);
    });

    it('filters by single status', async () => {
      vi.setSystemTime(1000);
      const gid1 = await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      const task1 = manager.getTask(gid1)!;
      task1.status = 'error';

      vi.setSystemTime(2000);
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://b.com' }));

      const pending = manager.queryTasks({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].gid).toBe(gid2);

      const errors = manager.queryTasks({ status: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0].gid).toBe(gid1);
    });

    it('filters by multiple statuses', async () => {
      vi.setSystemTime(1000);
      const gid1 = await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      const t1 = manager.getTask(gid1)!;
      t1.status = 'error';

      vi.setSystemTime(2000);
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://b.com' }));
      const t2 = manager.getTask(gid2)!;
      t2.status = 'complete';

      vi.setSystemTime(3000);
      const gid3 = await manager.create(makeDownloadRequest({ url: 'https://c.com' }));

      const results = manager.queryTasks({ status: ['pending', 'error'] });
      expect(results).toHaveLength(2);
    });

    it('applies a limit', async () => {
      vi.setSystemTime(1000);
      await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      vi.setSystemTime(2000);
      await manager.create(makeDownloadRequest({ url: 'https://b.com' }));
      vi.setSystemTime(3000);
      await manager.create(makeDownloadRequest({ url: 'https://c.com' }));

      const results = manager.queryTasks({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('applies an offset', async () => {
      vi.setSystemTime(1000);
      const gid1 = await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      vi.setSystemTime(2000);
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://b.com' }));
      vi.setSystemTime(3000);
      const gid3 = await manager.create(makeDownloadRequest({ url: 'https://c.com' }));

      const results = manager.queryTasks({ offset: 1 });
      expect(results).toHaveLength(2);
      expect(results[0].gid).toBe(gid2);
      expect(results[1].gid).toBe(gid1);
    });

    it('applies both limit and offset', async () => {
      vi.setSystemTime(1000);
      await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      vi.setSystemTime(2000);
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://b.com' }));
      vi.setSystemTime(3000);
      await manager.create(makeDownloadRequest({ url: 'https://c.com' }));

      const results = manager.queryTasks({ limit: 1, offset: 1 });
      expect(results).toHaveLength(1);
      expect(results[0].gid).toBe(gid2);
    });

    it('returns empty array when no tasks match filter', async () => {
      await manager.create(makeDownloadRequest());
      const results = manager.queryTasks({ status: 'complete' });
      expect(results).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // onTaskChange
  // ------------------------------------------------------------------
  describe('onTaskChange', () => {
    it('returns an unsubscribe function', () => {
      const unsubscribe = manager.onTaskChange(vi.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('notifies listener with a shallow copy of the task on create', async () => {
      const listener = vi.fn();
      manager.onTaskChange(listener);

      const request = makeDownloadRequest();
      const gid = await manager.create(request);

      expect(listener).toHaveBeenCalled();
      const notifiedTask = listener.mock.calls[0][0] as DownloadTask;
      expect(notifiedTask.gid).toBe(gid);
      expect(notifiedTask.status).toBe('pending');

      // Should be a shallow copy (not the same reference)
      const realTask = manager.getTask(gid)!;
      expect(notifiedTask).not.toBe(realTask);
    });

    it('does not call listener after unsubscribe', async () => {
      const listener = vi.fn();
      const unsubscribe = manager.onTaskChange(listener);

      await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      await manager.create(makeDownloadRequest({ url: 'https://b.com' }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies multiple listeners independently', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      manager.onTaskChange(listener1);
      manager.onTaskChange(listener2);

      await manager.create(makeDownloadRequest());

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('continues notifying other listeners when one throws', async () => {
      const badListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      manager.onTaskChange(badListener);
      manager.onTaskChange(goodListener);

      await manager.create(makeDownloadRequest());

      expect(goodListener).toHaveBeenCalled();
    });

    it('notifies on cancel', async () => {
      const listener = vi.fn();
      manager.onTaskChange(listener);

      const gid = await manager.create(makeDownloadRequest());
      const task = manager.getTask(gid)!;
      task.browserDownloadId = 42;
      listener.mockClear();

      await manager.cancel(gid);

      expect(listener).toHaveBeenCalled();
      const notifiedTask = listener.mock.calls[0][0] as DownloadTask;
      expect(notifiedTask.status).toBe('cancelled');
    });
  });

  // ------------------------------------------------------------------
  // handleDownloadCreated -- pending correlation
  // ------------------------------------------------------------------
  describe('handleDownloadCreated', () => {
    it('matches pending task by URL and binds browserDownloadId', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const oldGid = await manager.create(request);

      const originalTask = manager.getTask(oldGid)!;
      expect(originalTask.browserDownloadId).toBeUndefined();

      // Simulate onCreated event
      const downloadItem = {
        id: 99,
        url: 'https://example.com/file.zip',
        finalUrl: 'https://example.com/file.zip',
      };

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: typeof downloadItem) => Promise<void>;
      await onCreatedListener(downloadItem);

      // After correlation, task should have browserDownloadId
      // The old GID key is gone (re-encoded), but task is in queryTasks
      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].browserDownloadId).toBe(99);
    });

    it('re-encodes GID with real browser ID', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      // The original GID uses PLACEHOLDER_BROWSER_ID (0)
      expect(gid.endsWith('00000000')).toBe(true);

      const downloadItem = {
        id: 99,
        url: 'https://example.com/file.zip',
        finalUrl: 'https://example.com/file.zip',
      };

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: typeof downloadItem) => Promise<void>;
      await onCreatedListener(downloadItem);

      // The original GID should no longer be in the map
      expect(manager.getTask(gid)).toBeUndefined();

      // But the task should still be accessible via queryTasks with new GID
      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      // The gid should end with the hex of 99 (0x63)
      expect(allTasks[0].gid.endsWith('00000063')).toBe(true);
      expect(allTasks[0].browserDownloadId).toBe(99);
    });

    it('removes task from pending map after matching', async () => {
      const url = 'https://example.com/file.zip';
      const request = makeDownloadRequest({ url });
      await manager.create(request);

      const downloadItem = {
        id: 99,
        url,
        finalUrl: url,
      };

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: typeof downloadItem) => Promise<void>;
      await onCreatedListener(downloadItem);

      // Create another download with the same URL to ensure the first was removed
      const gid2 = await manager.create(makeDownloadRequest({ url: 'https://another.com/other.zip' }));

      // Simulate another download created event with the first URL
      const downloadItem2 = {
        id: 100,
        url,
        finalUrl: url,
      };
      // Should not crash and should not affect tasks
      await onCreatedListener(downloadItem2);

      // The second task should still be pending
      const task2 = manager.getTask(gid2);
      expect(task2).toBeDefined();
    });

    it('clears the pending timeout after matching', async () => {
      const url = 'https://example.com/file.zip';
      const request = makeDownloadRequest({ url });
      const gid = await manager.create(request);

      const downloadItem = {
        id: 99,
        url,
        finalUrl: url,
      };

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: typeof downloadItem) => Promise<void>;
      await onCreatedListener(downloadItem);

      // Advance time by 120s -- the task should NOT be cancelled
      vi.advanceTimersByTime(120_001);

      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].status).not.toBe('cancelled');
    });

    it('does not match when neither url nor finalUrl are registered', async () => {
      // Register under originalUrl only
      const gid = await manager.create(makeDownloadRequest({ url: 'https://example.com/file.a' }));

      // onCreated fires with a completely different URL
      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string; finalUrl?: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://other.com/other.b', finalUrl: 'https://other.com/other.b' });

      // Task should remain unmatched
      const task = manager.getTask(gid);
      expect(task).toBeDefined();
      expect(task!.browserDownloadId).toBeUndefined();
      expect(task!.status).toBe('pending');
    });

    it('calls TabDnrStrategy.cleanupOnMatched after correlation', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      // Before correlation: DNR called once for rule creation
      const dnrCalledBefore = mockDnr.updateSessionRules.mock.calls.length;

      const downloadItem = {
        id: 99,
        url: 'https://example.com/file.zip',
        finalUrl: 'https://example.com/file.zip',
      };

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: typeof downloadItem) => Promise<void>;
      await onCreatedListener(downloadItem);

      // After correlation: DNR called again for cleanup (removeRuleIds)
      expect(mockDnr.updateSessionRules.mock.calls.length).toBeGreaterThan(dnrCalledBefore);
    });
  });

  // ------------------------------------------------------------------
  // handleDownloadChanged -- progress and completion
  // ------------------------------------------------------------------
  describe('handleDownloadChanged', () => {
    it('updates status from delta state', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      // Simulate onCreated
      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://example.com/file.zip', finalUrl: 'https://example.com/file.zip' } as { id: number; url: string; finalUrl: string });

      // Simulate onChanged
      const onChangedListener = mockDownloads.onChanged.addListener.mock.calls[0][0] as (delta: { id: number; state?: { current: string } }) => Promise<void>;
      await onChangedListener({
        id: 99,
        state: { current: 'in_progress' },
      });

      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].status).toBe('in_progress');
    });

    it('updates bytesReceived from delta', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      await manager.create(request);

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://example.com/file.zip', finalUrl: 'https://example.com/file.zip' } as { id: number; url: string; finalUrl: string });

      const onChangedListener = mockDownloads.onChanged.addListener.mock.calls[0][0] as (delta: { id: number; bytesReceived?: { current: number } }) => Promise<void>;
      await onChangedListener({
        id: 99,
        bytesReceived: { current: 1024 },
      });

      const allTasks = manager.queryTasks({});
      expect(allTasks[0].bytesReceived).toBe(1024);
    });

    it('calls finalizeTask when status is "complete"', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://example.com/file.zip', finalUrl: 'https://example.com/file.zip' } as { id: number; url: string; finalUrl: string });

      const onChangedListener = mockDownloads.onChanged.addListener.mock.calls[0][0] as (delta: { id: number; state?: { current: string } }) => Promise<void>;
      await onChangedListener({
        id: 99,
        state: { current: 'complete' },
      });

      // After finalizeTask awaits, task removed from cache
      expect(manager.getTask(gid)).toBeUndefined();

      // Task should be in LocalStore history
      const result = await localStore.get('aria2_download_history');
      const historyTasks = (result['aria2_download_history'] as DownloadTask[]) ?? [];
      expect(historyTasks).toHaveLength(1);
      expect(historyTasks[0].status).toBe('complete');
    });

    it('calls finalizeTask when browser reports "interrupted" status', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://example.com/file.zip', finalUrl: 'https://example.com/file.zip' } as { id: number; url: string; finalUrl: string });

      const onChangedListener = mockDownloads.onChanged.addListener.mock.calls[0][0] as (delta: { id: number; state?: { current: string } }) => Promise<void>;
      await onChangedListener({
        id: 99,
        state: { current: 'interrupted' },
      });

      // Task should be finalized (error status triggers finalize)
      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Timeout -- auto-cancel pending tasks
  // ------------------------------------------------------------------
  describe('pending timeout', () => {
    it('auto-cancels a pending task after 120 seconds', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      // Verify status is pending
      expect(manager.getTask(gid)!.status).toBe('pending');

      // Advance time past 120s to trigger timeout (async to flush microtasks)
      await vi.advanceTimersByTimeAsync(120_001);

      // After timeout, task is finalized (removed from cache)
      expect(manager.getTask(gid)).toBeUndefined();

      // Should be added to history as cancelled
      const result = await localStore.get('aria2_download_history');
      const history = (result['aria2_download_history'] as DownloadTask[]) ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('cancelled');
    });

    it('does not auto-cancel before 120 seconds', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      vi.advanceTimersByTime(119_000);

      expect(manager.getTask(gid)!.status).toBe('pending');
    });

    it('does not auto-cancel a task that was already matched', async () => {
      const request = makeDownloadRequest({ url: 'https://example.com/file.zip' });
      const gid = await manager.create(request);

      // Simulate onCreated matching
      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://example.com/file.zip', finalUrl: 'https://example.com/file.zip' } as { id: number; url: string; finalUrl: string });

      vi.advanceTimersByTime(120_001);

      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].status).not.toBe('cancelled');
    });

    it('notifies listeners when task is auto-cancelled', async () => {
      const listener = vi.fn();
      manager.onTaskChange(listener);

      const gid = await manager.create(makeDownloadRequest());
      listener.mockClear();

      await vi.advanceTimersByTimeAsync(120_001);

      expect(listener).toHaveBeenCalled();
      const notifiedTask = listener.mock.calls[0][0] as DownloadTask;
      expect(notifiedTask.status).toBe('cancelled');
    });
  });

  // ------------------------------------------------------------------
  // hydrate
  // ------------------------------------------------------------------
  describe('hydrate', () => {
    it('restores tasks from SessionStore into memory cache', async () => {
      // Use recent timestamps so that pending tasks are not immediately expired
      const now = Date.now();
      const storedTasks: DownloadTask[] = [
        makeDownloadTask({ gid: '48a1b2c300000001', status: 'in_progress', browserDownloadId: 1, createdAt: now - 10_000 }),
        makeDownloadTask({ gid: '48a1b2c300000002', status: 'pending', createdAt: now - 10_000 }),
      ];

      await sessionStore.set('aria2_active_tasks', storedTasks);

      await manager.hydrate();

      const task1 = manager.getTask('48a1b2c300000001');
      const task2 = manager.getTask('48a1b2c300000002');

      expect(task1).toBeDefined();
      expect(task1!.status).toBe('in_progress');
      expect(task1!.browserDownloadId).toBe(1);

      expect(task2).toBeDefined();
      expect(task2!.status).toBe('pending');
    });

    it('sets up pending correlation for tasks with pending status', async () => {
      const now = Date.now();
      const storedTasks: DownloadTask[] = [
        makeDownloadTask({
          gid: '48a1b2c300000001',
          status: 'pending',
          createdAt: now - 10_000,
          request: makeDownloadRequest({ url: 'https://example.com/file.zip' }),
        }),
      ];

      await sessionStore.set('aria2_active_tasks', storedTasks);
      await manager.hydrate();

      // Pending task should be in memory cache
      const task = manager.getTask('48a1b2c300000001');
      expect(task).toBeDefined();

      // Simulate onCreated matching
      const onCreatedListener = mockDownloads.onCreated.addListener.mock.calls[0][0] as (item: { id: number; url: string }) => Promise<void>;
      await onCreatedListener({ id: 99, url: 'https://example.com/file.zip', finalUrl: 'https://example.com/file.zip' } as { id: number; url: string; finalUrl: string });

      // Task should now be correlated
      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].browserDownloadId).toBe(99);
    });

    it('clears existing memory cache before restoring', async () => {
      await manager.create(makeDownloadRequest({ url: 'https://a.com' }));
      await manager.create(makeDownloadRequest({ url: 'https://b.com' }));

      expect(manager.queryTasks({})).toHaveLength(2);

      const now = Date.now();
      const storedTasks: DownloadTask[] = [
        makeDownloadTask({ gid: '48a1b2c3000000ff', status: 'complete', createdAt: now - 5_000 }),
      ];
      await sessionStore.set('aria2_active_tasks', storedTasks);
      await manager.hydrate();

      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].gid).toBe('48a1b2c3000000ff');
    });

    it('sets up timeout for hydrated pending tasks based on remaining time', async () => {
      // Create a task from 60s ago (halfway through timeout)
      const now = Date.now();
      const sixtySecondsAgo = now - 60_000;

      const storedTasks: DownloadTask[] = [
        makeDownloadTask({
          gid: '48a1b2c3000000aa',
          status: 'pending',
          createdAt: sixtySecondsAgo,
          request: makeDownloadRequest({ url: 'https://example.com/file.zip' }),
        }),
      ];

      await sessionStore.set('aria2_active_tasks', storedTasks);
      await manager.hydrate();

      // After 60 more seconds, should auto-cancel
      await vi.advanceTimersByTimeAsync(61_000);

      const allTasks = manager.queryTasks({});
      expect(allTasks).toHaveLength(0); // finalized and removed
    });
  });
});
