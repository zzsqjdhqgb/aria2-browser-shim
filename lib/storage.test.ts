import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DownloadTask, AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  SessionStore,
  LocalStore,
} from './storage';

// ============================================================================
// Mock browser.storage.session and browser.storage.local as in-memory Maps
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
      // Object form: keys is a Record<string, unknown> with default values
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(keys)) {
        result[key] = store.has(key) ? store.get(key) : (keys as Record<string, unknown>)[key];
      }
      return result;
    }),
    set: vi.fn(async (keyOrItems: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrItems === 'string') {
        // Called as set(key, value) — convenience form in tests
        store.set(keyOrItems, value);
      } else {
        // Called as set({ key: value }) — real browser API form
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

let sessionStore: ReturnType<typeof createMockStorageArea>;
let localStore: ReturnType<typeof createMockStorageArea>;

function makeDownloadTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: 'abc123',
    request: { url: 'https://example.com/file.bin' },
    status: 'pending',
    bytesReceived: 0,
    totalBytes: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  sessionStore = createMockStorageArea();
  localStore = createMockStorageArea();

  vi.stubGlobal('browser', {
    storage: {
      session: sessionStore,
      local: localStore,
    },
  });
});

// ============================================================================
// SessionStore tests
// ============================================================================
describe('SessionStore', () => {
  describe('putTask', () => {
    it('stores a task when session storage is empty', async () => {
      const task = makeDownloadTask();

      await SessionStore.putTask(task);

      const result = await sessionStore.get('aria2_active_tasks');
      expect(result['aria2_active_tasks']).toEqual([task]);
    });

    it('appends a task when other tasks already exist', async () => {
      const task1 = makeDownloadTask({ gid: 'gid-1' });
      const task2 = makeDownloadTask({ gid: 'gid-2' });

      await SessionStore.putTask(task1);
      await SessionStore.putTask(task2);

      const result = await sessionStore.get('aria2_active_tasks');
      const tasks = result['aria2_active_tasks'] as DownloadTask[];
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.gid)).toEqual(['gid-1', 'gid-2']);
    });

    it('upserts by gid — replaces an existing task with the same gid', async () => {
      const original = makeDownloadTask({ gid: 'same-gid', status: 'pending' });
      await SessionStore.putTask(original);

      const updated = makeDownloadTask({ gid: 'same-gid', status: 'complete' });
      await SessionStore.putTask(updated);

      const result = await sessionStore.get('aria2_active_tasks');
      const tasks = result['aria2_active_tasks'] as DownloadTask[];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('complete');
    });

    it('does not affect tasks with different gids when upserting', async () => {
      const taskA = makeDownloadTask({ gid: 'gid-a', request: { url: 'https://a.com' } });
      const taskB = makeDownloadTask({ gid: 'gid-b', request: { url: 'https://b.com' } });
      await SessionStore.putTask(taskA);
      await SessionStore.putTask(taskB);

      const updatedA = makeDownloadTask({ gid: 'gid-a', status: 'complete' });
      await SessionStore.putTask(updatedA);

      const result = await sessionStore.get('aria2_active_tasks');
      const tasks = result['aria2_active_tasks'] as DownloadTask[];
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.gid === 'gid-a')!.status).toBe('complete');
      expect(tasks.find((t) => t.gid === 'gid-b')!.request.url).toBe('https://b.com');
    });
  });

  describe('getTask', () => {
    it('returns a task by gid when it exists', async () => {
      const task = makeDownloadTask({ gid: 'find-me' });
      await SessionStore.putTask(task);

      const result = await SessionStore.getTask('find-me');
      expect(result).toEqual(task);
    });

    it('returns null when no task with the given gid exists', async () => {
      await SessionStore.putTask(makeDownloadTask({ gid: 'abc' }));

      const result = await SessionStore.getTask('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when storage is empty', async () => {
      const result = await SessionStore.getTask('any-gid');
      expect(result).toBeNull();
    });

    it('returns the correct task when multiple tasks are stored', async () => {
      const task1 = makeDownloadTask({ gid: 'first' });
      const task2 = makeDownloadTask({ gid: 'second' });
      const task3 = makeDownloadTask({ gid: 'third' });
      await SessionStore.putTask(task1);
      await SessionStore.putTask(task2);
      await SessionStore.putTask(task3);

      const result = await SessionStore.getTask('second');
      expect(result).toEqual(task2);
    });
  });

  describe('getAllTasks', () => {
    it('returns an empty array when no tasks are stored', async () => {
      const result = await SessionStore.getAllTasks();
      expect(result).toEqual([]);
    });

    it('returns all tasks sorted by createdAt descending', async () => {
      const task1 = makeDownloadTask({ gid: 'oldest', createdAt: 1000 });
      const task2 = makeDownloadTask({ gid: 'middle', createdAt: 2000 });
      const task3 = makeDownloadTask({ gid: 'newest', createdAt: 3000 });

      await SessionStore.putTask(task1);
      await SessionStore.putTask(task2);
      await SessionStore.putTask(task3);

      const result = await SessionStore.getAllTasks();
      expect(result).toHaveLength(3);
      expect(result[0].gid).toBe('newest');
      expect(result[1].gid).toBe('middle');
      expect(result[2].gid).toBe('oldest');
    });

    it('returns a copy, not a reference, of the stored array', async () => {
      await SessionStore.putTask(makeDownloadTask({ gid: 'original' }));

      const tasks = await SessionStore.getAllTasks();
      tasks.pop();

      // Should still be there
      const stillThere = await SessionStore.getTask('original');
      expect(stillThere).not.toBeNull();
    });

    it('handles tasks with equal createdAt timestamps', async () => {
      const ts = Date.now();
      const task1 = makeDownloadTask({ gid: 'a', createdAt: ts });
      const task2 = makeDownloadTask({ gid: 'b', createdAt: ts });
      await SessionStore.putTask(task1);
      await SessionStore.putTask(task2);

      const result = await SessionStore.getAllTasks();
      expect(result).toHaveLength(2);
    });
  });

  describe('removeTask', () => {
    it('removes a task by gid', async () => {
      await SessionStore.putTask(makeDownloadTask({ gid: 'remove-me' }));
      await SessionStore.putTask(makeDownloadTask({ gid: 'keep-me' }));

      await SessionStore.removeTask('remove-me');

      const result = await SessionStore.getAllTasks();
      expect(result).toHaveLength(1);
      expect(result[0].gid).toBe('keep-me');
    });

    it('is a no-op when the gid does not exist', async () => {
      await SessionStore.putTask(makeDownloadTask({ gid: 'only-one' }));

      await SessionStore.removeTask('nonexistent');

      const result = await SessionStore.getAllTasks();
      expect(result).toHaveLength(1);
      expect(result[0].gid).toBe('only-one');
    });

    it('clears the entire active tasks array when the last task is removed', async () => {
      await SessionStore.putTask(makeDownloadTask({ gid: 'last-one' }));

      await SessionStore.removeTask('last-one');

      const result = await SessionStore.getAllTasks();
      expect(result).toEqual([]);
    });
  });
});

// ============================================================================
// LocalStore tests
// ============================================================================
describe('LocalStore', () => {
  describe('getSettings', () => {
    it('returns DEFAULT_SETTINGS when nothing is stored', async () => {
      const settings = await LocalStore.getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('merges stored settings with DEFAULT_SETTINGS (partial override)', async () => {
      await localStore.set('aria2_settings', {
        interceptionEnabled: false,
        pendingTimeoutMs: 60_000,
      } satisfies Partial<AppSettings>);

      const settings = await LocalStore.getSettings();

      expect(settings.interceptionEnabled).toBe(false);
      expect(settings.pendingTimeoutMs).toBe(60_000);
      // perSiteOverrides should come from DEFAULT_SETTINGS
      expect(settings.perSiteOverrides).toEqual({});
    });

    it('returns stored perSiteOverrides merged with defaults', async () => {
      await localStore.set('aria2_settings', {
        perSiteOverrides: { 'https://example.com': false },
      } satisfies Partial<AppSettings>);

      const settings = await LocalStore.getSettings();

      expect(settings.perSiteOverrides).toEqual({ 'https://example.com': false });
      expect(settings.interceptionEnabled).toBe(true); // from DEFAULT_SETTINGS
    });
  });

  describe('putSettings', () => {
    it('writes settings to local storage', async () => {
      const customSettings: AppSettings = {
        interceptionEnabled: false,
        perSiteOverrides: { 'https://foo.com': false },
        pendingTimeoutMs: 30_000,
      };

      await LocalStore.putSettings(customSettings);

      const result = await localStore.get('aria2_settings');
      expect(result['aria2_settings']).toEqual(customSettings);
    });

    it('overwrites previous settings', async () => {
      const first: AppSettings = { ...DEFAULT_SETTINGS, interceptionEnabled: false };
      const second: AppSettings = { ...DEFAULT_SETTINGS, interceptionEnabled: true };

      await LocalStore.putSettings(first);
      await LocalStore.putSettings(second);

      const result = await localStore.get('aria2_settings');
      expect((result['aria2_settings'] as AppSettings).interceptionEnabled).toBe(true);
    });
  });

  describe('getPerSiteEnabled', () => {
    it('returns true by default for any origin (default-enabled)', async () => {
      const enabled = await LocalStore.getPerSiteEnabled('https://unknown.com');
      expect(enabled).toBe(true);
    });

    it('returns false when origin is explicitly disabled in settings', async () => {
      await localStore.set('aria2_settings', {
        perSiteOverrides: { 'https://blocked.com': false },
      });

      const enabled = await LocalStore.getPerSiteEnabled('https://blocked.com');
      expect(enabled).toBe(false);
    });

    it('returns true when origin is explicitly enabled in settings', async () => {
      await localStore.set('aria2_settings', {
        perSiteOverrides: { 'https://allowed.com': true },
      });

      const enabled = await LocalStore.getPerSiteEnabled('https://allowed.com');
      expect(enabled).toBe(true);
    });

    it('returns true for an origin not in perSiteOverrides even when others are overridden', async () => {
      await localStore.set('aria2_settings', {
        perSiteOverrides: {
          'https://blocked.com': false,
          'https://allowed.com': true,
        },
      });

      const enabled = await LocalStore.getPerSiteEnabled('https://unknown.com');
      expect(enabled).toBe(true);
    });
  });

  describe('setPerSiteEnabled', () => {
    it('adds a new perSiteOverride when none exist yet', async () => {
      await LocalStore.setPerSiteEnabled('https://example.com', false);

      const result = await localStore.get('aria2_settings');
      const settings = result['aria2_settings'] as AppSettings;
      expect(settings.perSiteOverrides['https://example.com']).toBe(false);
    });

    it('updates an existing perSiteOverride', async () => {
      await localStore.set('aria2_settings', {
        perSiteOverrides: { 'https://example.com': false },
      });

      await LocalStore.setPerSiteEnabled('https://example.com', true);

      const result = await localStore.get('aria2_settings');
      const settings = result['aria2_settings'] as AppSettings;
      expect(settings.perSiteOverrides['https://example.com']).toBe(true);
    });

    it('preserves other settings fields when adding override', async () => {
      await localStore.set('aria2_settings', {
        interceptionEnabled: false,
        pendingTimeoutMs: 45_000,
        perSiteOverrides: {},
      });

      await LocalStore.setPerSiteEnabled('https://example.com', false);

      const result = await localStore.get('aria2_settings');
      const settings = result['aria2_settings'] as AppSettings;
      expect(settings.interceptionEnabled).toBe(false);
      expect(settings.pendingTimeoutMs).toBe(45_000);
      expect(settings.perSiteOverrides['https://example.com']).toBe(false);
    });
  });

  describe('getDownloadHistory', () => {
    it('returns an empty array when no history exists', async () => {
      const history = await LocalStore.getDownloadHistory(10);
      expect(history).toEqual([]);
    });

    it('returns tasks sliced to the given limit', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeDownloadTask({ gid: `hist-${i}`, createdAt: 1000 + i * 100 }),
      );

      await localStore.set('aria2_download_history', tasks);

      const result = await LocalStore.getDownloadHistory(5);
      expect(result).toHaveLength(5);
      // Should be the first 5 (most recent since they're in chronological order
      // in this test, but the underlying array order is as-stored)
    });

    it('returns all tasks when limit exceeds stored count', async () => {
      const tasks = [
        makeDownloadTask({ gid: 'h1' }),
        makeDownloadTask({ gid: 'h2' }),
      ];

      await localStore.set('aria2_download_history', tasks);

      const result = await LocalStore.getDownloadHistory(100);
      expect(result).toHaveLength(2);
    });

    it('returns a copy, not a reference', async () => {
      await localStore.set('aria2_download_history', [makeDownloadTask({ gid: 'orig' })]);

      const history = await LocalStore.getDownloadHistory(10);
      history.push(makeDownloadTask({ gid: 'extra' }));

      // Original should not be affected
      const fresh = await LocalStore.getDownloadHistory(10);
      expect(fresh).toHaveLength(1);
    });
  });

  describe('addToHistory', () => {
    it('prepends task to an empty history', async () => {
      const task = makeDownloadTask({ gid: 'first-ever' });

      await LocalStore.addToHistory(task);

      const result = await localStore.get('aria2_download_history');
      const history = result['aria2_download_history'] as DownloadTask[];
      expect(history).toHaveLength(1);
      expect(history[0].gid).toBe('first-ever');
    });

    it('prepends task to existing history', async () => {
      const oldTask = makeDownloadTask({ gid: 'older', createdAt: 1000 });
      await localStore.set('aria2_download_history', [oldTask]);

      const newTask = makeDownloadTask({ gid: 'newer', createdAt: 2000 });
      await LocalStore.addToHistory(newTask);

      const result = await localStore.get('aria2_download_history');
      const history = result['aria2_download_history'] as DownloadTask[];
      expect(history).toHaveLength(2);
      expect(history[0].gid).toBe('newer');
      expect(history[1].gid).toBe('older');
    });

    it('caps history at 500 entries', async () => {
      const existingTasks = Array.from({ length: 500 }, (_, i) =>
        makeDownloadTask({ gid: `old-${i}`, createdAt: i }),
      );
      await localStore.set('aria2_download_history', existingTasks);

      const newTask = makeDownloadTask({ gid: 'overflow', createdAt: 9999 });
      await LocalStore.addToHistory(newTask);

      const result = await localStore.get('aria2_download_history');
      const history = result['aria2_download_history'] as DownloadTask[];
      expect(history).toHaveLength(500);
      expect(history[0].gid).toBe('overflow');
      // The last old task (old-0 with smallest createdAt at index 0) gets evicted;
      // after prepend and slice, history[499] is old-498
      expect(history[499].gid).toBe('old-498');
    });

    it('does not exceed 500 even when adding to a fresh empty history multiple times', async () => {
      for (let i = 0; i < 502; i++) {
        await LocalStore.addToHistory(makeDownloadTask({ gid: `task-${i}`, createdAt: 10000 - i }));
      }

      const result = await localStore.get('aria2_download_history');
      const history = result['aria2_download_history'] as DownloadTask[];
      expect(history).toHaveLength(500);
      // Most recently added should be first
      expect(history[0].gid).toBe('task-501');
    });
  });
});
