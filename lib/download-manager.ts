import type {
  DownloadRequest,
  DownloadTask,
  DownloadStatus,
  TaskQuery,
  TaskChangeListener,
  DownloadStrategy,
  DownloadResult,
} from './types';
import { encodeGid, decodeGid, generateSalt, PLACEHOLDER_BROWSER_ID, EXTENSION_PREFIX } from './gid';
import { SessionStore, LocalStore } from './storage';
import { TabDnrStrategy } from './download-strategies/tab-dnr';
import { createLogger, type Logger } from './logging';

const TERMINAL_STATUSES: ReadonlySet<DownloadStatus> = new Set(['complete', 'error', 'cancelled']);

const PENDING_TIMEOUT_MS = 120_000;

export class DownloadManager {
  private cache = new Map<string, DownloadTask>();
  private pendingByUrl = new Map<string, DownloadTask[]>();
  private pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private strategies: DownloadStrategy[] = [];
  private listeners = new Set<TaskChangeListener>();
  private logger: Logger;
  private strategyInstance: TabDnrStrategy;

  constructor() {
    this.logger = createLogger('[DownloadManager]');

    // Register default strategy — keep a reference for cleanup
    this.strategyInstance = new TabDnrStrategy();
    this.registerStrategy(this.strategyInstance);

    // Set up browser download event listeners
    browser.downloads.onCreated.addListener(this.handleDownloadCreated);
    browser.downloads.onChanged.addListener(this.handleDownloadChanged);
  }

  // ==========================================================================
  // Strategy registration
  // ==========================================================================
  registerStrategy(strategy: DownloadStrategy): void {
    this.strategies.unshift(strategy);
  }

  // ==========================================================================
  // Core operations
  // ==========================================================================

  /**
   * Creates a new download task and returns its GID.
   */
  async create(request: DownloadRequest): Promise<string> {
    const gid = encodeGid(EXTENSION_PREFIX, generateSalt(), PLACEHOLDER_BROWSER_ID);

    const task: DownloadTask = {
      gid,
      request,
      status: 'pending',
      bytesReceived: 0,
      totalBytes: 0,
      createdAt: Date.now(),
    };

    // Store in memory cache
    this.cache.set(gid, task);

    // Persist to SessionStore
    await SessionStore.putTask(task);

    // Register for onCreated pending correlation
    const url = request.url;
    const pendingList = this.pendingByUrl.get(url) ?? [];
    pendingList.push(task);
    this.pendingByUrl.set(url, pendingList);

    // Set up auto-cancel timeout
    const timeout = setTimeout(() => {
      void this.handlePendingTimeout(gid);
    }, PENDING_TIMEOUT_MS);
    this.pendingTimeouts.set(gid, timeout);

    // Notify listeners
    this.emit(task);

    // Find and execute a strategy
    const strategy = this.strategies.find((s) => s.canHandle(request));
    if (strategy) {
      try {
        const result: DownloadResult = await strategy.execute(request, task);
        if (!result.success) {
          // Strategy error — mark error but do NOT finalize
          this.markTaskError(gid, result.error ?? 'Strategy execution failed');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.markTaskError(gid, message);
      }
    } else {
      this.markTaskError(gid, 'No strategy can handle this request');
    }

    return gid;
  }

  /**
   * Pauses the download corresponding to the given GID.
   */
  async pause(gid: string): Promise<void> {
    const task = this.cache.get(gid);
    if (!task) {
      throw new Error(`Unknown GID: ${gid}`);
    }
    if (task.browserDownloadId === undefined) {
      throw new Error(`Task ${gid} has no browserDownloadId`);
    }
    await browser.downloads.pause(task.browserDownloadId);
  }

  /**
   * Resumes the download corresponding to the given GID.
   */
  async resume(gid: string): Promise<void> {
    const task = this.cache.get(gid);
    if (!task) {
      throw new Error(`Unknown GID: ${gid}`);
    }
    if (task.browserDownloadId === undefined) {
      throw new Error(`Task ${gid} has no browserDownloadId`);
    }
    await browser.downloads.resume(task.browserDownloadId);
  }

  /**
   * Cancels the download corresponding to the given GID.
   */
  async cancel(gid: string): Promise<void> {
    const task = this.cache.get(gid);
    if (!task) {
      throw new Error(`Unknown GID: ${gid}`);
    }

    // Call browser.cancel if we have a browserDownloadId
    if (task.browserDownloadId !== undefined) {
      await browser.downloads.cancel(task.browserDownloadId);
    }

    // Clear pending timeout if still tracking
    this.clearPendingTimeout(gid);

    // Cancel the strategy if it has cancel support
    const strategy = this.strategies.find((s) => s.canHandle(task.request));
    if (strategy) {
      try {
        await strategy.cancel(task);
      } catch {
        // Swallow errors during strategy cancel
      }
    }

    // Mark cancelled and emit
    task.status = 'cancelled';
    this.emit(task);

    // Finalize: move to history, remove from active storage and cache
    await this.finalizeTask(task);
  }

  // ==========================================================================
  // Query operations
  // ==========================================================================

  /**
   * Looks up a task by GID from memory cache.
   */
  getTask(gid: string): DownloadTask | undefined {
    return this.cache.get(gid);
  }

  /**
   * Queries tasks from memory cache with optional filtering.
   */
  queryTasks(filter: TaskQuery): DownloadTask[] {
    let results = [...this.cache.values()];

    // Filter by status
    if (filter.status !== undefined) {
      const statusFilters = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter((t) => statusFilters.includes(t.status));
    }

    // Sort by createdAt descending
    results.sort((a, b) => b.createdAt - a.createdAt);

    // Apply offset
    if (filter.offset !== undefined) {
      results = results.slice(filter.offset);
    }

    // Apply limit
    if (filter.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  // ==========================================================================
  // Event listeners
  // ==========================================================================

  /**
   * Registers a listener for task changes. Returns an unsubscribe function.
   */
  onTaskChange(listener: TaskChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ==========================================================================
  // Hydration (restore from storage after extension restart)
  // ==========================================================================

  /**
   * Restores tasks from SessionStore into memory cache.
   */
  async hydrate(): Promise<void> {
    const tasks = await SessionStore.getAllTasks();

    // Clear existing cache
    this.cache.clear();
    this.pendingByUrl.clear();
    this.pendingTimeouts.clear();

    for (const task of tasks) {
      this.cache.set(task.gid, task);

      // Re-register pending correlation for tasks still in pending state
      if (task.status === 'pending') {
        const url = task.request.url;
        const pendingList = this.pendingByUrl.get(url) ?? [];
        pendingList.push(task);
        this.pendingByUrl.set(url, pendingList);

        // Re-set timeout — calculate remaining time based on createdAt
        const elapsed = Date.now() - task.createdAt;
        const remaining = PENDING_TIMEOUT_MS - elapsed;
        if (remaining > 0) {
          const timeout = setTimeout(() => {
            void this.handlePendingTimeout(task.gid);
          }, remaining);
          this.pendingTimeouts.set(task.gid, timeout);
        } else {
          // Already expired — cancel immediately
          void this.handlePendingTimeout(task.gid);
        }
      }
    }

    this.logger.info(`Hydrated ${tasks.length} tasks from session storage`);
  }

  // ==========================================================================
  // Browser download event handlers
  // ==========================================================================

  /**
   * Correlates a browser download with a pending task.
   */
  private handleDownloadCreated = async (downloadItem: browser.downloads.DownloadItem): Promise<void> => {
    // Try to find pending tasks by the download URL (url or finalUrl)
    let pendingList = this.pendingByUrl.get(downloadItem.url);
    if (!pendingList || pendingList.length === 0) {
      pendingList = this.pendingByUrl.get(downloadItem.finalUrl ?? '');
    }
    if (!pendingList || pendingList.length === 0) {
      return;
    }

    // Match by closest createdAt timestamp
    const now = Date.now();
    let bestMatch: DownloadTask | undefined;
    let bestIndex = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < pendingList.length; i++) {
      const task = pendingList[i];
      const diff = Math.abs(task.createdAt - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestMatch = task;
        bestIndex = i;
      }
    }

    if (!bestMatch || bestIndex === -1) {
      return;
    }

    // Remove from pending list
    pendingList.splice(bestIndex, 1);
    const lookupKey = downloadItem.finalUrl ?? downloadItem.url;
    if (pendingList.length === 0) {
      this.pendingByUrl.delete(lookupKey);
    }

    // Clear pending timeout before re-encoding GID
    const oldGid = bestMatch.gid;
    this.clearPendingTimeout(oldGid);

    // Clean up strategy resources BEFORE re-encoding GID
    // (strategy stores ruleIdMap keyed by task.gid)
    if (this.strategyInstance) {
      try {
        await this.strategyInstance.cleanupOnMatched(bestMatch);
      } catch {
        // Swallow cleanup errors
      }
    }

    // Bind browserDownloadId
    bestMatch.browserDownloadId = downloadItem.id;

    // Re-encode GID with real browser ID
    const decoded = decodeGid(oldGid);
    if (decoded) {
      const newGid = encodeGid(decoded.prefix, decoded.salt, downloadItem.id);
      bestMatch.gid = newGid;

      // Update cache key
      this.cache.delete(oldGid);
      this.cache.set(newGid, bestMatch);
    }

    // Emit to listeners
    this.emit(bestMatch);

    // Persist updated task
    await SessionStore.putTask(bestMatch);

    this.logger.info(`Correlated download id=${downloadItem.id} with GID=${bestMatch.gid}`);
  };

  /**
   * Updates task state based on browser download changes.
   */
  private handleDownloadChanged = async (delta: browser.downloads._OnChangedDownloadDelta): Promise<void> => {
    const downloadId = delta.id;

    // Find task by browserDownloadId
    let foundTask: DownloadTask | undefined;
    for (const task of this.cache.values()) {
      if (task.browserDownloadId === downloadId) {
        foundTask = task;
        break;
      }
    }

    if (!foundTask) {
      return;
    }

    let hasChanges = false;

    // Update status
    if (delta.state?.current) {
      const newStatus = this.mapBrowserState(delta.state.current);
      if (newStatus !== foundTask.status) {
        foundTask.status = newStatus;
        hasChanges = true;
      }
    }

    // Update bytesReceived
    if (delta.bytesReceived?.current !== undefined) {
      foundTask.bytesReceived = delta.bytesReceived.current;
      hasChanges = true;
    }

    if (hasChanges) {
      this.emit(foundTask);

      // Persist to session storage
      await SessionStore.putTask(foundTask);

      // Check if terminal
      if (TERMINAL_STATUSES.has(foundTask.status)) {
        await this.finalizeTask(foundTask);
      }
    }
  };

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private async handlePendingTimeout(gid: string): Promise<void> {
    const task = this.cache.get(gid);
    if (!task) {
      return;
    }

    // Only auto-cancel if still pending
    if (task.status !== 'pending') {
      return;
    }

    task.status = 'cancelled';
    task.error = 'Download timed out waiting for browser correlation';

    this.emit(task);

    // Remove from pending maps
    const url = task.request.url;
    const pendingList = this.pendingByUrl.get(url);
    if (pendingList) {
      const filtered = pendingList.filter((t) => t.gid !== gid);
      if (filtered.length === 0) {
        this.pendingByUrl.delete(url);
      } else {
        this.pendingByUrl.set(url, filtered);
      }
    }

    this.pendingTimeouts.delete(gid);
    await this.finalizeTask(task);
  }

  /**
   * Updates task status to error without finalizing.
   * Strategy errors are informational; only browser-triggered terminal
   * statuses cause finalization.
   */
  private markTaskError(gid: string, error: string): void {
    const task = this.cache.get(gid);
    if (!task) {
      return;
    }

    task.status = 'error';
    task.error = error;

    this.emit(task);
    SessionStore.putTask(task);
  }

  private async finalizeTask(task: DownloadTask): Promise<void> {
    // Remove from memory cache first (prevent duplicate lookups)
    this.cache.delete(task.gid);

    // Clean up pending maps
    const url = task.request.url;
    const pendingList = this.pendingByUrl.get(url);
    if (pendingList) {
      const filtered = pendingList.filter((t) => t.gid !== task.gid);
      if (filtered.length === 0) {
        this.pendingByUrl.delete(url);
      } else {
        this.pendingByUrl.set(url, filtered);
      }
    }

    this.clearPendingTimeout(task.gid);

    // Add to LocalStore history
    await LocalStore.addToHistory(task);

    // Remove from SessionStore
    await SessionStore.removeTask(task.gid);
  }

  private clearPendingTimeout(gid: string): void {
    const timeout = this.pendingTimeouts.get(gid);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(gid);
    }
  }

  private mapBrowserState(state: string): DownloadStatus {
    switch (state) {
      case 'in_progress':
        return 'in_progress';
      case 'paused':
        return 'paused';
      case 'complete':
        return 'complete';
      case 'interrupted':
        return 'error';
      default:
        return 'in_progress';
    }
  }

  /**
   * Notifies all registered listeners with a shallow copy of the task.
   */
  private emit(task: DownloadTask): void {
    const snapshot: DownloadTask = { ...task };
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error: unknown) {
        this.logger.error('Listener error:', error);
      }
    }
  }
}
