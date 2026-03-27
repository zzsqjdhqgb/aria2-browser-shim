// core/download-manager.ts
import type {
    DownloadRequest,
    DownloadTask,
    DownloadStatus,
    TaskChangeListener,
    TaskQuery,
} from "./types";

const LOG_PREFIX = "[DownloadManager]";

const TERMINAL_STATUSES: ReadonlySet<DownloadStatus> = new Set([
    "complete",
    "error",
    "cancelled",
]);

/**
 * Internal task record, extends the externally exposed DownloadTask
 * _ruleId tracks declarativeNetRequest rule for cleanup after download ends
 */
interface InternalTask extends DownloadTask {
    _ruleId: number | null;
    _tabId: number | null;
}

class DownloadManagerImpl {
    private tasks = new Map<string, InternalTask>();
    private browserIdMap = new Map<number, string>(); // browserDownloadId -> taskId
    private listeners = new Set<TaskChangeListener>();
    private ruleIdCounter = 1;

    constructor() {
        console.log(`${LOG_PREFIX} Initializing download manager`);
        browser.downloads.onChanged.addListener((delta) => {
            this.handleBrowserDownloadChange(delta);
        });
        browser.downloads.onCreated.addListener((item) => {
            this.handleBrowserDownloadCreated(item);
        });
    }

    async create(request: DownloadRequest): Promise<string> {
        const taskId = this.generateId();

        console.log(`${LOG_PREFIX} Creating task ${taskId}`, {
            url: request.url,
            filename: request.filename,
            directory: request.directory,
            hasHeaders: !!request.headers && Object.keys(request.headers).length > 0,
        });

        // 创建 DNR 规则
        const filename = this.buildFilename(request.directory, request.filename);
        const ruleId = await this.injectHeaders(request.url, request.headers, filename);
        console.log(`${LOG_PREFIX} Task ${taskId}: DNR rule created with ruleId=${ruleId}`);

        const task: InternalTask = {
            id: taskId,
            browserDownloadId: undefined,
            request: { ...request },
            status: "pending",
            bytesReceived: 0,
            totalBytes: -1,
            error: undefined,
            createdAt: Date.now(),
            completedAt: undefined,
            _ruleId: ruleId,
            _tabId: null,
        };
        this.tasks.set(taskId, task);

        try {
            console.log(`${LOG_PREFIX} Task ${taskId}: Opening tab to trigger download`);

            // 直接打开一个后台标签页触发下载
            const tab = await browser.tabs.create({
                url: request.url,
                active: false, // 不激活，减少干扰
            });

            task._tabId = tab.id ?? null;
            console.log(`${LOG_PREFIX} Task ${taskId}: Tab created with id=${tab.id}`);

            this.emit(task);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`${LOG_PREFIX} Task ${taskId}: Failed to start download`, err);

            task.status = "error";
            task.error = errorMsg;
            this.emit(task);
            await this.cleanupRule(task);
        }

        return taskId;
    }

    async pause(taskId: string): Promise<void> {
        console.log(`${LOG_PREFIX} Pausing task ${taskId}`);
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        if (task.browserDownloadId === undefined) {
            if (task.status === "pending") {
                await this.closeTab(task);
                task.status = "paused";
                this.emit(task);
                console.log(`${LOG_PREFIX} Task ${taskId}: Paused before browser download started`);
                return;
            }
            throw new Error(`Task ${taskId} cannot be paused in status ${task.status}`);
        }

        await browser.downloads.pause(task.browserDownloadId);
        console.log(`${LOG_PREFIX} Task ${taskId}: Pause request sent`);
    }

    async resume(taskId: string): Promise<void> {
        console.log(`${LOG_PREFIX} Resuming task ${taskId}`);
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        if (task.browserDownloadId === undefined) {
            if (task.status === "paused") {
                const tab = await browser.tabs.create({
                    url: task.request.url,
                    active: false,
                });
                task._tabId = tab.id ?? null;
                task.status = "pending";
                this.emit(task);
                console.log(`${LOG_PREFIX} Task ${taskId}: Resume restarted pending download trigger`);
                return;
            }
            throw new Error(`Task ${taskId} cannot be resumed in status ${task.status}`);
        }

        await browser.downloads.resume(task.browserDownloadId);
        console.log(`${LOG_PREFIX} Task ${taskId}: Resume request sent`);
    }

    async cancel(taskId: string): Promise<void> {
        console.log(`${LOG_PREFIX} Cancelling task ${taskId}`);
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        if (task.browserDownloadId !== undefined) {
            await browser.downloads.cancel(task.browserDownloadId);
        } else {
            await this.closeTab(task);
            await this.cleanupRule(task);
        }

        task.status = "cancelled";
        task.completedAt = Date.now();
        console.log(`${LOG_PREFIX} Task ${taskId}: Cancelled`);
        this.emit(task);
    }

    getTask(taskId: string): DownloadTask | undefined {
        const task = this.tasks.get(taskId);
        if (!task) {
            console.log(`${LOG_PREFIX} getTask: Task ${taskId} not found`);
            return undefined;
        }

        const { _ruleId, _tabId, ...publicTask } = task;
        return publicTask;
    }

    async refreshTask(taskId: string): Promise<DownloadTask> {
        console.log(`${LOG_PREFIX} Refreshing task ${taskId}`);
        const task = this.requireTask(taskId);

        const [item] = await browser.downloads.search({
            id: task.browserDownloadId!,
        });

        if (item) {
            task.bytesReceived = item.bytesReceived;
            task.totalBytes = item.totalBytes;
            if (item.error) task.error = item.error;
            console.log(`${LOG_PREFIX} Task ${taskId}: Refreshed`, {
                bytesReceived: item.bytesReceived,
                totalBytes: item.totalBytes,
                state: item.state,
            });
        } else {
            console.warn(`${LOG_PREFIX} Task ${taskId}: Browser download item not found`);
        }

        const { _ruleId, _tabId, ...publicTask } = task;
        return publicTask;
    }

    queryTasks(filter: TaskQuery = {}): DownloadTask[] {
        console.log(`${LOG_PREFIX} Querying tasks`, filter);

        let result = Array.from(this.tasks.values());

        if (filter.status) {
            const statuses: DownloadStatus[] = Array.isArray(filter.status)
                ? filter.status
                : [filter.status];
            result = result.filter((t) => statuses.includes(t.status));
        }

        result.sort((a, b) => b.createdAt - a.createdAt);

        const offset = filter.offset ?? 0;
        const limit = filter.limit ?? result.length;

        const finalResult = result.slice(offset, offset + limit).map(({ _ruleId, _tabId, ...task }) => task);
        console.log(`${LOG_PREFIX} Query returned ${finalResult.length} tasks`);

        return finalResult;
    }

    removeResult(taskId: string): boolean {
        console.log(`${LOG_PREFIX} Removing result for task ${taskId}`);
        const task = this.tasks.get(taskId);
        if (!task) {
            console.log(`${LOG_PREFIX} removeResult: Task ${taskId} not found`);
            return false;
        }
        if (!TERMINAL_STATUSES.has(task.status)) {
            console.log(`${LOG_PREFIX} removeResult: Task ${taskId} not in terminal state (${task.status})`);
            return false;
        }

        this.tasks.delete(taskId);
        if (task.browserDownloadId !== undefined) {
            this.browserIdMap.delete(task.browserDownloadId);
        }
        console.log(`${LOG_PREFIX} Task ${taskId}: Removed from results`);
        return true;
    }

    purgeResults(): void {
        console.log(`${LOG_PREFIX} Purging all completed results`);
        let purgedCount = 0;

        for (const [taskId, task] of this.tasks) {
            if (TERMINAL_STATUSES.has(task.status)) {
                this.tasks.delete(taskId);
                if (task.browserDownloadId !== undefined) {
                    this.browserIdMap.delete(task.browserDownloadId);
                }
                purgedCount++;
            }
        }
        console.log(`${LOG_PREFIX} Purged ${purgedCount} tasks`);
    }

    onTaskChange(listener: TaskChangeListener): () => void {
        console.log(`${LOG_PREFIX} Adding task change listener`);
        this.listeners.add(listener);
        return () => {
            console.log(`${LOG_PREFIX} Removing task change listener`);
            this.listeners.delete(listener);
        };
    }

    // ─── Private Methods ─────────────────────────────────

    private generateId(): string {
        // aria2 reserves all-zero GID and requires uniqueness.
        while (true) {
            const bytes = new Uint8Array(8);
            crypto.getRandomValues(bytes);
            const gid = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
            if (gid === "0000000000000000") continue;
            if (!this.tasks.has(gid)) return gid;
        }
    }

    private buildFilename(
        directory?: string,
        filename?: string
    ): string | null {
        const parts: string[] = [];

        if (directory) {
            parts.push(directory.replace(/^[/\\]+/, "").replace(/\.\./g, "_"));
        }
        if (filename) {
            parts.push(filename.replace(/^[/\\]+/, "").replace(/\.\./g, "_"));
        }

        return parts.length > 0 ? parts.join("/") : null;
    }

    private async injectHeaders(
        url: string,
        headers?: Record<string, string>,
        filename?: string | null
    ): Promise<number> {
        const ruleId = this.ruleIdCounter++;

        console.log(`${LOG_PREFIX} Creating DNR rule ${ruleId} for ${url}`);

        // 构建请求头修改
        const requestHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [];
        if (headers && Object.keys(headers).length > 0) {
            for (const [header, value] of Object.entries(headers)) {
                requestHeaders.push({
                    header,
                    operation: browser.declarativeNetRequest.HeaderOperation.SET,
                    value,
                });
            }
        }

        // 构建响应头修改（强制下载）
        const contentDisposition = filename
            ? `attachment; filename="${filename.split('/').pop()}"`
            : "attachment";

        const responseHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
            {
                header: "Content-Disposition",
                operation: browser.declarativeNetRequest.HeaderOperation.SET,
                value: contentDisposition,
            },
        ];

        const rule: Browser.declarativeNetRequest.Rule = {
            id: ruleId,
            priority: 1,
            action: {
                type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders: requestHeaders.length > 0 ? requestHeaders : undefined,
                responseHeaders,
            },
            condition: {
                urlFilter: url,
                resourceTypes: [browser.declarativeNetRequest.ResourceType.MAIN_FRAME],
            },
        };

        await browser.declarativeNetRequest.updateSessionRules({
            addRules: [rule],
        });

        console.log(`${LOG_PREFIX} DNR rule ${ruleId} created`, {
            requestHeadersCount: requestHeaders.length,
            responseHeadersCount: responseHeaders.length,
        });

        return ruleId;
    }

    private async removeRule(ruleId: number): Promise<void> {
        console.log(`${LOG_PREFIX} Removing DNR rule ${ruleId}`);
        try {
            await browser.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
            });
            console.log(`${LOG_PREFIX} DNR rule ${ruleId} removed`);
        } catch (err) {
            console.warn(`${LOG_PREFIX} Failed to remove DNR rule ${ruleId}`, err);
        }
    }

    private async cleanupRule(task: InternalTask): Promise<void> {
        if (task._ruleId) {
            await this.removeRule(task._ruleId);
            task._ruleId = null;
        }
    }

    private async closeTab(task: InternalTask): Promise<void> {
        if (task._tabId) {
            try {
                await browser.tabs.remove(task._tabId);
                console.log(`${LOG_PREFIX} Tab ${task._tabId} closed`);
            } catch (err) {
                // Tab 可能已经被用户关闭或自动关闭
                console.log(`${LOG_PREFIX} Tab ${task._tabId} already closed or not found`);
            }
            task._tabId = null;
        }
    }

    /**
     * 处理浏览器下载创建事件
     * 当标签页导航触发下载后，浏览器会创建下载
     */
    private handleBrowserDownloadCreated(item: Browser.downloads.DownloadItem): void {
        console.log(`${LOG_PREFIX} Browser download created`, {
            id: item.id,
            url: item.url,
            filename: item.filename,
        });

        // 查找匹配的 pending 任务
        for (const task of this.tasks.values()) {
            if (task.status === "pending" && task.request.url === item.url) {
                console.log(`${LOG_PREFIX} Matched download ${item.id} to task ${task.id}`);
                task.browserDownloadId = item.id;
                task.status = "in_progress";
                task.bytesReceived = item.bytesReceived;
                task.totalBytes = item.totalBytes;
                this.browserIdMap.set(item.id, task.id);
                this.emit(task);

                // 下载已开始，清理资源
                this.cleanupRule(task);
                this.closeTab(task);
                return;
            }
        }

        console.log(`${LOG_PREFIX} No matching task found for download ${item.id}`);
    }

    private handleBrowserDownloadChange(
        delta: Browser.downloads.DownloadDelta
    ): void {
        const taskId = this.browserIdMap.get(delta.id);
        if (!taskId) {
            return;
        }

        const task = this.tasks.get(taskId);
        if (!task) {
            console.warn(`${LOG_PREFIX} Download change for unknown task ${taskId}`);
            return;
        }

        console.log(`${LOG_PREFIX} Task ${taskId}: Browser download change`, delta);

        let changed = false;

        if (delta.totalBytes && typeof delta.totalBytes.current === "number") {
            const prev = task.totalBytes;
            task.totalBytes = delta.totalBytes.current;
            if (prev !== task.totalBytes) {
                changed = true;
            }
        }

        if (delta.error && typeof delta.error.current === "string") {
            const prev = task.error;
            task.error = delta.error.current;
            if (prev !== task.error) {
                changed = true;
            }
        }

        if (delta.state) {
            const prev = task.status;
            switch (delta.state.current) {
                case "in_progress":
                    task.status = "in_progress";
                    break;
                case "interrupted":
                    task.status = "error";
                    task.error = "interrupted";
                    break;
                case "complete":
                    task.status = "complete";
                    if (task.totalBytes > 0) {
                        task.bytesReceived = task.totalBytes;
                    }
                    task.completedAt = Date.now();
                    break;
            }
            if (prev !== task.status) {
                console.log(`${LOG_PREFIX} Task ${taskId}: Status changed ${prev} -> ${task.status}`);
                changed = true;
            }
        }

        if (delta.paused) {
            if (delta.paused.current === true) {
                console.log(`${LOG_PREFIX} Task ${taskId}: Paused`);
                task.status = "paused";
                changed = true;
            } else if (delta.paused.current === false && task.status === "paused") {
                console.log(`${LOG_PREFIX} Task ${taskId}: Resumed`);
                task.status = "in_progress";
                changed = true;
            }
        }

        // Clean up when download reaches terminal state
        if (TERMINAL_STATUSES.has(task.status)) {
            this.cleanupRule(task);
            this.closeTab(task);
        }

        if (changed) this.emit(task);
    }

    private requireTask(taskId: string): InternalTask {
        const task = this.tasks.get(taskId);
        if (!task?.browserDownloadId) {
            console.error(`${LOG_PREFIX} Task ${taskId} not found or has no browserDownloadId`);
            throw new Error(`Task ${taskId} not found`);
        }
        return task;
    }

    private emit(task: InternalTask): void {
        const { _ruleId, _tabId, ...publicTask } = task;
        console.log(`${LOG_PREFIX} Emitting task change`, {
            id: task.id,
            status: task.status,
            bytesReceived: task.bytesReceived,
            totalBytes: task.totalBytes,
        });

        for (const listener of this.listeners) {
            try {
                listener(publicTask);
            } catch (err) {
                console.error(`${LOG_PREFIX} Error in task change listener:`, err);
            }
        }
    }
}

export const downloadManager = new DownloadManagerImpl();