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