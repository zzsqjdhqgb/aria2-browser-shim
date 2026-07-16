import { type AppSettings, DEFAULT_SETTINGS, type StoredTask, type DownloadTask } from "./types";

const SETTINGS_KEY = "settings";
const TASKS_KEY = "tasks";
const SESSION_KEY = "sessionId";

// =============================================================================
// Settings persistence
// =============================================================================

export async function loadSettings(): Promise<AppSettings> {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<AppSettings> | undefined) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function isEnabled(): Promise<boolean> {
    const settings = await loadSettings();
    return settings.enabled;
}

export async function setEnabled(enabled: boolean): Promise<void> {
    const settings = await loadSettings();
    settings.enabled = enabled;
    await saveSettings(settings);
}

// =============================================================================
// Task persistence (survives SW restarts)
// =============================================================================

export async function saveTasksSnapshot(
    tasks: Map<string, DownloadTask>,
    maxHistory: number = 500,
): Promise<void> {
    const stored: StoredTask[] = [];
    for (const task of tasks.values()) {
        stored.push({
            id: task.id,
            url: task.url,
            browserDownloadId: task.browserDownloadId,
            filename: task.request.filename ?? "",
            directory: task.request.directory ?? "",
            status: task.status,
            bytesReceived: task.bytesReceived,
            totalBytes: task.totalBytes,
            error: task.error,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
        });
    }
    stored.sort((a, b) => b.createdAt - a.createdAt);
    await browser.storage.local.set({ [TASKS_KEY]: stored.slice(0, maxHistory) });
}

export async function loadTasksSnapshot(): Promise<StoredTask[]> {
    const result = await browser.storage.local.get(TASKS_KEY);
    return (result[TASKS_KEY] as StoredTask[] | undefined) ?? [];
}

// =============================================================================
// Session ID persistence
// =============================================================================

export async function loadSessionId(): Promise<string | null> {
    const result = await browser.storage.local.get(SESSION_KEY);
    return (result[SESSION_KEY] as string | undefined) ?? null;
}

export async function saveSessionId(sid: string): Promise<void> {
    await browser.storage.local.set({ [SESSION_KEY]: sid });
}

// =============================================================================
// Change watcher
// =============================================================================

export type SettingsChangeHandler = (settings: AppSettings) => void;

const changeHandlers = new Set<SettingsChangeHandler>();

export function onSettingsChange(handler: SettingsChangeHandler): () => void {
    changeHandlers.add(handler);
    return () => changeHandlers.delete(handler);
}

browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    const settings: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...(changes[SETTINGS_KEY].newValue as Partial<AppSettings> | undefined),
    };
    for (const h of changeHandlers) {
        try { h(settings); } catch { /* swallow */ }
    }
});
