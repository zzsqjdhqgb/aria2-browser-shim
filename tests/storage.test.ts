import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    loadSettings, saveSettings, isEnabled, setEnabled,
    loadSessionId, saveSessionId,
    saveTasksSnapshot, loadTasksSnapshot,
    onSettingsChange,
} from "@/core/storage";
import { DEFAULT_SETTINGS, type DownloadTask, type InternalStatus } from "@/core/types";

// Helper: create a minimal DownloadTask-like object for snapshot tests
function makeTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
    return {
        id: "abcd1234",
        url: "http://example.com/file.zip",
        started: false,
        browserDownloadId: undefined,
        request: { url: "http://example.com/file.zip", filename: "file.zip", directory: "sub" },
        status: "complete" as InternalStatus,
        bytesReceived: 1024,
        totalBytes: 2048,
        speed: 0,
        createdAt: Date.now(),
        ...overrides,
    };
}

describe("Settings persistence", () => {
    it("loadSettings returns defaults when storage is empty", async () => {
        const s = await loadSettings();
        expect(s).toEqual(DEFAULT_SETTINGS);
    });

    it("saveSettings persists and loadSettings returns merged result", async () => {
        await saveSettings({ ...DEFAULT_SETTINGS, enabled: false, defaultDir: "/dl" });
        const s = await loadSettings();
        expect(s.enabled).toBe(false);
        expect(s.defaultDir).toBe("/dl");
        // Fields not set remain at defaults
        expect(s.rpcSecret).toBe(DEFAULT_SETTINGS.rpcSecret);
    });

    it("isEnabled reads from stored settings", async () => {
        await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
        expect(await isEnabled()).toBe(false);

        await saveSettings({ ...DEFAULT_SETTINGS, enabled: true });
        expect(await isEnabled()).toBe(true);
    });

    it("setEnabled updates only the enabled flag", async () => {
        await saveSettings({ ...DEFAULT_SETTINGS, defaultDir: "/keep" });
        await setEnabled(false);
        const s = await loadSettings();
        expect(s.enabled).toBe(false);
        expect(s.defaultDir).toBe("/keep");
    });
});

describe("Session ID persistence", () => {
    it("loadSessionId returns null when not set", async () => {
        expect(await loadSessionId()).toBeNull();
    });

    it("saveSessionId persists and loadSessionId retrieves", async () => {
        await saveSessionId("deadbeef");
        expect(await loadSessionId()).toBe("deadbeef");
    });

    it("saveSessionId overwrites previous value", async () => {
        await saveSessionId("aaa");
        await saveSessionId("bbb");
        expect(await loadSessionId()).toBe("bbb");
    });
});

describe("Task snapshot persistence", () => {
    it("loadTasksSnapshot returns empty array when nothing stored", async () => {
        expect(await loadTasksSnapshot()).toEqual([]);
    });

    it("saveTasksSnapshot persists and loadTasksSnapshot restores", async () => {
        const tasks = new Map<string, DownloadTask>();
        tasks.set("t1", makeTask({ id: "t1", url: "http://a.com/z" }));
        tasks.set("t2", makeTask({ id: "t2", status: "in_progress", browserDownloadId: 42 }));
        await saveTasksSnapshot(tasks);

        const loaded = await loadTasksSnapshot();
        expect(loaded).toHaveLength(2);

        const t1 = loaded.find((t) => t.id === "t1")!;
        expect(t1.url).toBe("http://a.com/z");
        expect(t1.status).toBe("complete");
        expect(t1.filename).toBe("file.zip");
        expect(t1.directory).toBe("sub");

        const t2 = loaded.find((t) => t.id === "t2")!;
        expect(t2.status).toBe("in_progress");
        expect(t2.browserDownloadId).toBe(42);
    });

    it("saveTasksSnapshot respects maxHistory limit", async () => {
        const tasks = new Map<string, DownloadTask>();
        for (let i = 0; i < 10; i++) {
            tasks.set(`t${i}`, makeTask({ id: `t${i}`, createdAt: Date.now() - i * 1000 }));
        }
        await saveTasksSnapshot(tasks, 3);
        const loaded = await loadTasksSnapshot();
        // Should keep the 3 most recent (highest createdAt)
        expect(loaded).toHaveLength(3);
        expect(loaded[0].id).toBe("t0"); // most recent
        expect(loaded[1].id).toBe("t1");
        expect(loaded[2].id).toBe("t2");
    });
});

describe("onSettingsChange", () => {
    it("calls listeners when storage changes", async () => {
        const handler = vi.fn();
        const unsub = onSettingsChange(handler);

        // Simulate a storage change event
        const listeners = (browser as any)._internal.onChangedListeners;
        expect(listeners.length).toBeGreaterThan(0);

        listeners[0]({ settings: { newValue: { ...DEFAULT_SETTINGS, enabled: false } } }, "local");

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));

        unsub();

        // After unsubscribe, should not be called again
        listeners[0]({ settings: { newValue: { ...DEFAULT_SETTINGS, enabled: true } } }, "local");
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
