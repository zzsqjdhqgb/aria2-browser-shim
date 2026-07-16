import { vi, beforeEach } from "vitest";

function createBrowserMock() {
    const storageData = new Map<string, unknown>();
    const onChangedListeners: Array<(...args: unknown[]) => void> = [];
    const downloadsCreatedListeners: Array<(...args: unknown[]) => void> = [];
    const downloadsChangedListeners: Array<(...args: unknown[]) => void> = [];
    const runtimeMessageListeners: Array<(...args: unknown[]) => void> = [];

    return {
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const result: Record<string, unknown> = {};
                    let keyList: string[];
                    if (keys === null || keys === undefined) { keyList = [...storageData.keys()]; }
                    else if (typeof keys === "string") { keyList = [keys]; }
                    else if (Array.isArray(keys)) { keyList = keys; }
                    else { keyList = Object.keys(keys); }
                    for (const key of keyList) { if (storageData.has(key)) result[key] = storageData.get(key); }
                    return result;
                }),
                set: vi.fn(async (items) => { for (const [k, v] of Object.entries(items)) storageData.set(k, v); }),
                remove: vi.fn(async (keys) => { for (const k of (typeof keys === "string" ? [keys] : keys)) storageData.delete(k); }),
            },
            onChanged: {
                addListener: vi.fn((fn) => { onChangedListeners.push(fn); }),
                removeListener: vi.fn(),
            },
        },
        downloads: {
            onCreated: { addListener: vi.fn((fn) => { downloadsCreatedListeners.push(fn); }) },
            onChanged: { addListener: vi.fn((fn) => { downloadsChangedListeners.push(fn); }) },
            pause: vi.fn(() => Promise.resolve()),
            resume: vi.fn(() => Promise.resolve()),
            cancel: vi.fn(() => Promise.resolve()),
            search: vi.fn(() => Promise.resolve([])),
        },
        tabs: {
            create: vi.fn((opts) => Promise.resolve({ id: 999, ...(opts as object) })),
            remove: vi.fn(() => Promise.resolve()),
        },
        declarativeNetRequest: {
            HeaderOperation: { SET: "set" as const },
            RuleActionType: { MODIFY_HEADERS: "modifyHeaders" as const },
            ResourceType: { MAIN_FRAME: "main_frame" as const },
            updateSessionRules: vi.fn(() => Promise.resolve()),
        },
        runtime: {
            sendMessage: vi.fn(() => Promise.resolve()),
            onMessage: { addListener: vi.fn((fn) => { runtimeMessageListeners.push(fn); }) },
        },
        _internal: { storageData, onChangedListeners, downloadsCreatedListeners, downloadsChangedListeners, runtimeMessageListeners },
    };
}

// Initial mock - module-level imports register listeners on this
const initMock = createBrowserMock();
(globalThis as any).browser = initMock;
(globalThis as any).Browser = {};
(globalThis as any).__initMock = initMock;

// Fresh mock per test, preserving module-level listeners from initMock
beforeEach(() => {
    const saved = (globalThis as any).__initMock._internal;
    const mock = createBrowserMock();
    if (saved) {
        mock._internal.onChangedListeners = [...saved.onChangedListeners];
        mock._internal.downloadsCreatedListeners = [...saved.downloadsCreatedListeners];
        mock._internal.downloadsChangedListeners = [...saved.downloadsChangedListeners];
    }
    (globalThis as any).browser = mock;
    (globalThis as any).Browser = {};
});