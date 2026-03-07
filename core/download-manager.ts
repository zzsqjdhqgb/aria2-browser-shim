import type {
    DownloadRequest,
    DownloadTask,
    DownloadStatus,
    TaskChangeListener,
    TaskQuery,
} from "./types";

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
        browser.downloads.onChanged.addListener((delta) => {
            this.handleBrowserDownloadChange(delta);
        });
    }

    async create(request: DownloadRequest): Promise<string> {
        const taskId = this.generateId();
        const filePath = this.buildFilePath(request.directory, request.filename);

        let ruleId: number | null = null;
        if (request.headers && Object.keys(request.headers).length > 0) {
            ruleId = await this.injectHeaders(request.url, request.headers);
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
            const downloadId = await browser.downloads.download({
                url: request.url,
                filename: filePath ?? undefined,
                conflictAction: "uniquify",
            });

            task.browserDownloadId = downloadId;
            task.status = "in_progress";
            this.browserIdMap.set(downloadId, taskId);
            this.emit(task);
        } catch (err) {
            task.status = "error";
            task.error = err instanceof Error ? err.message : String(err);
            this.emit(task);
            if (ruleId) await this.removeHeaderRule(ruleId);
        }

        return taskId;
    }

    async pause(taskId: string): Promise<void> {
        const task = this.requireTask(taskId);
        await browser.downloads.pause(task.browserDownloadId!);
    }

    async resume(taskId: string): Promise<void> {
        const task = this.requireTask(taskId);
        await browser.downloads.resume(task.browserDownloadId!);
    }

    async cancel(taskId: string): Promise<void> {
        const task = this.requireTask(taskId);
        await browser.downloads.cancel(task.browserDownloadId!);
        task.status = "cancelled";
        this.emit(task);
    }

    getTask(taskId: string): DownloadTask | undefined {
        const task = this.tasks.get(taskId);
        if (!task) return undefined;

        // Return a copy without internal fields
        const { _ruleId, ...publicTask } = task;
        return publicTask;
    }

    async refreshTask(taskId: string): Promise<DownloadTask> {
        const task = this.requireTask(taskId);

        const [item] = await browser.downloads.search({
            id: task.browserDownloadId!,
        });

        if (item) {
            task.bytesReceived = item.bytesReceived;
            task.totalBytes = item.totalBytes;
            if (item.error) task.error = item.error;
        }

        const { _ruleId, ...publicTask } = task;
        return publicTask;
    }

    queryTasks(filter: TaskQuery = {}): DownloadTask[] {
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

        // Return copies without internal fields
        return result.slice(offset, offset + limit).map(({ _ruleId, ...task }) => task);
    }

    removeResult(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (!TERMINAL_STATUSES.has(task.status)) return false;

        this.tasks.delete(taskId);
        if (task.browserDownloadId !== undefined) {
            this.browserIdMap.delete(task.browserDownloadId);
        }
        return true;
    }

    purgeResults(): void {
        for (const [taskId, task] of this.tasks) {
            if (TERMINAL_STATUSES.has(task.status)) {
                this.tasks.delete(taskId);
                if (task.browserDownloadId !== undefined) {
                    this.browserIdMap.delete(task.browserDownloadId);
                }
            }
        }
    }

    onTaskChange(listener: TaskChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
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
                resourceTypes: [
                    browser.declarativeNetRequest.ResourceType.OTHER,
                ],
            },
        };

        await browser.declarativeNetRequest.updateSessionRules({
            addRules: [rule],
        });

        return ruleId;
    }

    private async removeHeaderRule(ruleId: number): Promise<void> {
        try {
            await browser.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
            });
        } catch {
            // Rule might already be removed, ignore silently
        }
    }

    private handleBrowserDownloadChange(
        delta: Browser.downloads.DownloadDelta
    ): void {
        const taskId = this.browserIdMap.get(delta.id);
        if (!taskId) return;

        const task = this.tasks.get(taskId);
        if (!task) return;

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
            if (prev !== task.status) changed = true;
        }

        if (delta.paused) {
            if (delta.paused.current === true) {
                task.status = "paused";
                changed = true;
            } else if (delta.paused.current === false && task.status === "paused") {
                task.status = "in_progress";
                changed = true;
            }
        }

        // Clean up header rule when download reaches terminal state
        if (TERMINAL_STATUSES.has(task.status) && task._ruleId) {
            this.removeHeaderRule(task._ruleId);
            task._ruleId = null;
        }

        if (changed) this.emit(task);
    }

    private requireTask(taskId: string): InternalTask {
        const task = this.tasks.get(taskId);
        if (!task?.browserDownloadId) {
            throw new Error(`Task ${taskId} not found`);
        }
        return task;
    }

    private emit(task: InternalTask): void {
        const { _ruleId, ...publicTask } = task;
        for (const listener of this.listeners) {
            try {
                listener(publicTask);
            } catch (err) {
                console.error("Error in task change listener:", err);
            }
        }
    }
}

export const downloadManager = new DownloadManagerImpl();