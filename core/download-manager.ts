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
 * _ruleId tracks declarativeNetRequest rules for cleanup after download ends
 */
interface InternalTask extends DownloadTask {
    _ruleId: number | null;
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
    }

    async create(request: DownloadRequest): Promise<string> {
        const taskId = this.generateId();
        const filePath = this.buildFilePath(request.directory, request.filename);

        console.log(`${LOG_PREFIX} Creating task ${taskId}`, {
            url: request.url,
            filename: request.filename,
            directory: request.directory,
            filePath,
            hasHeaders: !!request.headers && Object.keys(request.headers).length > 0,
        });

        let ruleId: number | null = null;
        if (request.headers && Object.keys(request.headers).length > 0) {
            console.log(`${LOG_PREFIX} Task ${taskId}: Injecting headers`, request.headers);
            ruleId = await this.injectHeaders(request.url, request.headers);
            console.log(`${LOG_PREFIX} Task ${taskId}: Header rule created with ruleId=${ruleId}`);
        }

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
        };
        this.tasks.set(taskId, task);

        try {
            console.log(`${LOG_PREFIX} Task ${taskId}: Starting browser download`, {
                url: request.url,
                filename: filePath,
            });

            const downloadId = await browser.downloads.download({
                url: request.url,
                filename: filePath ?? undefined,
                conflictAction: "uniquify",
            });

            task.browserDownloadId = downloadId;
            task.status = "in_progress";
            this.browserIdMap.set(downloadId, taskId);

            console.log(`${LOG_PREFIX} Task ${taskId}: Browser download started with downloadId=${downloadId}`);
            this.emit(task);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`${LOG_PREFIX} Task ${taskId}: Failed to start download`, err);

            task.status = "error";
            task.error = errorMsg;
            this.emit(task);
            if (ruleId) {
                console.log(`${LOG_PREFIX} Task ${taskId}: Cleaning up header rule ${ruleId} after error`);
                await this.removeHeaderRule(ruleId);
            }
        }

        return taskId;
    }

    async pause(taskId: string): Promise<void> {
        console.log(`${LOG_PREFIX} Pausing task ${taskId}`);
        const task = this.requireTask(taskId);
        await browser.downloads.pause(task.browserDownloadId!);
        console.log(`${LOG_PREFIX} Task ${taskId}: Pause request sent`);
    }

    async resume(taskId: string): Promise<void> {
        console.log(`${LOG_PREFIX} Resuming task ${taskId}`);
        const task = this.requireTask(taskId);
        await browser.downloads.resume(task.browserDownloadId!);
        console.log(`${LOG_PREFIX} Task ${taskId}: Resume request sent`);
    }

    async cancel(taskId: string): Promise<void> {
        console.log(`${LOG_PREFIX} Cancelling task ${taskId}`);
        const task = this.requireTask(taskId);
        await browser.downloads.cancel(task.browserDownloadId!);
        task.status = "cancelled";
        console.log(`${LOG_PREFIX} Task ${taskId}: Cancelled`);
        this.emit(task);
    }

    getTask(taskId: string): DownloadTask | undefined {
        const task = this.tasks.get(taskId);
        if (!task) {
            console.log(`${LOG_PREFIX} getTask: Task ${taskId} not found`);
            return undefined;
        }

        // Return a copy without internal fields
        const { _ruleId, ...publicTask } = task;
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

        const { _ruleId, ...publicTask } = task;
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

        const finalResult = result.slice(offset, offset + limit).map(({ _ruleId, ...task }) => task);
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
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }

    private buildFilePath(
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
        headers: Record<string, string>
    ): Promise<number> {
        const ruleId = this.ruleIdCounter++;

        console.log(`${LOG_PREFIX} Creating header injection rule ${ruleId} for ${url}`);

        const requestHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] =
            Object.entries(headers).map(([header, value]) => ({
                header,
                operation: browser.declarativeNetRequest.HeaderOperation.SET,
                value,
            }));

        const rule: Browser.declarativeNetRequest.Rule = {
            id: ruleId,
            priority: 1,
            action: {
                type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders
            },
            condition: {
                urlFilter: url,
                resourceTypes: Object.values(browser.declarativeNetRequest.ResourceType),
            },
        };

        await browser.declarativeNetRequest.updateSessionRules({
            addRules: [rule],
        });

        console.log(`${LOG_PREFIX} Header injection rule ${ruleId} created successfully`);
        return ruleId;
    }

    private async removeHeaderRule(ruleId: number): Promise<void> {
        console.log(`${LOG_PREFIX} Removing header rule ${ruleId}`);
        try {
            await browser.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
            });
            console.log(`${LOG_PREFIX} Header rule ${ruleId} removed successfully`);
        } catch (err) {
            console.warn(`${LOG_PREFIX} Failed to remove header rule ${ruleId}`, err);
        }
    }

    private handleBrowserDownloadChange(
        delta: Browser.downloads.DownloadDelta
    ): void {
        const taskId = this.browserIdMap.get(delta.id);
        if (!taskId) {
            // Not our download, ignore
            return;
        }

        const task = this.tasks.get(taskId);
        if (!task) {
            console.warn(`${LOG_PREFIX} Download change for unknown task ${taskId}`);
            return;
        }

        console.log(`${LOG_PREFIX} Task ${taskId}: Browser download change`, delta);

        let changed = false;

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

        // Clean up header rule when download reaches terminal state
        if (TERMINAL_STATUSES.has(task.status) && task._ruleId) {
            console.log(`${LOG_PREFIX} Task ${taskId}: Cleaning up header rule ${task._ruleId} (terminal state)`);
            this.removeHeaderRule(task._ruleId);
            task._ruleId = null;
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
        const { _ruleId, ...publicTask } = task;
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