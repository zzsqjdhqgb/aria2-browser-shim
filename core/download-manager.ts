import type { DownloadRequest, DownloadTask, TaskChangeListener, TaskQuery } from "./types";
import { TERMINAL_STATUSES } from "./types";

const LOG_PREFIX = "[DownloadManager]";
const PENDING_TIMEOUT_MS = 120_000;

// Re-exported for local use to avoid 'Browser' namespace-as-value errors
const DNR_HO = browser.declarativeNetRequest.HeaderOperation;
const DNR_RAT = browser.declarativeNetRequest.RuleActionType;
const DNR_RT = browser.declarativeNetRequest.ResourceType;

interface InternalTask extends DownloadTask {
    _ruleIds: number[];
    _tabIds: number[];
    _timeoutId: ReturnType<typeof setTimeout> | null;
}

class DownloadManager {
    private tasks = new Map<string, InternalTask>();
    private browserIdMap = new Map<number, string>();
    private listeners = new Set<TaskChangeListener>();
    private ruleIdCounter = 1;
    private destroyed = false;

    constructor() {
        browser.downloads.onCreated.addListener(this.onBrowserDownloadCreated);
        browser.downloads.onChanged.addListener(this.onBrowserDownloadChanged);
    }

    // =====================================================================
    // Public API
    // =====================================================================

    async create(request: DownloadRequest): Promise<string> {
        if (this.destroyed) throw new Error("DownloadManager is destroyed");

        const taskId = this.generateId();
        const url = request.url;
        const ruleId = await this.injectHeaders(url, request.headers, request.directory, request.filename);

        const task: InternalTask = {
            id: taskId, url, started: false, browserDownloadId: undefined,
            request: { ...request }, status: "pending",
            bytesReceived: 0, totalBytes: -1, speed: 0,
            createdAt: Date.now(),
            _ruleIds: [ruleId], _tabIds: [],
            _timeoutId: setTimeout(() => this.handleTimeout(taskId), PENDING_TIMEOUT_MS),
        };

        this.tasks.set(taskId, task);

        try {
            const tab = await browser.tabs.create({ url, active: false });
            task._tabIds.push(tab.id!);
            this.emit(task);
        } catch (err) {
            this.failTask(task, err instanceof Error ? err.message : String(err));
        }

        return taskId;
    }

    async pause(taskId: string): Promise<void> {
        const task = this.requireTask(taskId);
        if (!task.browserDownloadId) {
            task.status = "paused";
            this.emit(task);
            return;
        }
        await browser.downloads.pause(task.browserDownloadId);
    }

    async resume(taskId: string): Promise<void> {
        const task = this.requireTask(taskId);
        if (!task.browserDownloadId) return;
        await browser.downloads.resume(task.browserDownloadId);
    }

    async cancel(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;
        if (task.browserDownloadId) {
            await browser.downloads.cancel(task.browserDownloadId).catch(() => {});
        }
        task.status = "cancelled";
        task.completedAt = Date.now();
        this.clearTimeout(task);
        await this.cleanup(task);
        this.emit(task);
    }

    async cancelAll(): Promise<void> {
        const active = Array.from(this.tasks.values()).filter(
            (t) => !TERMINAL_STATUSES.has(t.status),
        );
        for (const task of active) {
            await this.cancel(task.id);
        }
    }

    getTask(taskId: string): DownloadTask | undefined {
        return this.tasks.get(taskId);
    }

    queryTasks(filter: TaskQuery = {}): DownloadTask[] {
        let result = Array.from(this.tasks.values());
        if (filter.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            result = result.filter((t) => statuses.includes(t.status));
        }
        result.sort((a, b) => b.createdAt - a.createdAt);
        const offset = filter.offset ?? 0;
        const limit = filter.limit ?? result.length;
        return result.slice(offset, offset + limit);
    }

    removeTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || !TERMINAL_STATUSES.has(task.status)) return false;
        this.tasks.delete(taskId);
        if (task.browserDownloadId) this.browserIdMap.delete(task.browserDownloadId);
        return true;
    }

    purgeCompleted(): number {
        let count = 0;
        for (const [id, task] of this.tasks) {
            if (TERMINAL_STATUSES.has(task.status)) {
                this.tasks.delete(id);
                if (task.browserDownloadId) this.browserIdMap.delete(task.browserDownloadId);
                count++;
            }
        }
        return count;
    }

    onTaskChange(listener: TaskChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async destroy(): Promise<void> {
        this.destroyed = true;
        for (const task of this.tasks.values()) {
            this.clearTimeout(task);
            if (task.browserDownloadId) {
                await browser.downloads.cancel(task.browserDownloadId).catch(() => {});
            }
            await this.cleanup(task).catch(() => {});
        }
        this.tasks.clear();
        this.browserIdMap.clear();
    }

    // =====================================================================
    // Private
    // =====================================================================

    private generateId(): string {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }

    private async injectHeaders(
        url: string,
        headers?: Record<string, string>,
        _dir?: string,
        filename?: string,
    ): Promise<number> {
        const ruleId = this.ruleIdCounter++;

        const requestHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [];
        if (headers) {
            for (const [header, value] of Object.entries(headers)) {
                if (value) {
                    requestHeaders.push({ header, operation: DNR_HO.SET, value });
                }
            }
        }

        const baseName = filename ?? "download";
        const responseHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [{
            header: "Content-Disposition",
            operation: DNR_HO.SET,
            value: `attachment; filename="${baseName}"`,
        }];

        await browser.declarativeNetRequest.updateSessionRules({
            addRules: [{
                id: ruleId,
                priority: 1,
                action: {
                    type: DNR_RAT.MODIFY_HEADERS,
                    requestHeaders: requestHeaders.length > 0 ? requestHeaders : undefined,
                    responseHeaders,
                },
                condition: { urlFilter: url, resourceTypes: [DNR_RT.MAIN_FRAME] },
            }],
        });

        console.log(`${LOG_PREFIX} DNR rule ${ruleId} for ${url}`);
        return ruleId;
    }

    private async cleanup(task: InternalTask): Promise<void> {
        if (task._ruleIds.length > 0) {
            await browser.declarativeNetRequest.updateSessionRules({
                removeRuleIds: task._ruleIds,
            }).catch(() => {});
            task._ruleIds = [];
        }
        for (const tabId of task._tabIds) {
            await browser.tabs.remove(tabId).catch(() => {});
        }
        task._tabIds = [];
    }

    private failTask(task: InternalTask, error: string): void {
        task.status = "error";
        task.error = error;
        task.completedAt = Date.now();
        this.clearTimeout(task);
        this.cleanup(task);
        this.emit(task);
    }

    private handleTimeout(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== "pending") return;
        console.warn(`${LOG_PREFIX} Task ${taskId} timed out`);
        this.failTask(task, "Download timed out: no response from server");
    }

    private clearTimeout(task: InternalTask): void {
        if (task._timeoutId != null) {
            clearTimeout(task._timeoutId);
            task._timeoutId = null;
        }
    }

    private requireTask(taskId: string): InternalTask {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);
        return task;
    }

    private emit(task: InternalTask): void {
        for (const listener of this.listeners) {
            try { listener(task); } catch { /* swallow */ }
        }
    }

    // =====================================================================
    // Browser event handlers
    // =====================================================================

    private onBrowserDownloadCreated = (item: Browser.downloads.DownloadItem): void => {
        if (this.destroyed) return;
        for (const task of this.tasks.values()) {
            if (task.status !== "pending") continue;
            if (task.url === item.url || item.url.includes(task.url)) {
                task.browserDownloadId = item.id;
                task.status = "in_progress";
                task.bytesReceived = item.bytesReceived;
                task.totalBytes = item.fileSize >= 0 ? item.fileSize : item.totalBytes;
                task.started = true;
                this.browserIdMap.set(item.id, task.id);
                this.clearTimeout(task);
                this.cleanup(task);
                this.emit(task);
                console.log(`${LOG_PREFIX} Matched download ${item.id} -> task ${task.id}`);
                return;
            }
        }
    };

    private onBrowserDownloadChanged = (delta: Browser.downloads.DownloadDelta): void => {
        if (this.destroyed) return;
        const taskId = this.browserIdMap.get(delta.id);
        if (!taskId) return;
        const task = this.tasks.get(taskId);
        if (!task) return;

        let changed = false;

        if (delta.state) {
            switch (delta.state.current) {
                case "in_progress":
                    if (task.status !== "in_progress") { task.status = "in_progress"; changed = true; }
                    break;
                case "interrupted":
                    task.status = "error";
                    task.error = (delta as any).error?.current ?? "Download interrupted";
                    task.completedAt = Date.now();
                    changed = true;
                    this.cleanup(task);
                    break;
                case "complete":
                    task.status = "complete";
                    task.completedAt = Date.now();
                    changed = true;
                    this.cleanup(task);
                    break;
            }
        }
        if (delta.paused?.current != null) {
            if (delta.paused.current && task.status === "in_progress") { task.status = "paused"; changed = true; }
            else if (!delta.paused.current && task.status === "paused") { task.status = "in_progress"; changed = true; }
        }
        if ((delta as any).bytesReceived) { task.bytesReceived = (delta as any).bytesReceived.current; changed = true; }
        if (delta.totalBytes?.current != null) { task.totalBytes = delta.totalBytes.current; changed = true; }
        if ((delta as any).speed)        { task.speed = (delta as any).speed.current ?? 0; changed = true; }

        if (changed) this.emit(task);
    };
}

export const downloadManager = new DownloadManager();
