import { downloadManager } from "@/core/download-manager";
import type { Aria2RpcResponse, Aria2VersionResult, Aria2SessionInfoResult } from "../types";
import { getSessionId } from "../session";

const LOG_PREFIX = "[Aria2:meta]";

/**
 * The version string we report.
 * The format "shim/x.y.z" makes it clear this is not real aria2.
 */
const SHIM_VERSION = "1.37.0";

/**
 * Features we actually support (honestly reported).
 */
const ENABLED_FEATURES: string[] = [
    "GZip",
    "HTTPS",
];

/**
 * aria2.getVersion([secret])
 *
 * Returns version info and enabled features.
 */
export async function getVersion(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getVersion`);

    const result: Aria2VersionResult = {
        version: SHIM_VERSION,
        enabledFeatures: ENABLED_FEATURES,
    };

    return { jsonrpc: "2.0", id, result };
}

/**
 * aria2.getSessionInfo([secret])
 *
 * Returns session information. The sessionId persists for the lifetime
 * of the background service worker.
 */
export async function getSessionInfo(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} getSessionInfo`);

    const result: Aria2SessionInfoResult = {
        sessionId: getSessionId(),
    };

    return { jsonrpc: "2.0", id, result };
}

/**
 * aria2.purgeDownloadResult([secret])
 *
 * Purges completed/error/removed download results from memory.
 */
export async function purgeDownloadResult(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} purgeDownloadResult`);

    downloadManager.purgeResults();
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.removeDownloadResult([secret], gid)
 *
 * Removes a specific completed download result from memory.
 */
export async function removeDownloadResult(
    id: string | number,
    params: unknown[]
): Promise<Aria2RpcResponse> {
    const gid = params[0] as string | undefined;
    if (!gid || typeof gid !== "string") {
        return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing GID" },
        };
    }

    console.log(`${LOG_PREFIX} removeDownloadResult gid=${gid}`);

    const removed = downloadManager.removeResult(gid);
    if (!removed) {
        return {
            jsonrpc: "2.0",
            id,
            error: { code: 1, message: `Cannot remove result for GID ${gid}` },
        };
    }

    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.shutdown([secret])
 *
 * In real aria2, this shuts down the process.
 * We accept the call but do nothing — a browser extension cannot shut itself down.
 */
export async function shutdown(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} shutdown called (no-op)`);
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.forceShutdown([secret])
 *
 * Same as shutdown — accepted but not executed.
 */
export async function forceShutdown(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} forceShutdown called (no-op)`);
    return { jsonrpc: "2.0", id, result: "OK" };
}

/**
 * aria2.saveSession([secret])
 *
 * In real aria2, this saves the session to disk.
 * Browser extensions cannot write arbitrary files, so we accept but no-op.
 */
export async function saveSession(
    id: string | number,
    _params: unknown[]
): Promise<Aria2RpcResponse> {
    console.log(`${LOG_PREFIX} saveSession called (no-op, browser cannot write session files)`);
    return { jsonrpc: "2.0", id, result: "OK" };
}