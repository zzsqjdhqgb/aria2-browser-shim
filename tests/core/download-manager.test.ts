import { describe, it, expect } from 'vitest';
import { DownloadManager } from '../../src/core/download-manager';
import { TaskStore } from '../../src/core/task-store';

describe('DownloadManager', () => {
  it('can be instantiated', () => {
    const store = new TaskStore('test-dm-' + Date.now());
    const dm = new DownloadManager(store);
    expect(dm).toBeDefined();
  });

  it('init can be called (no chrome API in test)', () => {
    const store = new TaskStore('test-dm-init-' + Date.now());
    const dm = new DownloadManager(store);
    expect(() => dm.init()).not.toThrow();
  });

  it('onTaskChange registers a callback', () => {
    const store = new TaskStore('test-dm-cb-' + Date.now());
    const dm = new DownloadManager(store);
    const cb = () => {};
    dm.onTaskChange(cb);
    expect(dm).toBeDefined();
  });

  it('getGlobalStat returns stats', async () => {
    const store = new TaskStore('test-dm-stat-' + Date.now());
    await store.init();
    const dm = new DownloadManager(store);
    const stat = await dm.getGlobalStat();
    expect(stat).toHaveProperty('downloadSpeed');
    expect(stat).toHaveProperty('numActive');
    expect(stat.numActive).toBe('0');
  });

  it('getActiveTasks returns empty array', async () => {
    const store = new TaskStore('test-dm-active-' + Date.now());
    await store.init();
    const dm = new DownloadManager(store);
    const tasks = await dm.getActiveTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);
  });
});
