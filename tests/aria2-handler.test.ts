import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Aria2RpcRequest, Aria2RpcResponse, DownloadTask } from "@/core/types";
import { DEFAULT_SETTINGS } from "@/core/types";

// =============================================================================
// Mock downloadManager
// =============================================================================

const mockDm = {
    create: vi.fn(() => Promise.resolve("mock-gid-001")),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    cancelAll: vi.fn(() => Promise.resolve()),
    getTask: vi.fn(),
    queryTasks: vi.fn(() => [] as DownloadTask[]),
    removeTask: vi.fn(() => true),
    purgeCompleted: vi.fn(() => 0),
};

vi.mock("@/core/download-manager", () => ({
    downloadManager: mockDm,
}));

// =============================================================================
// Helpers
// =============================================================================

function rpc(method: string, params?: unknown[], id: string | number = "1"): Aria2RpcRequest {
    return { jsonrpc: "2.0", id, method, params };
}

function makeTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
    return {
        id: "abcdef01",
        url: "http://example.com/file.zip",
        started: true,
        browserDownloadId: 42,
        request: { url: "http://example.com/file.zip", filename: "file.zip" },
        status: "in_progress",
        bytesReceived: 512,
        totalBytes: 1024,
        speed: 256,
        createdAt: Date.now(),
        ...overrides,
    };
}

async function resultOf(resp: Aria2RpcResponse): Promise<unknown> {
    return (await resp).result;
}

async function errorOf(resp: Aria2RpcResponse): Promise<{ code: number; message: string }> {
    return (await resp).error!;
}

// =============================================================================
// Tests
// =============================================================================

describe("Aria2Handler", () => {
    let handleAria2Request: typeof import("@/core/aria2-handler").handleAria2Request;

    beforeEach(async () => {
        vi.resetModules();
        // Reset mock state
        vi.clearAllMocks();
        mockDm.queryTasks.mockReturnValue([]);
        mockDm.create.mockResolvedValue("mock-gid-001");
        mockDm.purgeCompleted.mockReturnValue(0);

        // Re-import to get fresh module state (resets _sessionId cache)
        const mod = await import("@/core/aria2-handler");
        handleAria2Request = mod.handleAria2Request;

        // Set enabled=true by default
        await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, enabled: true } });
    });

    // =====================================================================
    // JSON-RPC basics
    // =====================================================================

    it("returns valid jsonrpc 2.0 response", async () => {
        const res = (await handleAria2Request(rpc("aria2.getVersion"))) as Aria2RpcResponse;
        expect(res.jsonrpc).toBe("2.0");
        expect(res.id).toBe("1");
        expect(res.result).toBeDefined();
    });

    it("returns error for unknown method", async () => {
        const res = (await handleAria2Request(rpc("aria2.nonExistent"))) as Aria2RpcResponse;
        expect(res.error?.code).toBe(-32601);
    });

    it("handles batch requests (array)", async () => {
        const results = await handleAria2Request([
            rpc("aria2.getVersion", [], "a"),
            rpc("system.listMethods", [], "b"),
        ]);
        expect(Array.isArray(results)).toBe(true);
        const arr = results as Aria2RpcResponse[];
        expect(arr).toHaveLength(2);
        expect(arr[0].id).toBe("a");
        expect(arr[1].id).toBe("b");
    });

    // =====================================================================
    // aria2.addUri
    // =====================================================================

    it("addUri creates a download task and returns GID", async () => {
        const res = (await handleAria2Request(rpc("aria2.addUri", [
            ["http://example.com/file.zip"],
            { out: "file.zip", dir: "/dl", header: ["Cookie: session=abc"] },
        ]))) as Aria2RpcResponse;
        expect(res.result).toBe("mock-gid-001");
        expect(mockDm.create).toHaveBeenCalledWith(expect.objectContaining({
            url: "http://example.com/file.zip",
            filename: "file.zip",
            directory: "/dl",
            headers: { Cookie: "session=abc" },
        }));
    });

    it("addUri with multiple URIs passes fallback URLs", async () => {
        (await handleAria2Request(rpc("aria2.addUri", [
            ["http://primary/file.zip", "http://mirror/file.zip"],
        ]))) as Aria2RpcResponse;
        expect(mockDm.create).toHaveBeenCalledWith(expect.objectContaining({
            url: "http://primary/file.zip",
            urls: ["http://mirror/file.zip"],
        }));
    });

    it("addUri returns error when URIs array is empty", async () => {
        const res = (await handleAria2Request(rpc("aria2.addUri", [[]]))) as Aria2RpcResponse;
        expect(res.error?.code).toBe(-32602);
    });

    it("addUri returns error when URIs param is missing", async () => {
        const res = (await handleAria2Request(rpc("aria2.addUri", []))) as Aria2RpcResponse;
        expect(res.error?.code).toBe(-32602);
    });

    it("addUri strips secret token prefix", async () => {
        (await handleAria2Request(rpc("aria2.addUri", [
            "token:mysecret",
            ["http://example.com/file.zip"],
        ]))) as Aria2RpcResponse;
        expect(mockDm.create).toHaveBeenCalledWith(expect.objectContaining({
            url: "http://example.com/file.zip",
        }));
    });

    // =====================================================================
    // Unsupported methods
    // =====================================================================

    it("addTorrent returns unsupported error", async () => {
        const res = (await handleAria2Request(rpc("aria2.addTorrent", ["base64..."]))) as Aria2RpcResponse;
        expect(res.error?.message).toContain("not supported");
    });

    it("addMetalink returns unsupported error", async () => {
        const res = (await handleAria2Request(rpc("aria2.addMetalink", ["base64..."]))) as Aria2RpcResponse;
        expect(res.error?.message).toContain("not supported");
    });

    // =====================================================================
    // Control methods
    // =====================================================================

    it("pause calls downloadManager.pause", async () => {
        const res = (await handleAria2Request(rpc("aria2.pause", ["gid-1"]))) as Aria2RpcResponse;
        expect(res.result).toBe("gid-1");
        expect(mockDm.pause).toHaveBeenCalledWith("gid-1");
    });

    it("unpause calls downloadManager.resume", async () => {
        const res = (await handleAria2Request(rpc("aria2.unpause", ["gid-1"]))) as Aria2RpcResponse;
        expect(res.result).toBe("gid-1");
        expect(mockDm.resume).toHaveBeenCalledWith("gid-1");
    });

    it("remove calls downloadManager.cancel", async () => {
        const res = (await handleAria2Request(rpc("aria2.remove", ["gid-1"]))) as Aria2RpcResponse;
        expect(res.result).toBe("gid-1");
        expect(mockDm.cancel).toHaveBeenCalledWith("gid-1");
    });

    it("forceRemove calls downloadManager.cancel", async () => {
        (await handleAria2Request(rpc("aria2.forceRemove", ["gid-1"]))) as Aria2RpcResponse;
        expect(mockDm.cancel).toHaveBeenCalledWith("gid-1");
    });

    it("pauseAll pauses all in_progress tasks", async () => {
        mockDm.queryTasks.mockReturnValue([
            makeTask({ id: "a", status: "in_progress" }),
            makeTask({ id: "b", status: "in_progress" }),
        ]);
        const res = (await handleAria2Request(rpc("aria2.pauseAll"))) as Aria2RpcResponse;
        expect(res.result).toBe("OK");
        expect(mockDm.pause).toHaveBeenCalledTimes(2);
    });

    it("unpauseAll resumes all paused tasks", async () => {
        mockDm.queryTasks.mockReturnValue([
            makeTask({ id: "a", status: "paused" }),
        ]);
        (await handleAria2Request(rpc("aria2.unpauseAll"))) as Aria2RpcResponse;
        expect(mockDm.resume).toHaveBeenCalledTimes(1);
    });

    it("removeDownloadResult removes a completed task", async () => {
        const res = (await handleAria2Request(rpc("aria2.removeDownloadResult", ["gid-done"]))) as Aria2RpcResponse;
        expect(res.result).toBe("OK");
        expect(mockDm.removeTask).toHaveBeenCalledWith("gid-done");
    });

    it("purgeDownloadResult purges completed tasks", async () => {
        mockDm.purgeCompleted.mockReturnValue(5);
        const res = (await handleAria2Request(rpc("aria2.purgeDownloadResult"))) as Aria2RpcResponse;
        expect(res.result).toBe("5");
        expect(mockDm.purgeCompleted).toHaveBeenCalled();
    });

    // =====================================================================
    // Query methods
    // =====================================================================

    it("tellStatus returns full task info", async () => {
        mockDm.getTask.mockReturnValue(makeTask({
            id: "abcdef01", status: "in_progress",
            bytesReceived: 512, totalBytes: 1024, speed: 256,
        }));
        const res = (await handleAria2Request(rpc("aria2.tellStatus", ["abcdef01"]))) as Aria2RpcResponse;
        const info = res.result as unknown as Record<string, unknown>;
        expect(info.gid).toBe("abcdef01");
        expect(info.status).toBe("active");
        expect(info.completedLength).toBe("512");
        expect(info.totalLength).toBe("1024");
        expect(info.downloadSpeed).toBe("256");
    });

    it("tellStatus returns error for unknown GID", async () => {
        mockDm.getTask.mockReturnValue(undefined);
        const res = (await handleAria2Request(rpc("aria2.tellStatus", ["nonexistent"]))) as Aria2RpcResponse;
        expect(res.error?.code).toBe(1);
    });

    it("tellActive returns list of active tasks", async () => {
        mockDm.queryTasks.mockReturnValue([
            makeTask({ id: "a", status: "in_progress", bytesReceived: 100, totalBytes: 200 }),
            makeTask({ id: "b", status: "in_progress", bytesReceived: 300, totalBytes: 400 }),
        ]);
        const res = (await handleAria2Request(rpc("aria2.tellActive"))) as Aria2RpcResponse;
        const tasks = res.result as unknown as Record<string, unknown>[];
        expect(tasks).toHaveLength(2);
        expect(tasks[0].gid).toBe("a");
        expect(tasks[1].gid).toBe("b");
    });

    it("tellWaiting returns waiting/paused tasks", async () => {
        mockDm.queryTasks.mockReturnValue([makeTask({ id: "w", status: "pending" })]);
        const res = (await handleAria2Request(rpc("aria2.tellWaiting", [0, 100]))) as Aria2RpcResponse;
        const tasks = res.result as unknown as Record<string, unknown>[];
        expect(tasks[0].status).toBe("waiting");
    });

    it("tellStopped returns completed/error/cancelled tasks", async () => {
        mockDm.queryTasks.mockReturnValue([makeTask({ id: "s", status: "complete" })]);
        const res = (await handleAria2Request(rpc("aria2.tellStopped", [0, 100]))) as Aria2RpcResponse;
        const tasks = res.result as unknown as Record<string, unknown>[];
        expect(tasks[0].status).toBe("complete");
    });

    // =====================================================================
    // Stats & system
    // =====================================================================

    it("getGlobalStat returns aggregate statistics", async () => {
        mockDm.queryTasks.mockReturnValue([
            makeTask({ id: "1", status: "in_progress", speed: 100 }),
            makeTask({ id: "2", status: "in_progress", speed: 50 }),
            makeTask({ id: "3", status: "pending" }),
            makeTask({ id: "4", status: "complete" }),
        ]);
        const res = (await handleAria2Request(rpc("aria2.getGlobalStat"))) as Aria2RpcResponse;
        const stat = res.result as Record<string, string>;
        expect(stat.numActive).toBe("2");
        expect(stat.numWaiting).toBe("1");
        expect(stat.numStopped).toBe("1");
        expect(stat.downloadSpeed).toBe("150");
    });

    it("getVersion returns accurate feature list (no BT/FTP)", async () => {
        const res = (await handleAria2Request(rpc("aria2.getVersion"))) as Aria2RpcResponse;
        const ver = res.result as { version: string; enabledFeatures: string[] };
        expect(ver.version).toContain("shim");
        expect(ver.enabledFeatures).not.toContain("BitTorrent");
        expect(ver.enabledFeatures).not.toContain("FTP");
        expect(ver.enabledFeatures).toContain("HTTP");
        expect(ver.enabledFeatures).toContain("HTTPS");
    });

    it("getSessionInfo returns a session ID", async () => {
        const res = (await handleAria2Request(rpc("aria2.getSessionInfo"))) as Aria2RpcResponse;
        const info = res.result as { sessionId: string };
        expect(info.sessionId).toBeTruthy();
        expect(typeof info.sessionId).toBe("string");

        // Calling again returns same ID (cached)
        const res2 = (await handleAria2Request(rpc("aria2.getSessionInfo"))) as Aria2RpcResponse;
        const info2 = res2.result as { sessionId: string };
        expect(info2.sessionId).toBe(info.sessionId);
    });

    it("shutdown disables extension and cancels all downloads", async () => {
        const res = (await handleAria2Request(rpc("aria2.shutdown"))) as Aria2RpcResponse;
        expect(res.result).toBe("OK");
        expect(mockDm.cancelAll).toHaveBeenCalled();

        // After shutdown, setEnabled(false) was called — verify storage
        const stored = await browser.storage.local.get("settings");
        expect((stored as any).settings.enabled).toBe(false);
    });

    it("changeGlobalOption updates stored settings", async () => {
        (await handleAria2Request(rpc("aria2.changeGlobalOption", [{ dir: "/downloads" }]))) as Aria2RpcResponse;
        const stored = await browser.storage.local.get("settings");
        expect((stored as any).settings.defaultDir).toBe("/downloads");
    });

    // =====================================================================
    // system.multicall
    // =====================================================================

    it("system.multicall processes multiple calls", async () => {
        const res = (await handleAria2Request(rpc("system.multicall", [[
            { methodName: "aria2.getVersion", params: [] },
            { methodName: "aria2.tellActive", params: [] },
        ]]))) as Aria2RpcResponse;
        const results = res.result as unknown[][];
        expect(results).toHaveLength(2);
        // First result: [versionObj]
        expect(Array.isArray(results[0])).toBe(true);
        expect((results[0] as unknown[])[0]).toHaveProperty("version");
        // Second result: [[]] (no active tasks)
        expect(Array.isArray(results[1])).toBe(true);
    });

    it("system.listMethods returns all supported methods", async () => {
        const res = (await handleAria2Request(rpc("system.listMethods"))) as Aria2RpcResponse;
        const methods = res.result as string[];
        expect(methods).toContain("aria2.addUri");
        expect(methods).toContain("aria2.tellStatus");
        expect(methods).toContain("aria2.shutdown");
        expect(methods).toContain("system.multicall");
    });

    it("system.multicall handles errors in individual calls", async () => {
        const res = (await handleAria2Request(rpc("system.multicall", [[
            { methodName: "aria2.getVersion", params: [] },
            { methodName: "aria2.nonExistent", params: [] },
        ]]))) as Aria2RpcResponse;
        const results = res.result as unknown[][];
        expect(results).toHaveLength(2);
        // Second call should be an error object, not an array
        expect((results[1] as unknown as Record<string, unknown>).code).toBe(-32601);
    });

    // =====================================================================
    // Disabled state
    // =====================================================================

    it("returns error when extension is disabled", async () => {
        await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, enabled: false } });
        const res = (await handleAria2Request(rpc("aria2.getVersion"))) as Aria2RpcResponse;
        expect(res.error?.code).toBe(-32000);
        expect(res.error?.message).toContain("disabled");
    });

    // =====================================================================
    // Secret token auth
    // =====================================================================

    it("rejects request when rpcSecret is set and no token provided", async () => {
        await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, rpcSecret: "s3cret" } });
        const res = (await handleAria2Request(rpc("aria2.getVersion"))) as Aria2RpcResponse;
        expect(res.error?.code).toBe(-32001);
    });

    it("accepts request with correct token prefix", async () => {
        await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, rpcSecret: "s3cret" } });
        const res = (await handleAria2Request(rpc("aria2.getVersion", ["token:s3cret"]))) as Aria2RpcResponse;
        expect(res.result).toBeDefined();
    });

    it("rejects request with wrong token", async () => {
        await browser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, rpcSecret: "s3cret" } });
        // Token prefix "token:wrong" is stripped, but the remaining token doesn't match
        const res = (await handleAria2Request(rpc("aria2.addUri", ["token:wrong", ["http://x.com/z"]]))) as Aria2RpcResponse;
        // In this impl, wrong token passes the first check (hadToken) but the value check comes from params[0] after strip
        // Let me check... actually stripToken removes the first param, and the check is:
        // if (hadToken && settings.rpcSecret && rawParams[0] !== `token:${settings.rpcSecret}`) return error
        // rawParams[0] is "token:wrong", so it DOES match: "token:wrong" !== "token:s3cret"
        expect(res.error?.code).toBe(-32001);
    });

    // =====================================================================
    // Edge cases
    // =====================================================================

    it("handles request with empty params", async () => {
        const res = (await handleAria2Request(rpc("aria2.getVersion", undefined))) as Aria2RpcResponse;
        expect(res.result).toBeDefined();
    });

    it("handles request with numeric id 0", async () => {
        const res = (await handleAria2Request(rpc("aria2.getVersion", [], 0 as unknown as string))) as Aria2RpcResponse;
        expect(res.jsonrpc).toBe("2.0");
        expect(res.id).toBe(0);
    });

    it("getPeers returns empty array (no BT)", async () => {
        const res = (await handleAria2Request(rpc("aria2.getPeers", ["gid-1"]))) as Aria2RpcResponse;
        expect(res.result).toEqual([]);
    });

    it("getServers returns empty array (no BT)", async () => {
        const res = (await handleAria2Request(rpc("aria2.getServers", ["gid-1"]))) as Aria2RpcResponse;
        expect(res.result).toEqual([]);
    });
});