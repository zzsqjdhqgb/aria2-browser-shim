import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse } from "../types";
import * as errors from "../errors";

const LOG_PREFIX = "[Aria2:options]";

/**
 * The set of options we can meaningfully report.
 * These reflect what our shim actually supports.
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

/**
 * aria2.getOption([secret], gid)
 *
 * Returns options of the download denoted by gid.
 * Returns only options that the shim recognizes.
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

    const options = getDefaultOptions();

    // Fill in task-specific values
    if (task.request.directory) {
        options["dir"] = task.request.directory;
    }
    if (task.request.filename) {
        options["out"] = task.request.filename;
    }
    if (task.request.headers) {
        const headerArr = Object.entries(task.request.headers).map(
            ([k, v]) => `${k}: ${v}`
        );
        options["header"] = JSON.stringify(headerArr);
    }

    return { jsonrpc: "2.0", id, result: options };
}

/**
 * aria2.changeOption([secret], gid, options)
 *
 * Changes options of the download denoted by gid dynamically.
 * In our shim, this is a limited no-op for most options since
 * browser downloads can't be reconfigured mid-flight.
 * We accept the call and log it, but only a few options have real effect.
 */
export async function changeOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    const options = params[1] as Record<string, unknown> | undefined;

    if (!gid || typeof gid !== "string") {
        return { jsonrpc: "2.0", id, error: errors.invalidParams("Missing GID") };
    }

    console.log(`${LOG_PREFIX} changeOption gid=${gid}`, options);

    const task = downloadManager.getTask(gid);
    if (!task) {
        return { jsonrpc: "2.0", id, error: errors.gidNotFound(gid) };
    }

    // Log the options but note we can't actually change most things mid-download
    if (options) {
        console.warn(
            `${LOG_PREFIX} changeOption: options received but most cannot be applied ` +
            `to in-progress browser downloads. Options:`, options
        );
    }

    // Accept the call gracefully
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.getGlobalOption([secret])
 *
 * Returns global options.
 */
export async function getGlobalOption(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getGlobalOption`);

    const options = getDefaultOptions();
    // Add global-only options
    options["max-concurrent-downloads"] = "5";
    options["max-overall-download-limit"] = "0";
    options["max-overall-upload-limit"] = "0";
    options["save-session"] = "";
    options["save-session-interval"] = "0";
    options["log-level"] = "debug";

    return { jsonrpc: "2.0", id, result: options };
}

/**
 * aria2.changeGlobalOption([secret], options)
 *
 * Changes global options. In our shim, accepted but mostly ignored.
 */
export async function changeGlobalOption(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const options = params[0] as Record<string, unknown> | undefined;
    console.log(`${LOG_PREFIX} changeGlobalOption`, options);

    // Accept gracefully; we don't have real global config to modify
    return { jsonrpc: "2.0", id, result: "OK" };
}