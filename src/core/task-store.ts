import { openDB, type IDBPDatabase } from 'idb';
import type { DownloadTask, TaskStatus } from './types';

export interface QueryOptions {
  status?: TaskStatus;
  offset?: number;
  num?: number;
  sort?: 'createdAt' | 'updatedAt';
  sortDir?: 'asc' | 'desc';
}

const DB_VERSION = 1;

export class TaskStore {
  private db: IDBPDatabase | null = null;
  private ready: Promise<void>;

  constructor(private dbName = 'aria2-tasks') {
    this.ready = this.init();
  }

  async init(): Promise<void> {
    this.db = await openDB(this.dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tasks')) {
          const store = db.createObjectStore('tasks', { keyPath: 'gid' });
          store.createIndex('status', 'status');
          store.createIndex('browserDownloadId', 'browserDownloadId');
          store.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
  }

  private async ensureReady(): Promise<IDBPDatabase> {
    await this.ready;
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  async upsert(task: DownloadTask): Promise<void> {
    const db = await this.ensureReady();
    task.updatedAt = Date.now();
    await db.put('tasks', task);
  }

  async get(gid: string): Promise<DownloadTask | undefined> {
    const db = await this.ensureReady();
    return db.get('tasks', gid);
  }

  async getByBrowserId(browserDownloadId: number): Promise<DownloadTask | undefined> {
    const db = await this.ensureReady();
    return db.getFromIndex('tasks', 'browserDownloadId', browserDownloadId);
  }

  async getPendingByUrl(url: string): Promise<DownloadTask | undefined> {
    const db = await this.ensureReady();
    const all = await db.getAllFromIndex('tasks', 'status', 'pending');
    return all.find((t) => t.uris.includes(url));
  }

  async query(opts: QueryOptions = {}): Promise<DownloadTask[]> {
    const db = await this.ensureReady();
    let results: DownloadTask[];
    if (opts.status) {
      results = await db.getAllFromIndex('tasks', 'status', opts.status);
    } else {
      results = await db.getAll('tasks');
    }
    results.sort((a, b) => {
      const field = opts.sort || 'createdAt';
      const dir = opts.sortDir === 'desc' ? -1 : 1;
      return (a[field] - b[field]) * dir;
    });
    if (opts.offset !== undefined) {
      results = results.slice(opts.offset, opts.offset + (opts.num || results.length));
    } else if (opts.num !== undefined) {
      results = results.slice(0, opts.num);
    }
    return results;
  }

  async count(status?: TaskStatus): Promise<number> {
    const db = await this.ensureReady();
    if (status) {
      return db.countFromIndex('tasks', 'status', status);
    }
    return db.count('tasks');
  }

  async delete(gid: string): Promise<void> {
    const db = await this.ensureReady();
    await db.delete('tasks', gid);
  }

  async purge(status: TaskStatus): Promise<void> {
    const db = await this.ensureReady();
    const keys = await db.getAllKeysFromIndex('tasks', 'status', status);
    for (const key of keys) {
      await db.delete('tasks', key);
    }
  }

  async getAll(): Promise<DownloadTask[]> {
    const db = await this.ensureReady();
    return db.getAll('tasks');
  }
}
