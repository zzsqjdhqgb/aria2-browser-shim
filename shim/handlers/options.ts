import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:options]";

/**
 * The per-download option defaults we can meaningfully expose.
 */
function getDefaultOptions(): Record<string, string> {
    return {
        "allow-overwrite": "false",
        "allow-piece-length-change": "false",
        "always-resume": "true",
        "auto-file-renaming": "true",
        "conditional-get": "false",
        "connect-timeout": "60",
        "continue": "true",
        "dir": "",
        "dry-run": "false",
        "enable-http-keep-alive": "true",
        "enable-http-pipelining": "false",
        "file-allocation": "none",
        "http-accept-gzip": "false",
        "max-connection-per-server": "1",
        "max-download-limit": "0",
        "max-file-not-found": "0",
        "max-tries": "5",
        "min-split-size": "20M",
        "no-netrc": "false",
        "out": "",
        "parameterized-uri": "false",
        "pause": "false",
        "piece-length": "1M",
        "proxy-method": "get",
        "remote-time": "false",
        "remove-control-file": "false",
        "retry-wait": "0",
        "reuse-uri": "true",
        "rpc-save-upload-metadata": "true",
        "split": "1",
        "timeout": "60",
        "uri-selector": "feedback",
    };
}

const GLOBAL_ONLY_DEFAULTS: Record<string, string> = {
    "max-concurrent-downloads": "5",
    "max-overall-download-limit": "0",
    "max-overall-upload-limit": "0",
    "save-session": "",
    "save-session-interval": "0",
    "log-level": "debug",
    "max-download-result": "1000",
};

const globalOptionsState: Record<string, string> = {
    ...getDefaultOptions(),
    ...GLOBAL_ONLY_DEFAULTS,
};

export function getMaxDownloadResultCap(): number {
    const raw = Number(globalOptionsState["max-download-result"]);
    return Number.isInteger(raw) && raw >= 0 ? raw : 1000;
}

function getTaskOptionTemplate(): Record<string, unknown> {
    const template = getDefaultOptions() as Record<string, unknown>;

    // Global options are the template for newly added downloads in aria2.
    // We mirror that behavior for overlapping per-download keys.
    for (const key of Object.keys(template)) {
        if (typeof globalOptionsState[key] === "string") {
            template[key] = globalOptionsState[key];
        }
    }

    return template;
}

/**
 * aria2.getOption([secret], gid)
 */
export async function getOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} getOption gid=${gid}`);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    const options = getTaskOptionTemplate();

    if (task.request.directory) {
        options["dir"] = task.request.directory;
    }
    if (task.request.filename) {
        options["out"] = task.request.filename;
    }
    if (task.request.headers) {
        const headerArr = Object.entries(task.request.headers).map(([k, v]) => `${k}: ${v}`);
        options["header"] = headerArr;
    }

    return { jsonrpc: "2.0", id, result: options };
}

/**
 * aria2.changeOption([secret], gid, options)
 */
export async function changeOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    const options = params[1];

    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} changeOption gid=${gid}`, options);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    if (!options || typeof options !== "object" || Array.isArray(options)) {
        return {
            jsonrpc: "2.0",
            id,
            error: errors.invalidParams("options must be an object"),
        };
    }

    // Browser downloads cannot apply most option mutations at runtime.
    console.warn(`${LOG_PREFIX} changeOption is accepted but mostly non-operational`, options);

    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.getGlobalOption([secret])
 */
export async function getGlobalOption(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getGlobalOption`);
    return { jsonrpc: "2.0", id, result: { ...globalOptionsState } };
}

/**
 * aria2.changeGlobalOption([secret], options)
 */
export async function changeGlobalOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const options = params[0];
    console.log(`${LOG_PREFIX} changeGlobalOption`, options);

    if (!options || typeof options !== "object" || Array.isArray(options)) {
        return {
            jsonrpc: "2.0",
            id,
            error: errors.invalidParams("options must be an object"),
        };
    }

    for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
        if (typeof value !== "string") {
            return {
                jsonrpc: "2.0",
                id,
                error: errors.invalidParams(`option ${key} must be a string`),
            };
        }
        globalOptionsState[key] = value;
    }

    return { jsonrpc: "2.0", id, result: "OK" };
}
