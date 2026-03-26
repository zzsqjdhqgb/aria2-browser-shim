This file is a merged representation of the entire codebase, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
.gitignore
core/download-manager.ts
core/types.ts
entrypoints/background.ts
entrypoints/bridge.content.ts
entrypoints/main.content.ts
KNOWN_ISSUES.md
package.json
pnpm-workspace.yaml
public/icon/128.png
public/icon/16.png
public/icon/32.png
public/icon/48.png
public/icon/96.png
readme.md
shim/aria2-interceptor.ts
tsconfig.json
wxt.config.ts
```

# Files

## File: core/types.ts
````typescript
/**
 * Download request provided by the caller — pure HTTP download semantics
 * Unrelated to any RPC protocol
 */
export interface DownloadRequest {
    /** Download URL (HTTP/HTTPS) */
    url: string;

    /** File name to save, e.g., "video.mp4" */
    filename?: string;

    /**
     * Subdirectory to save the file (relative to the browser's default download directory)
     * For example, "MyFolder/sub" → <Downloads>/MyFolder/sub/video.mp4
     */
    directory?: string;

    /**
     * HTTP request headers to inject
     * browser.downloads itself does not support custom headers,
     * so they need to be injected via declarativeNetRequest
     */
    headers?: Record<string, string>;
}

/**
 * Runtime state of a download task
 */
export interface DownloadTask {
    /** Internal unique identifier (16-char hex) */
    id: string;

    /** Browser's native download ID from browser.downloads API */
    browserDownloadId?: number;

    /** Original download request */
    request: DownloadRequest;

    /** Current task status */
    status: DownloadStatus;

    /** Bytes downloaded so far */
    bytesReceived: number;

    /** Total file size in bytes (-1 if unknown) */
    totalBytes: number;

    /** Error message if status is 'error' */
    error?: string;

    /** Timestamp when task was created */
    createdAt: number;

    /** Timestamp when task completed (success or failure) */
    completedAt?: number;
}

export type DownloadStatus =
    | "pending"
    | "in_progress"
    | "paused"
    | "complete"
    | "error"
    | "cancelled";

/**
 * Query filter conditions for tasks
 */
export interface TaskQuery {
    status?: DownloadStatus | DownloadStatus[];
    limit?: number;
    offset?: number;
}

/**
 * Callback for task status changes
 */
export type TaskChangeListener = (task: DownloadTask) => void;
````

## File: pnpm-workspace.yaml
````yaml
onlyBuiltDependencies:
  - esbuild
  - spawn-sync
````

## File: shim/aria2-interceptor.ts
````typescript
// shim/aria2-interceptor.ts
import { downloadManager } from "@/core/download-manager";
import type { DownloadRequest } from "@/core/types";

const LOG_PREFIX = "[Aria2Interceptor]";

interface Aria2RpcRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: string;
    params?: unknown[];
}

interface Aria2RpcResponse {
    jsonrpc: "2.0";
    id: string | number;
    result?: unknown;
    error?: { code: number; message: string };
}

/**
 * 解析 aria2.addUri 参数，转换为 DownloadRequest
 */
function parseAddUri(params: unknown[]): DownloadRequest | null {
    console.log(`${LOG_PREFIX} Parsing addUri params`, params);

    // params: [uris, options?, position?]
    // uris: string[] - 下载链接数组
    // options: { dir?, out?, header?, ... }

    const uris = params[0] as string[] | undefined;
    if (!uris || uris.length === 0) {
        console.warn(`${LOG_PREFIX} parseAddUri: No URIs provided`);
        return null;
    }

    const options = (params[1] as Record<string, unknown>) ?? {};
    console.log(`${LOG_PREFIX} parseAddUri options`, options);

    const headers: Record<string, string> = {};

    // aria2 header 格式: ["Cookie: xxx", "Referer: yyy"]
    const headerList = options.header as string[] | undefined;
    if (headerList) {
        console.log(`${LOG_PREFIX} parseAddUri: Processing ${headerList.length} headers`);
        for (const h of headerList) {
            const idx = h.indexOf(":");
            if (idx > 0) {
                const key = h.slice(0, idx).trim();
                const value = h.slice(idx + 1).trim();
                headers[key] = value;
            }
        }
    }

    const result: DownloadRequest = {
        url: uris[0],
        filename: options.out as string | undefined,
        directory: options.dir as string | undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
    };

    console.log(`${LOG_PREFIX} parseAddUri result`, result);
    return result;
}

/**
 * 处理 Aria2 RPC 请求
 */
async function handleRpcRequest(req: Aria2RpcRequest): Promise<Aria2RpcResponse> {
    const { id, method, params = [] } = req;

    console.log(`${LOG_PREFIX} Handling RPC request`, { id, method, paramsCount: params.length });

    // 移除可能的 token 前缀 (params[0] 可能是 "token:xxx")
    let cleanParams = params;
    if (params.length > 0 && typeof params[0] === "string" && params[0].startsWith("token:")) {
        console.log(`${LOG_PREFIX} Removing token prefix from params`);
        cleanParams = params.slice(1);
    }

    let response: Aria2RpcResponse;

    switch (method) {
        case "aria2.addUri": {
            console.log(`${LOG_PREFIX} Processing aria2.addUri`);
            const downloadReq = parseAddUri(cleanParams);
            if (!downloadReq) {
                response = { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params" } };
                console.warn(`${LOG_PREFIX} aria2.addUri failed: Invalid params`);
                break;
            }
            const taskId = await downloadManager.create(downloadReq);
            console.log(`${LOG_PREFIX} aria2.addUri success: taskId=${taskId}`);
            // aria2 返回 GID (我们用 taskId 模拟)
            response = { jsonrpc: "2.0", id, result: taskId };
            break;
        }

        case "aria2.getVersion":
            console.log(`${LOG_PREFIX} Processing aria2.getVersion`);
            response = {
                jsonrpc: "2.0",
                id,
                result: {
                    version: "1.37.0-shim",
                    enabledFeatures: ["BitTorrent", "Firefox3Cookie", "GZip", "HTTPS", "Message Digest"],
                },
            };
            break;

        case "aria2.tellStatus": {
            const gid = cleanParams[0] as string;
            console.log(`${LOG_PREFIX} Processing aria2.tellStatus for gid=${gid}`);
            const task = downloadManager.getTask(gid);
            if (!task) {
                console.warn(`${LOG_PREFIX} aria2.tellStatus: GID ${gid} not found`);
                response = { jsonrpc: "2.0", id, error: { code: 1, message: "GID not found" } };
                break;
            }
            console.log(`${LOG_PREFIX} aria2.tellStatus result`, {
                gid: task.id,
                status: task.status,
                bytesReceived: task.bytesReceived,
                totalBytes: task.totalBytes,
            });
            response = {
                jsonrpc: "2.0",
                id,
                result: {
                    gid: task.id,
                    status: task.status === "in_progress" ? "active" : task.status,
                    completedLength: String(task.bytesReceived),
                    totalLength: String(task.totalBytes > 0 ? task.totalBytes : 0),
                },
            };
            break;
        }

        case "aria2.tellActive": {
            console.log(`${LOG_PREFIX} Processing aria2.tellActive`);
            const activeTasks = downloadManager.queryTasks({ status: "in_progress" });
            console.log(`${LOG_PREFIX} aria2.tellActive: Found ${activeTasks.length} active tasks`);
            response = {
                jsonrpc: "2.0",
                id,
                result: activeTasks.map((t) => ({
                    gid: t.id,
                    status: "active",
                    completedLength: String(t.bytesReceived),
                    totalLength: String(t.totalBytes > 0 ? t.totalBytes : 0),
                })),
            };
            break;
        }

        case "aria2.pause":
        case "aria2.forcePause": {
            const gid = cleanParams[0] as string;
            console.log(`${LOG_PREFIX} Processing ${method} for gid=${gid}`);
            await downloadManager.pause(gid);
            console.log(`${LOG_PREFIX} ${method} success`);
            response = { jsonrpc: "2.0", id, result: gid };
            break;
        }

        case "aria2.unpause": {
            const gid = cleanParams[0] as string;
            console.log(`${LOG_PREFIX} Processing aria2.unpause for gid=${gid}`);
            await downloadManager.resume(gid);
            console.log(`${LOG_PREFIX} aria2.unpause success`);
            response = { jsonrpc: "2.0", id, result: gid };
            break;
        }

        case "aria2.remove":
        case "aria2.forceRemove": {
            const gid = cleanParams[0] as string;
            console.log(`${LOG_PREFIX} Processing ${method} for gid=${gid}`);
            await downloadManager.cancel(gid);
            console.log(`${LOG_PREFIX} ${method} success`);
            response = { jsonrpc: "2.0", id, result: gid };
            break;
        }

        default:
            // 未实现的方法返回空结果，避免脚本报错
            console.warn(`${LOG_PREFIX} Unhandled method: ${method}`);
            response = { jsonrpc: "2.0", id, result: "OK" };
    }

    console.log(`${LOG_PREFIX} RPC response`, response);
    return response;
}

/**
 * 处理可能的批量请求
 */
export async function handleAria2Request(
    body: Aria2RpcRequest | Aria2RpcRequest[]
): Promise<Aria2RpcResponse | Aria2RpcResponse[]> {
    if (Array.isArray(body)) {
        console.log(`${LOG_PREFIX} Handling batch request with ${body.length} items`);
        return Promise.all(body.map(handleRpcRequest));
    }
    return handleRpcRequest(body);
}
````

## File: tsconfig.json
````json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx"
  }
}
````

## File: entrypoints/bridge.content.ts
````typescript
// entrypoints/bridge.content.ts
const LOG_PREFIX = "[ContentBridge]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    main() {
        console.log(`${LOG_PREFIX} Content bridge initializing`);

        // 监听来自 MAIN world 的请求
        window.addEventListener("aria2-shim-request", async (e) => {
            const detail = (e as CustomEvent).detail;
            const { _requestId, body } = detail;
            console.log(`${LOG_PREFIX} Received aria2-shim-request`, { _requestId, body });

            try {
                console.log(`${LOG_PREFIX} Sending message to background`);
                const response = await browser.runtime.sendMessage({
                    type: "aria2-rpc",
                    payload: body,
                });
                console.log(`${LOG_PREFIX} Received response from background`, response);

                window.dispatchEvent(
                    new CustomEvent("aria2-shim-response", {
                        detail: { _requestId, data: response },
                    })
                );
                console.log(`${LOG_PREFIX} Dispatched aria2-shim-response`);
            } catch (err) {
                console.error(`${LOG_PREFIX} Error sending message to background`, err);
                window.dispatchEvent(
                    new CustomEvent("aria2-shim-response", {
                        detail: {
                            _requestId,
                            data: {
                                jsonrpc: "2.0",
                                id: body?.id,
                                error: { code: -32603, message: String(err) },
                            },
                        },
                    })
                );
            }
        });

        console.log(`${LOG_PREFIX} Content bridge ready`);
    },
});
````

## File: entrypoints/main.content.ts
````typescript
// entrypoints/content.ts
const LOG_PREFIX = "[ContentMain]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "MAIN",
    main() {
        console.log(`${LOG_PREFIX} Initializing interceptors on ${window.location.href}`);

        // ============ 拦截 fetch ============
        const originalFetch = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

            if (url.includes("localhost:6800") || url.includes("127.0.0.1:6800")) {
                console.log(`${LOG_PREFIX} Intercepted fetch to ${url}`);
                return handleAria2Request(init?.body as string);
            }

            return originalFetch.call(this, input, init);
        };

        // ============ 拦截 WebSocket ============
        const OriginalWebSocket = window.WebSocket;

        class FakeWebSocket extends EventTarget {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            static readonly CLOSING = 2;
            static readonly CLOSED = 3;

            readonly CONNECTING = 0;
            readonly OPEN = 1;
            readonly CLOSING = 2;
            readonly CLOSED = 3;

            readyState: number = FakeWebSocket.CONNECTING;
            url: string;
            protocol: string = "";
            extensions: string = "";
            bufferedAmount: number = 0;
            binaryType: BinaryType = "blob";

            onopen: ((ev: Event) => void) | null = null;
            onclose: ((ev: CloseEvent) => void) | null = null;
            onmessage: ((ev: MessageEvent) => void) | null = null;
            onerror: ((ev: Event) => void) | null = null;

            constructor(url: string | URL, protocols?: string | string[]) {
                super();
                this.url = url.toString();
                console.log(`${LOG_PREFIX} Intercepted WebSocket connection to ${this.url}`);

                // 模拟异步连接成功
                setTimeout(() => {
                    this.readyState = FakeWebSocket.OPEN;
                    const openEvent = new Event("open");
                    this.onopen?.(openEvent);
                    this.dispatchEvent(openEvent);
                    console.log(`${LOG_PREFIX} Fake WebSocket opened`);
                }, 0);
            }

            send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
                if (this.readyState !== FakeWebSocket.OPEN) {
                    throw new DOMException("WebSocket is not open", "InvalidStateError");
                }

                console.log(`${LOG_PREFIX} WebSocket send:`, data);

                // 处理消息并返回响应
                this.handleMessage(data as string);
            }

            private async handleMessage(data: string): Promise<void> {
                try {
                    const response = await sendToBackground(JSON.parse(data));
                    const messageEvent = new MessageEvent("message", {
                        data: JSON.stringify(response),
                    });

                    console.log(`${LOG_PREFIX} WebSocket response:`, response);
                    this.onmessage?.(messageEvent);
                    this.dispatchEvent(messageEvent);
                } catch (err) {
                    console.error(`${LOG_PREFIX} WebSocket handle error:`, err);
                }
            }

            close(code?: number, reason?: string): void {
                console.log(`${LOG_PREFIX} WebSocket close requested`);
                this.readyState = FakeWebSocket.CLOSING;

                setTimeout(() => {
                    this.readyState = FakeWebSocket.CLOSED;
                    const closeEvent = new CloseEvent("close", {
                        code: code ?? 1000,
                        reason: reason ?? "",
                        wasClean: true,
                    });
                    this.onclose?.(closeEvent);
                    this.dispatchEvent(closeEvent);
                }, 0);
            }
        }

        // 替换全局 WebSocket（仅针对 aria2 地址）
        window.WebSocket = new Proxy(OriginalWebSocket, {
            construct(target, args: [string | URL, (string | string[])?]) {
                const url = args[0].toString();

                if (url.includes("localhost:6800") || url.includes("127.0.0.1:6800")) {
                    console.log(`${LOG_PREFIX} Creating fake WebSocket for aria2`);
                    return new FakeWebSocket(url, args[1]);
                }

                // 其他 WebSocket 正常创建
                return new target(...args);
            },
        }) as typeof WebSocket;

        // ============ 通用处理函数 ============

        async function sendToBackground(body: unknown): Promise<unknown> {
            const requestId = crypto.randomUUID();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    reject(new Error("Request timeout"));
                }, 30000);

                const handler = (e: CustomEvent) => {
                    if (e.detail?._requestId !== requestId) return;
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    resolve(e.detail.data);
                };

                window.addEventListener("aria2-shim-response", handler as EventListener);
                window.dispatchEvent(
                    new CustomEvent("aria2-shim-request", {
                        detail: { _requestId: requestId, body }
                    })
                );
            });
        }

        async function handleAria2Request(bodyStr: string | null): Promise<Response> {
            try {
                const body = bodyStr ? JSON.parse(bodyStr) : null;
                if (body) {
                    const result = await sendToBackground(body);
                    return new Response(JSON.stringify(result), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} Handle request error:`, e);
            }

            return new Response(JSON.stringify({ error: "Invalid request" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        console.log(`${LOG_PREFIX} Fetch and WebSocket interceptors installed`);
    },
});
````

## File: package.json
````json
{
  "name": "aria2-browser-shim",
  "description": "A lightweight browser extension that seamlessly intercepts Aria2 requests and redirects them to your browser's native download manager.",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "compile": "tsc --noEmit",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@wxt-dev/module-react": "^1.1.5",
    "typescript": "^5.9.3",
    "wxt": "^0.20.18"
  }
}
````

## File: .gitignore
````
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
.output
stats.html
stats-*.json
.wxt
web-ext.config.ts

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
repomix-output.xml
repomix.config.json
.repomixignore
repomix-output.md
````

## File: core/download-manager.ts
````typescript
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
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
````

## File: wxt.config.ts
````typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Aria2 Browser Shim",
    permissions: [
      'downloads',
      'declarativeNetRequest',
      'tabs',
    ],
    host_permissions: [
      'http://localhost:6800/*',
      '<all_urls>' // 用于 declarativeNetRequest 注入 headers
    ],
  },
});
````

## File: readme.md
````markdown
# aria2-browser-shim
Copyright (C) 2026 zzsqjdhqgb

![Status](https://img.shields.io/badge/Status-Proof_of_Concept-orange)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue)
[![License](https://img.shields.io/badge/License-GPL_v3-blue.svg)](./LICENSE)

**aria2-browser-shim** is a lightweight browser extension that seamlessly intercepts Aria2 requests and redirects them to your browser's native download manager.

It acts as a **polyfill**, allowing you to use third-party UserScripts (like those for cloud drives) that mandate an Aria2 connection, **without ever needing to install, configure, or run the actual Aria2 software.**

---

### 🚀 Why this project?

Aria2 is a powerful tool, but setting it up can be a nightmare for average users. You often need to download command-line tools, create configuration files (`aria2.conf`), manage RPC tokens, and manually start background processes just to download a file from a script.

**This extension eliminates that entire learning curve.**

*   **For Beginners:** You don't need to know what "RPC" or "Port 6800" is. Just install this extension, and your scripts will work instantly.
*   **For Minimalists:** Keep your system clean. No background processes, no extra software installed on your OS.
*   **For "It Just Works":** We handle the complex stuff (Cookies, Headers, POST data) automatically behind the scenes.

### ✨ Features

*   **Zero Configuration:** Works immediately after installation. No settings to tweak.
*   **Aria2 Emulation:** Automatically intercepts requests sent to `http://localhost:6800/jsonrpc`. The calling script believes it is talking to a real Aria2 instance.
*   **Seamless Handover:** Takes complex download requests (including authentication Cookies, Referers, and User-Agents) and hands them off to the browser's native downloader.
*   **Smart Directories:** Respects the folder structure requested by the script (e.g., `Batch_Download/file.mp4`) by creating subfolders in your default Downloads directory.

### ⚠️ Limitations

Please note that this project is a **compatibility layer**, not a full-featured download accelerator.

*   ❌ **No BitTorrent / Magnet support.** (Browser native downloads only support HTTP/HTTPS).
*   ❌ **Single-threaded.** Downloads are handled by the browser, so you won't get multi-threaded acceleration.
*   ❌ **No FTP / SFTP support.**
*   ❌ **Limited Resume Capability.** (Dependent on browser and server support).
*   ❌ **Cannot intercept `GM_xmlhttpRequest`.** UserScripts using Greasemonkey/Tampermonkey's `GM_xmlhttpRequest` to call aria2 cannot be intercepted. Only native `fetch` and `WebSocket` are supported.

**If you specifically need multi-threading or BitTorrent support, please install the official [Aria2](https://github.com/aria2/aria2) client.**

### 🏗️ How It Works

The extension uses a multi-layer architecture to intercept and fulfill download requests:

```
UserScript (aria2 RPC call)
  → [MAIN world] fetch/WebSocket interceptor
  → [ISOLATED world] content bridge (CustomEvent ↔ runtime.sendMessage)
  → [Background] Aria2 JSON-RPC parser
  → [Background] DownloadManager
      → declarativeNetRequest (inject request headers + force Content-Disposition)
      → tabs.create (navigate to URL, triggering browser download)
      → downloads.onCreated (match & track the download)
      → cleanup (remove DNR rules + close tab)
```

### 🗺️ Roadmap

- [x] **v0.1.0 - Core Implementation (PoC)** ✅
    - [x] ~~Implement the core download module using `chrome.downloads` API & handle custom Headers via `declarativeNetRequest`.~~ (Abandoned: [see known issues](./KNOWN_ISSUES.md#1-chrome-dnr--downloadsdownload-bug))
    - [x] ~~Implement Offscreen-based download with header injection.~~ (Abandoned: [see known issues](./KNOWN_ISSUES.md#2-offscreen-document-cannot-trigger-downloads))
    - [x] Implement Tab-based download approach with `declarativeNetRequest` header injection
    - [x] Implement the interception module for Aria2 JSON-RPC
        - Intercept `fetch` / `WebSocket` requests to `localhost:6800`
        - Implement `aria2.addUri`
        - `aria2.getVersion`, `aria2.tellStatus`, `aria2.tellActive`, `aria2.pause`, `aria2.unpause`, `aria2.remove` ARE UNCOMPLETED
    - [x] End-to-end verified with a Referer-protected video resource


### 📄 Documentation

- [Known Issues](./KNOWN_ISSUES.md) - Current limitations and browser-specific bugs

---
````

## File: entrypoints/background.ts
````typescript
// entrypoints/background.ts
import { handleAria2Request } from "@/shim/aria2-interceptor";

const LOG_PREFIX = "[Background]";

export default defineBackground(() => {
    console.log(`${LOG_PREFIX} aria2-browser-shim background loaded`);

    // 监听来自 content script 或 popup 的消息
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log(`${LOG_PREFIX} Received message`, {
            type: message?.type,
            senderId: sender.tab?.id,
            senderUrl: sender.tab?.url,
        });

        if (message?.type === "aria2-rpc") {
            console.log(`${LOG_PREFIX} Processing aria2-rpc message`, message.payload);

            handleAria2Request(message.payload)
                .then((response) => {
                    console.log(`${LOG_PREFIX} aria2-rpc response`, response);
                    sendResponse(response);
                })
                .catch((err) => {
                    console.error(`${LOG_PREFIX} aria2-rpc error`, err);
                    sendResponse({ error: err.message });
                });
            return true; // 异步响应
        }

        console.log(`${LOG_PREFIX} Unknown message type: ${message?.type}`);
    });

    console.log(`${LOG_PREFIX} Message listener registered`);
});
````

## File: KNOWN_ISSUES.md
````markdown
# Known Issues

This document tracks known issues and browser-specific bugs encountered during development.

---

## 1. Chrome DNR + downloads.download Bug

**Status:** Abandoned — replaced by Tab-based approach  
**Affects:** Chrome / Chromium-based browsers  
**Related:** [Stack Overflow - Chrome Downloads API http requests are not getting modified by Declarative Net Request API](https://stackoverflow.com/questions/77932227/chrome-downloads-api-http-requests-are-not-getting-modified-by-declarative-net-r)

### Problem

When using `browser.downloads.download()` to initiate a download, Chrome does not allow `declarativeNetRequest` (DNR) rules to modify the request headers (e.g., `Cookie`, `Referer`, `User-Agent`).

This means downloads requiring custom headers will fail to authenticate or be rejected by the server.

### Resolution

This approach was abandoned. See issue #2 for the next attempt, and the final working solution below.

---

## 2. Offscreen Document Cannot Trigger Downloads

**Status:** Abandoned — replaced by Tab-based approach  
**Affects:** Chrome / Chromium-based browsers

### Problem

The original workaround for issue #1 was to use an **Offscreen Document** to trigger downloads by creating an `<a>` element and programmatically clicking it. However, testing revealed that:

1. Offscreen documents run in a restricted context where navigation-triggered downloads do not work as expected.
2. The `<a>` click in an offscreen document does not reliably trigger the browser's download pipeline.
3. Even with `declarativeNetRequest` rules in place, the offscreen document's requests were not properly matched by DNR rules.

Ultimately, the offscreen approach provides no advantage over simply opening a background tab — and the tab approach actually works.

### Resolution

The final working approach uses **`tabs.create()`** to open a background tab:

1. Create `declarativeNetRequest` session rules to:
   - Inject custom request headers (`Cookie`, `Referer`, `User-Agent`, etc.)
   - Inject `Content-Disposition: attachment` response header to force download
2. Open a background tab (`active: false`) navigating to the download URL
3. The browser processes the navigation, applies DNR rules, and triggers a native download
4. Capture the download via `downloads.onCreated`, match it to the pending task by URL
5. Clean up: remove DNR rules and close the tab once the download starts

This approach works reliably because tab navigations are full `MAIN_FRAME` requests that DNR rules can intercept.

---

## 3. GM_xmlhttpRequest Cannot Be Intercepted

**Status:** Known Limitation (Workaround Planned)  
**Affects:** All browsers

### Problem

UserScripts that use `GM_xmlhttpRequest` (Greasemonkey/Tampermonkey/Violentmonkey API) to communicate with aria2 cannot be intercepted by this extension.

`GM_xmlhttpRequest` bypasses the page's JavaScript context entirely, so our `fetch` / `WebSocket` interception has no effect.

### Potential Workarounds

1. **One-click converter page:** A tool to automatically transform UserScripts by replacing `GM_xmlhttpRequest` calls with interceptable `fetch` equivalents
2. **Auto-transform on install:** Intercept `.user.js` pages before Tampermonkey/Violentmonkey processes them, automatically applying the conversion

Until these features are implemented, users must manually modify their scripts or use scripts that rely on native `fetch` / `WebSocket`.

---

## 4. Pending Tasks and Background Tab Leaks

**Status:** Known Issue (Fix Planned)  
**Affects:** All browsers

### Problem

When a download is initiated, the extension creates a background tab (`tabs.create({ active: false })`) to trigger the browser's native download pipeline. 

If the target URL is invalid (e.g., 404 Not Found), encounters a network error, or the server responds with a regular web page instead of triggering a file download, the `browser.downloads.onCreated` event will never fire. Consequently, the extension fails to match and track the download. The task remains stuck in the `pending` state forever, and the background tab is left open, causing a "tab leak".

### Planned Resolution

Implement a global timeout mechanism for pending download tasks. 

If a task remains in the `pending` state for too long without being successfully tracked by the download manager, it will automatically trigger a `cancel` action. The existing cancellation logic will then cleanly recycle the orphaned background tab (`browser.tabs.remove`) and clear any associated `declarativeNetRequest` rules, preventing resource leaks.

## 5. Mocked and Untested Aria2 RPC Methods

**Status:** Known Issue (Refactoring Planned)  
**Affects:** Web UIs and strict clients (e.g., AriaNg)

### Problem

Currently, the only fully implemented and tested RPC method is `aria2.addUri`, which handles the core download interception and initialization. All other RPC methods present in the code (such as `aria2.getVersion`, `aria2.tellStatus`, `aria2.tellActive`, `aria2.pause`, etc.) are unverified, AI-generated stubs. 

These methods were quickly mocked solely to deceive strict frontends like AriaNg, allowing them to connect without throwing immediate validation errors during POC testing. As a result, the returned data is often completely inaccurate. For example, the mocked `aria2.getVersion` response explicitly claims support for `BitTorrent` and `Message Digest`, despite this extension relying purely on the browser's native HTTP/HTTPS download pipeline (which fundamentally lacks BitTorrent support).

### Planned Resolution

These stubs need to be systematically reviewed and refactored:
1. **Accurate Capabilities:** Static mock responses (like `getVersion`) must be updated to honestly reflect the extension's actual capabilities (e.g., explicitly removing `BitTorrent` and other unsupported protocols).
2. **State Mapping:** Dynamic methods (`tellStatus`, `tellActive`) require rigorous testing to ensure the browser's `downloads` API states are correctly translated into the exact JSON schemas expected by standard Aria2 clients.
````

这个项目的aria2 shim部分，目前只是临时测试的不成熟代码，请你完全重写。请依据如下表格，重写每个接口，如果需要可以分多个文件（目前aria2 shim是单文件的）：
### 表格 1：可以完整实现的接口 (Fully Implementable)

| RPC 接口 | 当前（单线程）实现状态 | 多线程实现后的变化 | 实现备注 |
| :--- | :--- | :--- | :--- |
| `aria2.addUri` | 完整实现 | 支持解析 `split` 参数 | 核心接口。利用已实现的敏感 Header 访问能力。 |
| `aria2.remove` | 完整实现 | 无变化 | 终止 Fetch/XHR 并从内存清理任务。 |
| `aria2.forceRemove` | 完整实现 | 无变化 | 逻辑同上。 |
| `aria2.pause` | 完整实现 | 无变化 | 挂起请求（由于是插件，仅需停止数据流写入）。 |
| `aria2.unpause` | 完整实现 | 无变化 | 恢复请求（需服务端支持 `Range`）。 |
| `aria2.tellWaiting` | 完整实现 | 无变化 | 返回插件内部维护的等待队列。 |
| `aria2.tellStopped` | 完整实现 | 无变化 | 返回已完成或因错误停止的任务。 |
| `aria2.getUris` | 完整实现 | 无变化 | 返回任务关联的原始 URL。 |
| `aria2.getVersion` | 完整实现 | 无变化 | 返回自定义的版本号（如 `aria2-shim/1.0.0`）。 |
| `aria2.getSessionInfo`| 完整实现 | 无变化 | 返回插件生成的随机 Session ID。 |
| `aria2.purgeDownloadResult` | 完整实现 | 无变化 | 清理内存中已停止的任务记录。 |
| `system.multicall` | 完整实现 | 无变化 | 逻辑层面的批处理封装。 |
| `system.listMethods` | 完整实现 | 无变化 | 返回支持的 RPC 方法静态列表。 |

### 表格 2：可以部分实现的接口 (Partially Implementable)

| RPC 接口 | 当前（单线程）实现状态 | 多线程实现后的提升 | 限制原因与改进方向 |
| :--- | :--- | :--- | :--- |
| `aria2.tellStatus` | **基础实现** | **大幅增强** | **多线程下可实现 `bitfield`**。单线程无法展示分片进度。多线程可实时计算总带宽。 |
| `aria2.getFiles` | **受限实现** | 无变化 | 仅支持单文件任务。浏览器 API 无法灵活处理 aria2 那种复杂的 `dir` 目录层级映射。 |
| `aria2.getServers` | **单条记录** | **完整实现** | 当前只返回 1 个连接信息。多线程后可返回所有 Chunk 对应的并发连接和速度。 |
| `aria2.changeOption` | **动态实现** | **支持并发参数** | 目前仅能改 Header 等。多线程后可动态调整 `split`（增加新线程或合并线程）。 |
| `aria2.getOption` | **基础实现** | **增加字段** | 仅返回插件实现的选项。磁盘预分配、文件路径映射等原生选项会被忽略。 |
| `aria2.changePosition`| **逻辑模拟** | 无变化 | 仅在插件内部内存队列中调整顺序，无法干预操作系统调度。 |

### 表格 3：无法实现或极难实现的接口 (Unimplementable / Hard)

| RPC 接口 | 无法实现的原因 | 多线程实现下的可能性 | 解决方案/替代建议 |
| :--- | :--- | :--- | :--- |
| `aria2.addTorrent` | 浏览器无法建立原生 TCP/UDP 监听，不支持 DHT/P2P。 | 无 | 除非集成 WebTorrent (WebRTC)，否则无法实现。 |
| `aria2.addMetalink` | 涉及复杂的多文件路径策略及块校验逻辑，浏览器下载 API 难以配合。 | 极低 | 建议前端先解析 Metalink 再分发为多个 `addUri`。 |
| `aria2.getPeers` | 仅用于 BitTorrent。 | 无 | 无 P2P 连接，自然没有 Peer 数据。 |
| `aria2.saveSession` | 浏览器禁止直接向用户磁盘写入 `.session` 文件。 | 无 | 可考虑保存到插件的 `chrome.storage.local` 中。 |
| `aria2.shutdown` | RPC 指令无法杀掉插件进程或关闭浏览器窗口。 | 无 | 接口直接返回 `OK` 但不执行任何操作。 |
| `aria2.forceShutdown` | 同上。 | 无 | 同上。 |

对于有修改的文件，请给出修改后的全部内容。请暂时只修改aria2 shim这个模块