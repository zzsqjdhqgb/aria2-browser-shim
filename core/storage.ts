import { type AppSettings, DEFAULT_SETTINGS } from "./types";

const SETTINGS_KEY = "settings";

// =============================================================================
// Settings persistence
// =============================================================================

export async function loadSettings(): Promise<AppSettings> {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    if (result[SETTINGS_KEY]) {
        return { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
    }
    return { ...DEFAULT_SETTINGS };
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
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as AppSettings) };
    for (const h of changeHandlers) {
        try { h(settings); } catch { /* swallow */ }
    }
});
