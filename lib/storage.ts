import type { DownloadTask, AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

const ACTIVE_TASKS_KEY = 'aria2_active_tasks' as const;
const SESSION_LOCAL_KEY = 'aria2_session_active_tasks' as const;
const SETTINGS_KEY = 'aria2_settings' as const;
const HISTORY_KEY = 'aria2_download_history' as const;
const MAX_HISTORY = 500 as const;

// ============================================================================
// SessionStore — manages active download tasks in session storage
// ============================================================================

function getSessionArea() {
  return browser.storage.session ?? browser.storage.local;
}

function getSessionKey() {
  return browser.storage.session ? ACTIVE_TASKS_KEY : SESSION_LOCAL_KEY;
}

export namespace SessionStore {
  async function readAll(): Promise<DownloadTask[]> {
    const area = getSessionArea();
    const key = getSessionKey();
    const result = await area.get({ [key]: [] });
    const tasks = result[key];
    return Array.isArray(tasks) ? tasks : [];
  }

  async function writeAll(tasks: DownloadTask[]): Promise<void> {
    const area = getSessionArea();
    const key = getSessionKey();
    await area.set({ [key]: tasks });
  }

  /**
   * Upserts a task by gid into session storage.
   */
  export async function putTask(task: DownloadTask): Promise<void> {
    const tasks = await readAll();
    const index = tasks.findIndex((t) => t.gid === task.gid);
    const updated = index === -1 ? [...tasks, task] : tasks.map((t, i) => (i === index ? task : t));
    await writeAll(updated);
  }

  /**
   * Returns the task with the given gid, or null if not found.
   */
  export async function getTask(gid: string): Promise<DownloadTask | null> {
    const tasks = await readAll();
    return tasks.find((t) => t.gid === gid) ?? null;
  }

  /**
   * Returns all active tasks sorted by createdAt descending.
   */
  export async function getAllTasks(): Promise<DownloadTask[]> {
    const tasks = await readAll();
    return [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Removes a task by gid from session storage.
   */
  export async function removeTask(gid: string): Promise<void> {
    const tasks = await readAll();
    const filtered = tasks.filter((t) => t.gid !== gid);
    await writeAll(filtered);
  }
}

// ============================================================================
// LocalStore — manages persistent settings and download history
// ============================================================================
export namespace LocalStore {
  /**
   * Returns the full AppSettings, merging stored values with DEFAULT_SETTINGS.
   */
  export async function getSettings(): Promise<AppSettings> {
    const result = await browser.storage.local.get({ [SETTINGS_KEY]: {} });
    const stored = result[SETTINGS_KEY] ?? {};
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      perSiteOverrides: {
        ...DEFAULT_SETTINGS.perSiteOverrides,
        ...(stored as Partial<AppSettings>).perSiteOverrides,
      },
    };
    return merged;
  }

  /**
   * Writes the full AppSettings object to local storage.
   */
  export async function putSettings(settings: AppSettings): Promise<void> {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  /**
   * Returns whether interception is enabled for the given origin.
   * Defaults to true (opt-out model).
   */
  export async function getPerSiteEnabled(origin: string): Promise<boolean> {
    const settings = await getSettings();
    return settings.perSiteOverrides[origin] ?? true;
  }

  /**
   * Sets whether interception is enabled for the given origin.
   */
  export async function setPerSiteEnabled(origin: string, enabled: boolean): Promise<void> {
    const settings = await getSettings();
    const updated: AppSettings = {
      ...settings,
      perSiteOverrides: {
        ...settings.perSiteOverrides,
        [origin]: enabled,
      },
    };
    await putSettings(updated);
  }

  /**
   * Returns the download history, sliced to the given limit.
   */
  export async function getDownloadHistory(limit: number): Promise<DownloadTask[]> {
    const result = await browser.storage.local.get({ [HISTORY_KEY]: [] });
    const history: DownloadTask[] = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    return history.slice(0, limit);
  }

  /**
   * Prepends a task to the download history, capping at MAX_HISTORY entries.
   */
  export async function addToHistory(task: DownloadTask): Promise<void> {
    const result = await browser.storage.local.get({ [HISTORY_KEY]: [] });
    const history: DownloadTask[] = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    const updated = [task, ...history].slice(0, MAX_HISTORY);
    await browser.storage.local.set({ [HISTORY_KEY]: updated });
  }

  /**
   * Removes a task from the download history by GID.
   */
  export async function removeFromHistory(gid: string): Promise<void> {
    const result = await browser.storage.local.get({ [HISTORY_KEY]: [] });
    const history: DownloadTask[] = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    const updated = history.filter((t) => t.gid !== gid);
    await browser.storage.local.set({ [HISTORY_KEY]: updated });
  }

  /**
   * Removes all terminal (complete/error/cancelled) tasks from download history,
   * preserving only active tasks (pending/in_progress/paused).
   */
  export async function purgeTerminalHistory(): Promise<void> {
    const TERMINAL = new Set(['complete', 'error', 'cancelled']);
    const result = await browser.storage.local.get({ [HISTORY_KEY]: [] });
    const history: DownloadTask[] = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    const updated = history.filter((t) => !TERMINAL.has(t.status));
    await browser.storage.local.set({ [HISTORY_KEY]: updated });
  }
}
