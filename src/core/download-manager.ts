import type { DownloadRequest, DownloadTask, Aria2GlobalStat, TaskStatus } from './types';
import { TaskStore, type QueryOptions } from './task-store';
import { generateGid } from './gid';
import { parseHeaderArray, headersToArray } from './headers';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_RULE_ID = 1000000;

export class DownloadManager {
  private taskStore: TaskStore;
  private changeCallbacks: Array<(task: DownloadTask) => void> = [];
  private nextRuleId = 1;
  private pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private initialized = false;

  constructor(taskStore: TaskStore) {
    this.taskStore = taskStore;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof chrome !== 'undefined' && chrome.downloads) {
      chrome.downloads.onCreated.addListener((item) => {
        this.handleDownloadCreated(item);
      });

      chrome.downloads.onChanged.addListener((delta) => {
        this.handleDownloadChanged(delta);
      });
    }
  }

  private getNextRuleId(): number {
    const id = this.nextRuleId;
    this.nextRuleId = (this.nextRuleId % MAX_RULE_ID) + 1;
    return id;
  }

  async create(request: DownloadRequest): Promise<string> {
    const gid = generateGid();
    const headers = parseHeaderArray(request.headers as unknown as string[]);
    const dir = request.dir || '';

    const task: DownloadTask = {
      gid,
      uris: request.uris,
      status: 'pending',
      browserDownloadId: null,
      totalLength: 0,
      completedLength: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      connections: 0,
      dir,
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
      options: {
        dir,
        out: request.out,
        split: request.split?.toString(),
        header: request.headers as unknown as string[],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId: null,
      ruleId: null,
    };

    const primaryUri = request.uris[0];
    const ruleId = this.getNextRuleId();

    const requestHeaders = headersToArray(headers);
    const responseHeaders = [
      { header: 'Content-Disposition', operation: 'set' as const, value: 'attachment' },
    ];

    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
          {
            id: ruleId,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders,
              responseHeaders,
            },
            condition: {
              urlFilter: primaryUri,
              resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
            },
          },
        ],
      });

      const tab = await chrome.tabs.create({ url: primaryUri, active: false });
      task.tabId = tab.id ?? null;
      task.ruleId = ruleId;
    }

    await this.taskStore.upsert(task);

    if (typeof chrome !== 'undefined') {
      const timeout = setTimeout(() => {
        this.handleTimeout(gid);
      }, DOWNLOAD_TIMEOUT_MS);
      this.pendingTimeouts.set(gid, timeout);
    }

    return gid;
  }

  private async handleDownloadCreated(item: chrome.downloads.DownloadItem): Promise<void> {
    const task = await this.taskStore.getPendingByUrl(item.url);
    if (!task) return;

    this.clearTimeout(task.gid);

    task.browserDownloadId = item.id;
    task.status = 'active';
    task.totalLength = item.fileSize || 0;
    await this.taskStore.upsert(task);

    await this.cleanupDownloadResources(task);
    this.notifyChange(task);
  }

  private async handleDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
    if (delta.id === undefined) return;
    const task = await this.taskStore.getByBrowserId(delta.id);
    if (!task) return;

    if (delta.totalBytes) {
      task.totalLength = delta.totalBytes.current || task.totalLength;
    }
    if (delta.bytesReceived) {
      task.completedLength = delta.bytesReceived.current || task.completedLength;
    }

    if (delta.state) {
      const state = delta.state.current;
      if (state === 'complete') {
        task.status = 'complete';
        task.completedLength = task.totalLength;
        await this.cleanupDownloadResources(task);
      } else if (state === 'interrupted') {
        if (task.status === 'pending' || task.status === 'active' || task.status === 'waiting') {
          task.status = 'error';
          task.errorCode = '1';
          task.errorMessage = delta.error?.current || 'Download interrupted';
        }
        await this.cleanupDownloadResources(task);
      }
    }

    await this.taskStore.upsert(task);
    this.notifyChange(task);
  }

  private async handleTimeout(gid: string): Promise<void> {
    this.pendingTimeouts.delete(gid);
    const task = await this.taskStore.get(gid);
    if (!task || task.status !== 'pending') return;

    task.status = 'error';
    task.errorCode = '1';
    task.errorMessage = 'Download timed out — no download started within 30s';
    await this.taskStore.upsert(task);
    await this.cleanupDownloadResources(task);
    this.notifyChange(task);
  }

  private async cleanupDownloadResources(task: DownloadTask): Promise<void> {
    if (task.ruleId !== null && typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [task.ruleId],
        });
      } catch { /* rule may already be removed */ }
    }
    task.ruleId = null;

    if (task.tabId !== null && typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        await chrome.tabs.remove(task.tabId);
      } catch { /* tab may already be closed */ }
    }
    task.tabId = null;
  }

  private clearTimeout(gid: string): void {
    const t = this.pendingTimeouts.get(gid);
    if (t) {
      clearTimeout(t);
      this.pendingTimeouts.delete(gid);
    }
  }

  async pause(gid: string): Promise<void> {
    const task = await this.taskStore.get(gid);
    if (!task) throw new Error(`Task not found: ${gid}`);
    if (task.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
      await chrome.downloads.pause(task.browserDownloadId);
    }
    if (task.status === 'active') {
      task.status = 'paused';
      await this.taskStore.upsert(task);
      this.notifyChange(task);
    }
  }

  async resume(gid: string): Promise<void> {
    const task = await this.taskStore.get(gid);
    if (!task) throw new Error(`Task not found: ${gid}`);
    if (task.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
      await chrome.downloads.resume(task.browserDownloadId);
    }
    if (task.status === 'paused') {
      task.status = 'active';
      await this.taskStore.upsert(task);
      this.notifyChange(task);
    }
  }

  async cancel(gid: string): Promise<void> {
    const task = await this.taskStore.get(gid);
    if (!task) return;
    if (task.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
      await chrome.downloads.cancel(task.browserDownloadId);
    }
    this.clearTimeout(gid);
    await this.cleanupDownloadResources(task);
    task.status = 'removed';
    await this.taskStore.upsert(task);
    this.notifyChange(task);
  }

  async getTask(gid: string): Promise<DownloadTask | undefined> {
    return this.taskStore.get(gid);
  }

  async getActiveTasks(): Promise<DownloadTask[]> {
    return this.taskStore.query({ status: 'active' });
  }

  async getGlobalStat(): Promise<Aria2GlobalStat> {
    const [numActive, numWaiting, numStopped] = await Promise.all([
      this.taskStore.count('active'),
      this.taskStore.count('waiting'),
      this.taskStore.count('error'),
    ]);
    const activeTasks = await this.taskStore.query({ status: 'active' });
    const downloadSpeed = activeTasks.reduce((sum, t) => sum + t.downloadSpeed, 0);
    const uploadSpeed = activeTasks.reduce((sum, t) => sum + t.uploadSpeed, 0);

    const totalCompleted = await this.taskStore.count('complete');
    const totalRemoved = await this.taskStore.count('removed');

    return {
      downloadSpeed: downloadSpeed.toString(),
      uploadSpeed: uploadSpeed.toString(),
      numActive: numActive.toString(),
      numWaiting: numWaiting.toString(),
      numStopped: numStopped.toString(),
      numStoppedTotal: (totalCompleted + totalRemoved + numStopped).toString(),
    };
  }

  onTaskChange(callback: (task: DownloadTask) => void): void {
    this.changeCallbacks.push(callback);
  }

  private notifyChange(task: DownloadTask): void {
    for (const cb of this.changeCallbacks) {
      cb(task);
    }
  }
}
