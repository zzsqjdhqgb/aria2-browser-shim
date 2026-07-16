import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoredTask } from "@/core/types";

const mockLoadTasksSnapshot = vi.fn(() => Promise.resolve([] as StoredTask[]));
const mockSaveTasksSnapshot = vi.fn(() => Promise.resolve());

vi.mock("@/core/storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/storage")>();
    return { ...actual, loadTasksSnapshot: mockLoadTasksSnapshot, saveTasksSnapshot: mockSaveTasksSnapshot };
});

function storedTask(overrides: Partial<StoredTask> = {}): StoredTask {
    return { id: "stored-1", url: "http://example.com/file.zip", filename: "file.zip", directory: "", status: "complete", bytesReceived: 0, totalBytes: 0, createdAt: Date.now() - 10000, ...overrides };
}

function lastTabCreateArgs() {
    const calls = (browser.tabs.create as ReturnType<typeof vi.fn>).mock.calls;
    return calls[calls.length - 1]?.[0] as { url?: string; active?: boolean };
}

describe("DownloadManager", () => {
    let dm: typeof import("@/core/download-manager").downloadManager;

    beforeEach(async () => {
        const internal = (browser as any)._internal;
        vi.resetModules();
        // vi.resetModules() clears mock implementations including addListener.
        // Re-wire them so the DownloadManager constructor can register its handlers.
        (browser.downloads.onCreated.addListener as ReturnType<typeof vi.fn>).mockImplementation(
            (fn: (...args: unknown[]) => void) => internal.downloadsCreatedListeners.push(fn),
        );
        (browser.downloads.onChanged.addListener as ReturnType<typeof vi.fn>).mockImplementation(
            (fn: (...args: unknown[]) => void) => internal.downloadsChangedListeners.push(fn),
        );
        mockLoadTasksSnapshot.mockResolvedValue([]);
        const mod = await import("@/core/download-manager");
        dm = mod.downloadManager;
        await dm.init();
    });

    it("create opens a background tab with the download URL", async () => {
        const taskId = await dm.create({ url: "http://example.com/video.mp4" });
        expect(taskId).toBeTruthy();
        expect(typeof taskId).toBe("string");
        expect(taskId.length).toBe(16);
        const tabArgs = lastTabCreateArgs();
        expect(tabArgs.url).toBe("http://example.com/video.mp4");
        expect(tabArgs.active).toBe(false);
    });

    it("create injects a DNR rule", async () => {
        await dm.create({ url: "http://example.com/file.zip" });
        expect(browser.declarativeNetRequest.updateSessionRules).toHaveBeenCalled();
        const callArgs = (browser.declarativeNetRequest.updateSessionRules as ReturnType<typeof vi.fn>).mock.calls;
        const arg = callArgs[0][0] as { addRules: Array<{ condition: { urlFilter: string } }> };
        expect(arg.addRules[0].condition.urlFilter).toBe("http://example.com/file.zip");
    });

    it("create stores the task and returns it via getTask", async () => {
        const taskId = await dm.create({ url: "http://example.com/file.zip", filename: "f.zip" });
        const task = dm.getTask(taskId);
        expect(task).toBeDefined();
        expect(task!.status).toBe("pending");
        expect(task!.url).toBe("http://example.com/file.zip");
        expect(task!.request.filename).toBe("f.zip");
    });

    it("create marks task as error when tab creation fails", async () => {
        (browser.tabs.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Tab error"));
        const taskId = await dm.create({ url: "http://example.com/file.zip" });
        const task = dm.getTask(taskId);
        expect(task!.status).toBe("error");
        expect(task!.error).toContain("Tab error");
    });

    it("cancel cancels a task and marks it as cancelled", async () => {
        const taskId = await dm.create({ url: "http://example.com/file.zip" });
        await dm.cancel(taskId);
        const task = dm.getTask(taskId);
        expect(task!.status).toBe("cancelled");
        expect(task!.completedAt).toBeGreaterThan(0);
    });

    it("cancelAll cancels all active tasks", async () => {
        const id1 = await dm.create({ url: "http://a.com/1" });
        const id2 = await dm.create({ url: "http://a.com/2" });
        await dm.cancelAll();
        expect(dm.getTask(id1)!.status).toBe("cancelled");
        expect(dm.getTask(id2)!.status).toBe("cancelled");
    });

    it("queryTasks returns all tasks sorted by createdAt desc", async () => {
        const t1 = await dm.create({ url: "http://a.com/1" });
        await new Promise(r => setTimeout(r, 5));
        const t2 = await dm.create({ url: "http://a.com/2" });
        const all = dm.queryTasks();
        expect(all).toHaveLength(2);
        expect(all[0].id).toBe(t2);
        expect(all[1].id).toBe(t1);
    });

    it("queryTasks filters by single status", async () => {
        const t1 = await dm.create({ url: "http://a.com/1" });
        await dm.cancel(t1);
        await dm.create({ url: "http://a.com/2" });
        const cancelled = dm.queryTasks({ status: "cancelled" });
        expect(cancelled).toHaveLength(1);
    });

    it("removeTask removes a terminal task", async () => {
        const t1 = await dm.create({ url: "http://a.com/1" });
        await dm.cancel(t1);
        expect(dm.removeTask(t1)).toBe(true);
        expect(dm.getTask(t1)).toBeUndefined();
    });

    it("removeTask refuses to remove an active task", async () => {
        const t1 = await dm.create({ url: "http://a.com/1" });
        expect(dm.removeTask(t1)).toBe(false);
        expect(dm.getTask(t1)).toBeDefined();
    });

    it("purgeCompleted removes all terminal tasks", async () => {
        const t1 = await dm.create({ url: "http://a.com/1" });
        const t2 = await dm.create({ url: "http://a.com/2" });
        await dm.cancel(t1);
        expect(dm.purgeCompleted()).toBe(1);
        expect(dm.getTask(t1)).toBeUndefined();
        expect(dm.getTask(t2)).toBeDefined();
    });

    it("init restores complete tasks from storage", async () => {
        vi.resetModules();
        mockLoadTasksSnapshot.mockResolvedValue([
            storedTask({ id: "old-1", status: "complete", completedAt: 1000 }),
            storedTask({ id: "old-2", status: "error", error: "timeout" }),
        ]);
        const mod = await import("@/core/download-manager");
        const dm2 = mod.downloadManager;
        await dm2.init();
        expect(dm2.getTask("old-1")!.status).toBe("complete");
        expect(dm2.getTask("old-2")!.status).toBe("error");
        expect(dm2.getTask("old-2")!.error).toBe("timeout");
    });

    it("init marks stored pending tasks as error (tab/rule lost on restart)", async () => {
        vi.resetModules();
        mockLoadTasksSnapshot.mockResolvedValue([storedTask({ id: "pending-1", status: "pending" })]);
        const mod = await import("@/core/download-manager");
        const dm2 = mod.downloadManager;
        await dm2.init();
        const task = dm2.getTask("pending-1")!;
        expect(task.status).toBe("error");
        expect(task.error).toContain("restarted");
    });

    it("init reconnects in_progress tasks with active browser downloads", async () => {
        vi.resetModules();
        mockLoadTasksSnapshot.mockResolvedValue([
            storedTask({ id: "active-1", status: "in_progress", browserDownloadId: 99, bytesReceived: 500, totalBytes: 2000 }),
        ]);
        (browser.downloads.search as ReturnType<typeof vi.fn>).mockResolvedValue([{
            id: 99, url: "http://example.com/file.zip", filename: "file.zip", state: "in_progress",
            bytesReceived: 750, fileSize: 2000, mime: "application/zip", startTime: new Date().toISOString(),
            danger: "safe", exists: true, paused: false, canResume: true,
        }]);
        const mod = await import("@/core/download-manager");
        const dm2 = mod.downloadManager;
        await dm2.init();
        const task = dm2.getTask("active-1")!;
        expect(task.status).toBe("in_progress");
        expect(task.bytesReceived).toBe(750);
        expect(task.totalBytes).toBe(2000);
    });

    it("init marks in_progress tasks as error when browser download no longer exists", async () => {
        vi.resetModules();
        mockLoadTasksSnapshot.mockResolvedValue([
            storedTask({ id: "lost-1", status: "in_progress", browserDownloadId: 42 }),
        ]);
        (browser.downloads.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const mod = await import("@/core/download-manager");
        const dm2 = mod.downloadManager;
        await dm2.init();
        const task = dm2.getTask("lost-1")!;
        expect(task.status).toBe("error");
        expect(task.error).toContain("lost");
    });

    it("matches a browser download to a pending task by URL", async () => {
        await dm.create({ url: "http://example.com/match.zip" });
        const createdListeners = (browser as any)._internal.downloadsCreatedListeners;
        createdListeners[0]({
            id: 55, url: "http://example.com/match.zip", filename: "match.zip",
            bytesReceived: 0, fileSize: 1000, mime: "application/zip", startTime: new Date().toISOString(),
            danger: "safe", exists: true, paused: false, canResume: true, state: "in_progress",
        });
        const task = dm.queryTasks()[0];
        expect(task.status).toBe("in_progress");
        expect(task.browserDownloadId).toBe(55);
    });

    it("handles download state transitions via onChanged", async () => {
        await dm.create({ url: "http://example.com/change.zip" });
        const createdListeners = (browser as any)._internal.downloadsCreatedListeners;
        createdListeners[0]({
            id: 77, url: "http://example.com/change.zip", filename: "change.zip",
            bytesReceived: 0, fileSize: 500, mime: "application/zip", startTime: new Date().toISOString(),
            danger: "safe", exists: true, paused: false, canResume: true, state: "in_progress",
        });
        const changedListeners = (browser as any)._internal.downloadsChangedListeners;
        changedListeners[0]({ id: 77, state: { current: "complete" } });
        const task = dm.queryTasks()[0];
        expect(task.status).toBe("complete");
        expect(task.completedAt).toBeGreaterThan(0);
    });

    it("handles download interruption via onChanged", async () => {
        await dm.create({ url: "http://example.com/interrupt.zip" });
        const createdListeners = (browser as any)._internal.downloadsCreatedListeners;
        createdListeners[0]({
            id: 88, url: "http://example.com/interrupt.zip", filename: "interrupt.zip",
            bytesReceived: 0, fileSize: 500, mime: "application/zip", startTime: new Date().toISOString(),
            danger: "safe", exists: true, paused: false, canResume: true, state: "in_progress",
        });
        const changedListeners = (browser as any)._internal.downloadsChangedListeners;
        changedListeners[0]({ id: 88, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" } });
        const task = dm.queryTasks()[0];
        expect(task.status).toBe("error");
        expect(task.error).toBe("NETWORK_FAILED");
    });

    it("destroy cancels active downloads and cleans up", async () => {
        const t1 = await dm.create({ url: "http://example.com/d1.zip" });
        // Simulate download match so browserDownloadId is set
        const listeners = (browser as any)._internal.downloadsCreatedListeners;
        listeners[0]({
            id: 55, url: "http://example.com/d1.zip", filename: "d1.zip",
            bytesReceived: 0, fileSize: 100, mime: "application/zip",
            startTime: new Date().toISOString(), danger: "safe",
            exists: true, paused: false, canResume: true, state: "in_progress",
        });
        await dm.destroy();
        expect(browser.downloads.cancel).toHaveBeenCalled();
    });
});
