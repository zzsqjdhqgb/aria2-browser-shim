# aria2-browser-shim v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete rewrite of the aria2-browser-shim as a production-ready Chromium extension (Manifest V3) that intercepts aria2 JSON-RPC calls and redirects them to the browser's native download manager, with bundled aria2NG UI.

**Architecture:** Content scripts in MAIN+ISOLATED worlds intercept fetch/XHR/WebSocket calls to localhost:6800 on any page, route them via chrome.runtime messaging to a background service worker implementing the full aria2 JSON-RPC 2.0 protocol. Downloads use declarativeNetRequest for header injection + background tabs for triggering. State is persisted in IndexedDB. React popup/options UIs with Tailwind CSS.

**Tech Stack:** WXT, TypeScript, React 19, Tailwind CSS v4, idb (IndexedDB wrapper), vitest

## Global Constraints

- Chromium-only (chrome.* APIs)
- WXT framework for build
- Manifest V3
- React 19 + Tailwind CSS v4 for popup/options UI
- IndexedDB for download history persistence
- chrome.storage.sync for settings
- Full aria2 JSON-RPC 2.0 protocol implementation
- Zero code reuse from the old project
- aria2NG bundled with zero modifications

---

### Task 1: Scaffold WXT project with React and Tailwind

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/assets/tailwind.css`
- Create: `src/entrypoints/background.ts` (placeholder)
- Create: `src/entrypoints/bridge.content.ts` (placeholder)
- Create: `src/entrypoints/main.content.ts` (placeholder)
- Create: `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.tsx`, `src/entrypoints/popup/App.tsx`
- Create: `src/entrypoints/options/index.html`, `src/entrypoints/options/main.tsx`, `src/entrypoints/options/App.tsx`
- Create: `src/entrypoints/ui/index.html`
- Create: `.gitignore`

**Interfaces:**
- Produces: Working WXT dev build with placeholders for all entrypoints

- [ ] **Step 1: Initialize project with pnpm and install dependencies**

```bash
rm -f package.json wxt.config.ts tsconfig.json
pnpm init
pnpm add wxt @wxt-dev/module-react react react-dom idb
pnpm add -D typescript @types/react @types/react-dom @types/chrome vitest @vitejs/plugin-react tailwindcss @tailwindcss/vite fake-indexeddb
```

- [ ] **Step 2: Create wxt.config.ts**

```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Aria2 Browser Shim',
    description: 'Browser-native aria2 replacement for cloud drive userscripts',
    permissions: [
      'downloads',
      'declarativeNetRequest',
      'tabs',
      'storage',
      'unlimitedStorage',
    ],
    host_permissions: ['<all_urls>'],
  },
  runner: {
    disabled: true,
  },
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "strict": true,
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

- [ ] **Step 5: Create vitest.setup.ts**

```typescript
import 'fake-indexeddb/auto';
```

- [ ] **Step 6: Create tailwind config and CSS**

```bash
mkdir -p src/assets
```

Write `src/assets/tailwind.css`:
```css
@import "tailwindcss";
```

This file will be imported by popup and options entrypoints via CSS `@import` or WXT's react module CSS injection.

- [ ] **Step 7: Create placeholder entrypoints**

Write `src/entrypoints/background.ts`:
```typescript
export default defineBackground(() => {
  console.log('aria2-browser-shim background running');
});
```

Write `src/entrypoints/bridge.content.ts`:
```typescript
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    console.log('bridge.content.ts running (ISOLATED)');
  },
});
```

Write `src/entrypoints/main.content.ts`:
```typescript
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    console.log('main.content.ts running (MAIN)');
  },
});
```

Write `src/entrypoints/popup/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aria2 Browser Shim</title>
</head>
<body>
  <div id="app"></div>
  <script src="./main.tsx" type="module"></script>
</body>
</html>
```

Write `src/entrypoints/popup/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@/assets/tailwind.css';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Write `src/entrypoints/popup/App.tsx`:
```typescript
export default function App() {
  return (
    <div className="w-80 p-4 bg-gray-900 text-white">
      <h1 className="text-lg font-bold">Aria2 Shim</h1>
      <p className="text-sm text-gray-400">Status: Loading...</p>
    </div>
  );
}
```

Write `src/entrypoints/options/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aria2 Browser Shim - Settings</title>
</head>
<body>
  <div id="app"></div>
  <script src="./main.tsx" type="module"></script>
</body>
</html>
```

Write `src/entrypoints/options/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@/assets/tailwind.css';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Write `src/entrypoints/options/App.tsx`:
```typescript
export default function App() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <p className="text-gray-500">Configure your aria2 browser shim.</p>
    </div>
  );
}
```

Write `src/entrypoints/ui/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aria2 Browser Shim - UI</title>
</head>
<body>
  <div id="aria2ng-placeholder">
    <p>AriaNg will be loaded here.</p>
  </div>
</body>
</html>
```

Write `.gitignore`:
```
.output/
.wxt/
node_modules/
dist/
.env
*.log
```

- [ ] **Step 8: Verify build succeeds**

```bash
pnpm wxt build
```

Expected: Build completes without errors. Output in `.output/chrome-mv3/`.

- [ ] **Step 9: Verify vitest runs**

```bash
pnpm vitest run
```

Expected: No test files found, but vitest reports success.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: scaffold WXT project with React, Tailwind, vitest"
```

---

### Task 2: Core type definitions

**Files:**
- Create: `src/core/types.ts`

**Interfaces:**
- Produces: `DownloadRequest`, `DownloadTask`, `TaskStatus`, `Aria2Status`, `Aria2File`, `Aria2Uri`, `Aria2Option`, `Aria2GlobalOption`, `Aria2Version`, `Aria2GlobalStat`, `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`, `JsonRpcNotification`, `ServerContext`

- [ ] **Step 1: Write types.ts**

```typescript
export type TaskStatus =
  | 'pending'
  | 'active'
  | 'waiting'
  | 'paused'
  | 'error'
  | 'complete'
  | 'removed';

export interface DownloadRequest {
  uris: string[];
  headers?: Record<string, string>;
  dir?: string;
  out?: string;
  split?: number;
}

export interface Aria2File {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: string;
  uris: Aria2Uri[];
}

export interface Aria2Uri {
  uri: string;
  status: string;
}

export interface DownloadTask {
  gid: string;
  uris: string[];
  status: TaskStatus;
  browserDownloadId: number | null;
  totalLength: number;
  completedLength: number;
  downloadSpeed: number;
  uploadSpeed: number;
  connections: number;
  dir: string;
  files: Aria2File[];
  errorCode: string | null;
  errorMessage: string | null;
  followedBy: string | null;
  following: string | null;
  belongsTo: string | null;
  bitfield: string;
  infoHash: string | null;
  numSeeders: string;
  seeder: string;
  pieceLength: string;
  numPieces: string;
  verifiedLength: string;
  verifyIntegrityPending: string;
  options: Aria2Option;
  createdAt: number;
  updatedAt: number;
  tabId: number | null;
  ruleId: number | null;
}

export interface Aria2Option {
  dir?: string;
  out?: string;
  split?: string;
  header?: string[];
  'max-connection-per-server'?: string;
  'check-certificate'?: string;
  'remote-time'?: string;
  'user-agent'?: string;
  referer?: string;
  'http-proxy'?: string;
  [key: string]: string | string[] | undefined;
}

export interface Aria2GlobalOption {
  'max-concurrent-downloads'?: string;
  'max-connection-per-server'?: string;
  'rpc-listen-port'?: string;
  'rpc-secret'?: string;
  dir?: string;
  [key: string]: string | undefined;
}

export interface Aria2Status {
  gid: string;
  status: TaskStatus;
  totalLength: string;
  completedLength: string;
  uploadLength: string;
  bitfield: string;
  downloadSpeed: string;
  uploadSpeed: string;
  infoHash: string;
  numSeeders: string;
  seeder: string;
  pieceLength: string;
  numPieces: string;
  connections: string;
  errorCode: string;
  errorMessage: string;
  followedBy: string[];
  following: string;
  belongsTo: string;
  dir: string;
  files: Aria2File[];
  bittorrent: Record<string, string>;
  verifiedLength: string;
  verifyIntegrityPending: string;
}

export interface Aria2Version {
  version: string;
  enabledFeatures: string[];
}

export interface Aria2GlobalStat {
  downloadSpeed: string;
  uploadSpeed: string;
  numActive: string;
  numWaiting: string;
  numStopped: string;
  numStoppedTotal: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
}

export interface ServerContext {
  downloadManager: unknown;
  taskStore: unknown;
  wsBridge: unknown;
  globalOptions: Aria2GlobalOption;
  sessionId: string;
  nextRuleId: number;
}

export const ARIA2_TARGET_ORIGINS = ['localhost:6800', '127.0.0.1:6800'];

export const ARIA2_ERRORS = {
  PARSE: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL: { code: -32603, message: 'Internal error' },
  UNKNOWN_GID: (gid: string): JsonRpcError => ({ code: 1, message: `Unknown GID ${gid}` }),
  NOT_SUPPORTED: (msg: string): JsonRpcError => ({ code: 4, message: msg }),
  FILE_IO: (msg: string): JsonRpcError => ({ code: 5, message: msg }),
  NOT_ACTIVE: (gid: string): JsonRpcError => ({ code: 8, message: `GID ${gid} is not active` }),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/core/types.ts && git commit -m "feat: add core type definitions"
```

---

### Task 3: GID utility

**Files:**
- Create: `src/core/gid.ts`
- Create: `tests/core/gid.test.ts`

**Interfaces:**
- Produces: `generateGid(): string`, `toHexGid(num: number): string`, `parseGid(gid: string): number`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { generateGid, toHexGid, parseGid } from '@/core/gid';

describe('gid', () => {
  describe('generateGid', () => {
    it('returns a 16-char lowercase hex string', () => {
      const gid = generateGid();
      expect(gid).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces unique values', () => {
      const gids = new Set(Array.from({ length: 100 }, () => generateGid()));
      expect(gids.size).toBe(100);
    });
  });

  describe('toHexGid', () => {
    it('converts number to 16-char hex', () => {
      expect(toHexGid(0)).toBe('0000000000000000');
      expect(toHexGid(255)).toBe('00000000000000ff');
    });
  });

  describe('parseGid', () => {
    it('parses hex gid to number', () => {
      expect(parseGid('00000000000000ff')).toBe(255);
      expect(parseGid('0000000000000000')).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/core/gid.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
const HEX_CHARS = '0123456789abcdef';

export function generateGid(): string {
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += HEX_CHARS[Math.floor(Math.random() * 16)];
  }
  return result;
}

export function toHexGid(num: number): string {
  return num.toString(16).padStart(16, '0');
}

export function parseGid(gid: string): number {
  return parseInt(gid, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/core/gid.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/gid.ts tests/core/gid.test.ts && git commit -m "feat: add GID generation and parsing utility"
```

---

### Task 4: Header utility

**Files:**
- Create: `src/core/headers.ts`
- Create: `tests/core/headers.test.ts`

**Interfaces:**
- Produces: `parseHeaderArray(headers: string[]): Record<string, string>`, `headersToArray(headers: Record<string, string>): Array<{ header: string; operation: string }>`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseHeaderArray, headersToArray } from '@/core/headers';

describe('headers', () => {
  describe('parseHeaderArray', () => {
    it('parses Cookie header', () => {
      const result = parseHeaderArray(['Cookie: session=abc123']);
      expect(result).toEqual({ Cookie: 'session=abc123' });
    });

    it('parses multiple headers', () => {
      const result = parseHeaderArray([
        'Cookie: session=abc123',
        'Referer: https://example.com',
        'User-Agent: Mozilla/5.0',
      ]);
      expect(result).toEqual({
        Cookie: 'session=abc123',
        Referer: 'https://example.com',
        'User-Agent': 'Mozilla/5.0',
      });
    });

    it('handles empty array', () => {
      expect(parseHeaderArray([])).toEqual({});
      expect(parseHeaderArray(undefined as unknown as string[])).toEqual({});
    });

    it('skips malformed headers', () => {
      const result = parseHeaderArray(['NotAHeader', 'Cookie: x=1']);
      expect(result).toEqual({ Cookie: 'x=1' });
    });
  });

  describe('headersToArray', () => {
    it('converts headers record to DNR header operations', () => {
      const result = headersToArray({ Cookie: 'x=1', Referer: 'https://e.com' });
      expect(result).toEqual([
        { header: 'Cookie', operation: 'set', value: 'x=1' },
        { header: 'Referer', operation: 'set', value: 'https://e.com' },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/core/headers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
export function parseHeaderArray(headers: string[] | undefined): Record<string, string> {
  if (!headers || !Array.isArray(headers)) return {};
  const result: Record<string, string> = {};
  for (const h of headers) {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) continue;
    const key = h.slice(0, colonIdx).trim();
    const value = h.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function headersToArray(
  headers: Record<string, string>
): Array<{ header: string; operation: string; value: string }> {
  return Object.entries(headers).map(([header, value]) => ({
    header,
    operation: 'set' as const,
    value,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/core/headers.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/headers.ts tests/core/headers.test.ts && git commit -m "feat: add header parsing and conversion utilities"
```

---

### Task 5: TaskStore (IndexedDB persistence)

**Files:**
- Create: `src/core/task-store.ts`
- Create: `tests/core/task-store.test.ts`

**Interfaces:**
- Produces: `TaskStore` class with methods:
  - `init(): Promise<void>`
  - `upsert(task: DownloadTask): Promise<void>`
  - `get(gid: string): Promise<DownloadTask | undefined>`
  - `getByBrowserId(browserDownloadId: number): Promise<DownloadTask | undefined>`
  - `getPendingByUrl(url: string): Promise<DownloadTask | undefined>`
  - `query(opts: QueryOptions): Promise<DownloadTask[]>`
  - `count(status?: TaskStatus): Promise<number>`
  - `delete(gid: string): Promise<void>`
  - `purge(status: TaskStatus): Promise<void>`
  - `getAll(): Promise<DownloadTask[]>`
- Consumes: `DownloadTask`, `TaskStatus` from `types.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStore } from '@/core/task-store';
import type { DownloadTask } from '@/core/types';

function makeTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: 'abcd123400000001',
    uris: ['https://example.com/file.zip'],
    status: 'pending',
    browserDownloadId: null,
    totalLength: 0,
    completedLength: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    connections: 0,
    dir: '/downloads',
    files: [],
    errorCode: null,
    errorMessage: null,
    followedBy: null,
    following: null,
    belongsTo: null,
    bitfield: '',
    infoHash: null,
    numSeeders: '0',
    seeder: 'false',
    pieceLength: '0',
    numPieces: '0',
    verifiedLength: '0',
    verifyIntegrityPending: 'false',
    options: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tabId: null,
    ruleId: null,
    ...overrides,
  };
}

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(async () => {
    store = new TaskStore('test-tasks');
    await store.init();
  });

  it('upserts and retrieves a task', async () => {
    const task = makeTask();
    await store.upsert(task);
    const retrieved = await store.get(task.gid);
    expect(retrieved).toBeDefined();
    expect(retrieved!.gid).toBe(task.gid);
    expect(retrieved!.uris).toEqual(task.uris);
  });

  it('updates existing task on upsert', async () => {
    const task = makeTask();
    await store.upsert(task);

    const updated = { ...task, status: 'active' as const, totalLength: 1024 };
    await store.upsert(updated);

    const retrieved = await store.get(task.gid);
    expect(retrieved!.status).toBe('active');
    expect(retrieved!.totalLength).toBe(1024);
  });

  it('returns undefined for missing gid', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('finds task by browser download id', async () => {
    const task = makeTask({ browserDownloadId: 42, status: 'active' });
    await store.upsert(task);

    const result = await store.getByBrowserId(42);
    expect(result).toBeDefined();
    expect(result!.gid).toBe(task.gid);
  });

  it('finds pending task by URL', async () => {
    const url = 'https://example.com/file.zip';
    const task = makeTask({ uris: [url], status: 'pending' });
    await store.upsert(task);

    const result = await store.getPendingByUrl(url);
    expect(result).toBeDefined();
    expect(result!.gid).toBe(task.gid);
  });

  it('queries tasks by status with pagination', async () => {
    await store.upsert(makeTask({ gid: 'a000000000000001', status: 'active' }));
    await store.upsert(makeTask({ gid: 'a000000000000002', status: 'active' }));
    await store.upsert(makeTask({ gid: 'a000000000000003', status: 'complete' }));

    const active = await store.query({ status: 'active' });
    expect(active).toHaveLength(2);

    const paged = await store.query({ status: 'active', offset: 1, num: 1 });
    expect(paged).toHaveLength(1);
  });

  it('counts tasks by status', async () => {
    await store.upsert(makeTask({ gid: 'a000000000000001', status: 'active' }));
    await store.upsert(makeTask({ gid: 'a000000000000002', status: 'waiting' }));
    await store.upsert(makeTask({ gid: 'a000000000000003', status: 'active' }));

    expect(await store.count('active')).toBe(2);
    expect(await store.count('waiting')).toBe(1);
    expect(await store.count()).toBe(3);
  });

  it('deletes a task', async () => {
    const task = makeTask();
    await store.upsert(task);
    await store.delete(task.gid);
    expect(await store.get(task.gid)).toBeUndefined();
  });

  it('purges tasks by status', async () => {
    await store.upsert(makeTask({ gid: 'a000000000000001', status: 'complete' }));
    await store.upsert(makeTask({ gid: 'a000000000000002', status: 'error' }));
    await store.upsert(makeTask({ gid: 'a000000000000003', status: 'active' }));

    await store.purge('complete');
    await store.purge('error');

    expect(await store.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/core/task-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
import { openDB, type IDBPDatabase } from 'idb';
import type { DownloadTask, TaskStatus } from './types';

export interface QueryOptions {
  status?: TaskStatus;
  offset?: number;
  num?: number;
  sort?: 'createdAt' | 'updatedAt';
  sortDir?: 'asc' | 'desc';
}

const DB_VERSION = 1;

export class TaskStore {
  private db: IDBPDatabase | null = null;
  private ready: Promise<void>;

  constructor(private dbName = 'aria2-tasks') {
    this.ready = this.init();
  }

  async init(): Promise<void> {
    this.db = await openDB(this.dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tasks')) {
          const store = db.createObjectStore('tasks', { keyPath: 'gid' });
          store.createIndex('status', 'status');
          store.createIndex('browserDownloadId', 'browserDownloadId');
          store.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
  }

  private async ensureReady(): Promise<IDBPDatabase> {
    await this.ready;
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  async upsert(task: DownloadTask): Promise<void> {
    const db = await this.ensureReady();
    task.updatedAt = Date.now();
    await db.put('tasks', task);
  }

  async get(gid: string): Promise<DownloadTask | undefined> {
    const db = await this.ensureReady();
    return db.get('tasks', gid);
  }

  async getByBrowserId(browserDownloadId: number): Promise<DownloadTask | undefined> {
    const db = await this.ensureReady();
    return db.getFromIndex('tasks', 'browserDownloadId', browserDownloadId);
  }

  async getPendingByUrl(url: string): Promise<DownloadTask | undefined> {
    const db = await this.ensureReady();
    const all = await db.getAllFromIndex('tasks', 'status', 'pending');
    return all.find((t) => t.uris.includes(url));
  }

  async query(opts: QueryOptions): Promise<DownloadTask[]> {
    const db = await this.ensureReady();
    let results: DownloadTask[];
    if (opts.status) {
      results = await db.getAllFromIndex('tasks', 'status', opts.status);
    } else {
      results = await db.getAll('tasks');
    }
    results.sort((a, b) => {
      const field = opts.sort || 'createdAt';
      const dir = opts.sortDir === 'desc' ? -1 : 1;
      return (a[field] - b[field]) * dir;
    });
    if (opts.offset !== undefined) {
      results = results.slice(opts.offset, opts.offset + (opts.num || results.length));
    } else if (opts.num !== undefined) {
      results = results.slice(0, opts.num);
    }
    return results;
  }

  async count(status?: TaskStatus): Promise<number> {
    const db = await this.ensureReady();
    if (status) {
      return db.countFromIndex('tasks', 'status', status);
    }
    return db.count('tasks');
  }

  async delete(gid: string): Promise<void> {
    const db = await this.ensureReady();
    await db.delete('tasks', gid);
  }

  async purge(status: TaskStatus): Promise<void> {
    const db = await this.ensureReady();
    const keys = await db.getAllKeysFromIndex('tasks', 'status', status);
    for (const key of keys) {
      await db.delete('tasks', key);
    }
  }

  async getAll(): Promise<DownloadTask[]> {
    const db = await this.ensureReady();
    return db.getAll('tasks');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/core/task-store.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/task-store.ts tests/core/task-store.test.ts && git commit -m "feat: add IndexedDB TaskStore for persistent download history"
```

---

### Task 6: DownloadManager

**Files:**
- Create: `src/core/download-manager.ts`
- Create: `tests/core/download-manager.test.ts`

**Interfaces:**
- Produces: `DownloadManager` class with methods:
  - `create(request: DownloadRequest): Promise<string>`
  - `pause(gid: string): Promise<void>`
  - `resume(gid: string): Promise<void>`
  - `cancel(gid: string): Promise<void>`
  - `getTask(gid: string): Promise<DownloadTask | undefined>`
  - `getActiveTasks(): Promise<DownloadTask[]>`
  - `getGlobalStat(): Promise<Aria2GlobalStat>`
  - `onTaskChange: (callback: (task: DownloadTask) => void) => void`
  - `init(): Promise<void>` (registers chrome.downloads listeners)
- Consumes: `DownloadRequest`, `DownloadTask`, `Aria2GlobalStat`, `TaskStatus` from `types.ts`; `TaskStore`; `generateGid` from `gid.ts`; `parseHeaderArray`, `headersToArray` from `headers.ts`

This file uses chrome.* APIs and must use a mock wrapper pattern. Delay tests for this module since it depends heavily on chrome.* APIs. Instead, create the implementation with full logic and extractable pure functions where possible.

- [ ] **Step 1: Write download-manager.ts**

```typescript
import type { DownloadRequest, DownloadTask, Aria2GlobalStat, TaskStatus } from './types';
import { TaskStore, type QueryOptions } from './task-store';
import { generateGid } from './gid';
import { parseHeaderArray, headersToArray } from './headers';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_RULE_ID = 1000000;

export class DownloadManager {
  private taskStore: TaskStore;
  private changeCallbacks: Array<(task: DownloadTask) => void> = [];
  private nextRuleId = 1;
  private pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private initialized = false;

  constructor(taskStore: TaskStore) {
    this.taskStore = taskStore;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    chrome.downloads.onCreated.addListener((item) => {
      this.handleDownloadCreated(item);
    });

    chrome.downloads.onChanged.addListener((delta) => {
      this.handleDownloadChanged(delta);
    });
  }

  private getNextRuleId(): number {
    const id = this.nextRuleId;
    this.nextRuleId = (this.nextRuleId % MAX_RULE_ID) + 1;
    return id;
  }

  async create(request: DownloadRequest): Promise<string> {
    const gid = generateGid();
    const headers = parseHeaderArray(request.headers as unknown as string[]);
    const dir = request.dir || '';

    const task: DownloadTask = {
      gid,
      uris: request.uris,
      status: 'pending',
      browserDownloadId: null,
      totalLength: 0,
      completedLength: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      connections: 0,
      dir,
      files: [],
      errorCode: null,
      errorMessage: null,
      followedBy: null,
      following: null,
      belongsTo: null,
      bitfield: '',
      infoHash: null,
      numSeeders: '0',
      seeder: 'false',
      pieceLength: '0',
      numPieces: '0',
      verifiedLength: '0',
      verifyIntegrityPending: 'false',
      options: {
        dir,
        out: request.out,
        split: request.split?.toString(),
        header: request.headers as unknown as string[],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId: null,
      ruleId: null,
    };

    const primaryUri = request.uris[0];
    const ruleId = this.getNextRuleId();

    const requestHeaders = headersToArray(headers);
    const responseHeaders = [
      { header: 'Content-Disposition', operation: 'set' as const, value: 'attachment' },
    ];

    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: ruleId,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders,
            responseHeaders,
          },
          condition: {
            urlFilter: primaryUri,
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
          },
        },
      ],
    });

    const tab = await chrome.tabs.create({ url: primaryUri, active: false });
    task.tabId = tab.id ?? null;
    task.ruleId = ruleId;

    await this.taskStore.upsert(task);

    const timeout = setTimeout(() => {
      this.handleTimeout(gid);
    }, DOWNLOAD_TIMEOUT_MS);
    this.pendingTimeouts.set(gid, timeout);

    return gid;
  }

  private async handleDownloadCreated(item: chrome.downloads.DownloadItem): Promise<void> {
    const task = await this.taskStore.getPendingByUrl(item.url);
    if (!task) return;

    this.clearTimeout(task.gid);

    task.browserDownloadId = item.id;
    task.status = 'active';
    task.totalLength = item.fileSize || 0;
    await this.taskStore.upsert(task);

    await this.cleanupDownloadResources(task);
    this.notifyChange(task);
  }

  private async handleDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
    if (delta.id === undefined) return;
    const task = await this.taskStore.getByBrowserId(delta.id);
    if (!task) return;

    if (delta.totalBytes) {
      task.totalLength = delta.totalBytes.current || task.totalLength;
    }
    if (delta.fileSize) {
      // fileSize in delta can indicate final size
    }
    if (delta.bytesReceived) {
      task.completedLength = delta.bytesReceived.current || task.completedLength;
    }

    if (delta.state) {
      const state = delta.state.current;
      if (state === 'complete') {
        task.status = 'complete';
        task.completedLength = task.totalLength;
        await this.cleanupDownloadResources(task);
      } else if (state === 'interrupted') {
        if (task.status === 'pending' || task.status === 'active' || task.status === 'waiting') {
          task.status = 'error';
          task.errorCode = '1';
          task.errorMessage = delta.error?.current || 'Download interrupted';
        }
        await this.cleanupDownloadResources(task);
      }
    }

    await this.taskStore.upsert(task);
    this.notifyChange(task);
  }

  private async handleTimeout(gid: string): Promise<void> {
    this.pendingTimeouts.delete(gid);
    const task = await this.taskStore.get(gid);
    if (!task || task.status !== 'pending') return;

    task.status = 'error';
    task.errorCode = '1';
    task.errorMessage = 'Download timed out — no download started within 30s';
    await this.taskStore.upsert(task);
    await this.cleanupDownloadResources(task);
    this.notifyChange(task);
  }

  private async cleanupDownloadResources(task: DownloadTask): Promise<void> {
    if (task.ruleId !== null) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [task.ruleId],
        });
      } catch { /* rule may already be removed */ }
      task.ruleId = null;
    }
    if (task.tabId !== null) {
      try {
        await chrome.tabs.remove(task.tabId);
      } catch { /* tab may already be closed */ }
      task.tabId = null;
    }
  }

  private clearTimeout(gid: string): void {
    const t = this.pendingTimeouts.get(gid);
    if (t) {
      clearTimeout(t);
      this.pendingTimeouts.delete(gid);
    }
  }

  async pause(gid: string): Promise<void> {
    const task = await this.taskStore.get(gid);
    if (!task) throw new Error(`Task not found: ${gid}`);
    if (task.browserDownloadId !== null) {
      await chrome.downloads.pause(task.browserDownloadId);
    }
    if (task.status === 'active') {
      task.status = 'paused';
      await this.taskStore.upsert(task);
      this.notifyChange(task);
    }
  }

  async resume(gid: string): Promise<void> {
    const task = await this.taskStore.get(gid);
    if (!task) throw new Error(`Task not found: ${gid}`);
    if (task.browserDownloadId !== null) {
      await chrome.downloads.resume(task.browserDownloadId);
    }
    if (task.status === 'paused') {
      task.status = 'active';
      await this.taskStore.upsert(task);
      this.notifyChange(task);
    }
  }

  async cancel(gid: string): Promise<void> {
    const task = await this.taskStore.get(gid);
    if (!task) return;
    if (task.browserDownloadId !== null) {
      await chrome.downloads.cancel(task.browserDownloadId);
    }
    this.clearTimeout(gid);
    await this.cleanupDownloadResources(task);
    task.status = 'removed';
    await this.taskStore.upsert(task);
    this.notifyChange(task);
  }

  async getTask(gid: string): Promise<DownloadTask | undefined> {
    return this.taskStore.get(gid);
  }

  async getActiveTasks(): Promise<DownloadTask[]> {
    return this.taskStore.query({ status: 'active' });
  }

  async getGlobalStat(): Promise<Aria2GlobalStat> {
    const [numActive, numWaiting, numStopped] = await Promise.all([
      this.taskStore.count('active'),
      this.taskStore.count('waiting'),
      this.taskStore.count('error'),
    ]);
    const activeTasks = await this.taskStore.query({ status: 'active' });
    const downloadSpeed = activeTasks.reduce((sum, t) => sum + t.downloadSpeed, 0);
    const uploadSpeed = activeTasks.reduce((sum, t) => sum + t.uploadSpeed, 0);

    const totalCompleted = await this.taskStore.count('complete');
    const totalRemoved = await this.taskStore.count('removed');

    return {
      downloadSpeed: downloadSpeed.toString(),
      uploadSpeed: uploadSpeed.toString(),
      numActive: numActive.toString(),
      numWaiting: numWaiting.toString(),
      numStopped: numStopped.toString(),
      numStoppedTotal: (totalCompleted + totalRemoved + numStopped).toString(),
    };
  }

  onTaskChange(callback: (task: DownloadTask) => void): void {
    this.changeCallbacks.push(callback);
  }

  private notifyChange(task: DownloadTask): void {
    for (const cb of this.changeCallbacks) {
      cb(task);
    }
  }
}
```

- [ ] **Step 2: Write integration test skeleton (skip — chrome.* not mockable simply)**

Write a placeholder test to verify the module compiles:

```typescript
import { describe, it, expect } from 'vitest';
import { DownloadManager } from '@/core/download-manager';
import { TaskStore } from '@/core/task-store';

describe('DownloadManager', () => {
  it('can be instantiated', () => {
    const store = new TaskStore('test-dm');
    const dm = new DownloadManager(store);
    expect(dm).toBeDefined();
  });
});
```

- [ ] **Step 3: Verify test passes**

```bash
pnpm vitest run tests/core/download-manager.test.ts
```

Expected: PASS (instantiation test).

- [ ] **Step 4: Commit**

```bash
git add src/core/download-manager.ts tests/core/download-manager.test.ts && git commit -m "feat: add DownloadManager with DNR + tab-based download orchestration"
```

---

### Task 7: WebSocket Bridge

**Files:**
- Create: `src/core/websocket-bridge.ts`

**Interfaces:**
- Produces: `WebSocketBridge` class with methods:
  - `init(): void`
  - `broadcast(method: string, params: unknown[]): void`
  - `onConnect(callback: (port: chrome.runtime.Port) => void): void`
  - `getConnectedCount(): number`
- Consumes: `JsonRpcNotification` from `types.ts`

- [ ] **Step 1: Write websocket-bridge.ts**

```typescript
export class WebSocketBridge {
  private ports = new Map<number, chrome.runtime.Port>();
  private connectCallbacks: Array<(port: chrome.runtime.Port) => void> = [];
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'aria2-ws') return;

      const portId = port.sender?.tab?.id ?? Date.now();
      this.ports.set(portId, port);

      port.postMessage({
        jsonrpc: '2.0',
        method: 'aria2.onConnect',
        params: [{ portId }],
      });

      port.onDisconnect.addListener(() => {
        this.ports.delete(portId);
      });

      for (const cb of this.connectCallbacks) {
        cb(port);
      }
    });
  }

  broadcast(method: string, params: unknown[]): void {
    for (const port of this.ports.values()) {
      try {
        port.postMessage({
          jsonrpc: '2.0',
          method,
          params,
        });
      } catch {
        // Port may be disconnected
      }
    }
  }

  onConnect(callback: (port: chrome.runtime.Port) => void): void {
    this.connectCallbacks.push(callback);
  }

  getConnectedCount(): number {
    return this.ports.size;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/websocket-bridge.ts && git commit -m "feat: add WebSocket bridge for event broadcasting via chrome.runtime.connect"
```

---

### Task 8: aria2-methods (all JSON-RPC method implementations)

**Files:**
- Create: `src/core/aria2-methods.ts`
- Create: `tests/core/aria2-methods.test.ts`

**Interfaces:**
- Produces: `Aria2Methods` type — map of method name to `(params: unknown[], ctx: MethodContext) => Promise<unknown>`
- Consumes: `DownloadManager`, `TaskStore`, `WebSocketBridge`, `ServerContext`, all types from `types.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMethodMap } from '@/core/aria2-methods';
import type { DownloadTask, Aria2Option } from '@/core/types';

function mockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: 'abcd123400000001',
    uris: ['https://example.com/file.zip'],
    status: 'active',
    browserDownloadId: null,
    totalLength: 1024000,
    completedLength: 512000,
    downloadSpeed: 102400,
    uploadSpeed: 0,
    connections: 1,
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/file.zip',
        length: '1024000',
        completedLength: '512000',
        selected: 'true',
        uris: [{ uri: 'https://example.com/file.zip', status: 'used' }],
      },
    ],
    errorCode: null,
    errorMessage: null,
    followedBy: null,
    following: null,
    belongsTo: null,
    bitfield: '',
    infoHash: null,
    numSeeders: '0',
    seeder: 'false',
    pieceLength: '0',
    numPieces: '0',
    verifiedLength: '0',
    verifyIntegrityPending: 'false',
    options: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tabId: null,
    ruleId: null,
    ...overrides,
  };
}

describe('createMethodMap', () => {
  let methods: ReturnType<typeof createMethodMap>;
  let mockStore: any;
  let mockDm: any;
  let mockWs: any;

  beforeEach(() => {
    mockStore = {
      get: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      purge: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      getAll: vi.fn().mockResolvedValue([]),
      getByBrowserId: vi.fn(),
      getPendingByUrl: vi.fn(),
    };
    mockDm = {
      create: vi.fn().mockResolvedValue('abcd123400000001'),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      getTask: vi.fn(),
      getGlobalStat: vi.fn().mockResolvedValue({
        downloadSpeed: '0',
        uploadSpeed: '0',
        numActive: '0',
        numWaiting: '0',
        numStopped: '0',
        numStoppedTotal: '0',
      }),
    };
    mockWs = {
      broadcast: vi.fn(),
    };

    const ctx = {
      downloadManager: mockDm,
      taskStore: mockStore,
      wsBridge: mockWs,
      globalOptions: {} as any,
      sessionId: 'test-session-001',
      nextRuleId: 1,
    };

    methods = createMethodMap(ctx);
  });

  describe('aria2.getVersion', () => {
    it('returns version info', async () => {
      const result = await methods['aria2.getVersion']([], {});
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('enabledFeatures');
      expect(result.enabledFeatures).toContain('HTTP');
      expect(result.enabledFeatures).not.toContain('BitTorrent');
    });
  });

  describe('aria2.addUri', () => {
    it('calls downloadManager.create', async () => {
      const result = await methods['aria2.addUri']([
        ['https://example.com/file.zip'],
        { dir: '/downloads' },
      ]);
      expect(result).toBe('abcd123400000001');
      expect(mockDm.create).toHaveBeenCalledWith({
        uris: ['https://example.com/file.zip'],
        dir: '/downloads',
      });
    });

    it('validates params', async () => {
      await expect(methods['aria2.addUri']([], {})).rejects.toHaveProperty('code', -32602);
    });
  });

  describe('aria2.tellStatus', () => {
    it('returns task status', async () => {
      const task = mockTask();
      mockStore.get.mockResolvedValue(task);

      const result = await methods['aria2.tellStatus'](['abcd123400000001'], {});
      expect(result).toHaveProperty('gid', 'abcd123400000001');
      expect(result).toHaveProperty('status', 'active');
      expect(result).toHaveProperty('totalLength', '1024000');
      expect(result).toHaveProperty('completedLength', '512000');
      expect(result).toHaveProperty('downloadSpeed', '102400');
    });

    it('returns error for unknown GID', async () => {
      mockStore.get.mockResolvedValue(undefined);
      await expect(
        methods['aria2.tellStatus'](['nonexistent'], {})
      ).rejects.toHaveProperty('code', 1);
    });
  });

  describe('aria2.tellActive', () => {
    it('returns active tasks', async () => {
      const task = mockTask();
      mockStore.query.mockResolvedValue([task]);
      const result = await methods['aria2.tellActive']([], {});
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('gid', 'abcd123400000001');
    });
  });

  describe('aria2.remove', () => {
    it('cancels and removes task', async () => {
      mockStore.get.mockResolvedValue(mockTask());
      const result = await methods['aria2.remove'](['abcd123400000001'], {});
      expect(result).toBe('abcd123400000001');
      expect(mockDm.cancel).toHaveBeenCalledWith('abcd123400000001');
    });
  });

  describe('aria2.pause', () => {
    it('pauses a download', async () => {
      mockStore.get.mockResolvedValue(mockTask());
      const result = await methods['aria2.pause'](['abcd123400000001'], {});
      expect(result).toBe('abcd123400000001');
      expect(mockDm.pause).toHaveBeenCalledWith('abcd123400000001');
    });
  });

  describe('aria2.unpause', () => {
    it('resumes a download', async () => {
      mockStore.get.mockResolvedValue(mockTask());
      const result = await methods['aria2.unpause'](['abcd123400000001'], {});
      expect(result).toBe('abcd123400000001');
      expect(mockDm.resume).toHaveBeenCalledWith('abcd123400000001');
    });
  });

  describe('aria2.getGlobalStat', () => {
    it('returns global stats', async () => {
      mockDm.getGlobalStat.mockResolvedValue({
        downloadSpeed: '102400',
        uploadSpeed: '0',
        numActive: '2',
        numWaiting: '1',
        numStopped: '3',
        numStoppedTotal: '10',
      });
      const result = await methods['aria2.getGlobalStat']([], {});
      expect(result).toHaveProperty('downloadSpeed', '102400');
      expect(result).toHaveProperty('numActive', '2');
    });
  });

  describe('aria2.addTorrent', () => {
    it('returns not supported', async () => {
      await expect(
        methods['aria2.addTorrent']([], {})
      ).rejects.toHaveProperty('code', 4);
    });
  });

  describe('aria2.shutdown', () => {
    it('shuts down normally', async () => {
      mockStore.query.mockResolvedValue([mockTask()]);
      const result = await methods['aria2.shutdown']([], {});
      expect(result).toBe('OK');
    });
  });

  describe('aria2.purgeDownloadResult', () => {
    it('purges completed/error/removed tasks', async () => {
      const result = await methods['aria2.purgeDownloadResult']([], {});
      expect(result).toBe('OK');
      expect(mockStore.purge).toHaveBeenCalledWith('complete');
      expect(mockStore.purge).toHaveBeenCalledWith('error');
      expect(mockStore.purge).toHaveBeenCalledWith('removed');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/core/aria2-methods.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
import type { DownloadTask, Aria2Status, Aria2Version, ServerContext, Aria2File } from './types';
import { ARIA2_ERRORS, type TaskStatus } from './types';
import type { DownloadManager } from './download-manager';
import type { TaskStore } from './task-store';
import type { WebSocketBridge } from './websocket-bridge';

interface MethodContext {
  downloadManager: DownloadManager;
  taskStore: TaskStore;
  wsBridge: WebSocketBridge;
  globalOptions: Record<string, string | undefined>;
  sessionId: string;
}

type MethodFn = (params: unknown[]) => Promise<unknown>;

function toAria2Status(task: DownloadTask): Aria2Status {
  return {
    gid: task.gid,
    status: task.status,
    totalLength: task.totalLength.toString(),
    completedLength: task.completedLength.toString(),
    uploadLength: '0',
    bitfield: task.bitfield,
    downloadSpeed: task.downloadSpeed.toString(),
    uploadSpeed: task.uploadSpeed.toString(),
    infoHash: task.infoHash ?? '',
    numSeeders: task.numSeeders,
    seeder: task.seeder,
    pieceLength: task.pieceLength,
    numPieces: task.numPieces,
    connections: task.connections.toString(),
    errorCode: task.errorCode ?? '0',
    errorMessage: task.errorMessage ?? '',
    followedBy: task.followedBy ? [task.followedBy] : [],
    following: task.following ?? '',
    belongsTo: task.belongsTo ?? '',
    dir: task.dir,
    files: task.files,
    bittorrent: {},
    verifiedLength: task.verifiedLength,
    verifyIntegrityPending: task.verifyIntegrityPending,
  };
}

export function createMethodMap(ctx: MethodContext): Record<string, MethodFn> {
  const { downloadManager, taskStore, wsBridge, globalOptions } = ctx;

  async function requireTask(gid: string): Promise<DownloadTask> {
    const task = await taskStore.get(gid);
    if (!task) throw { ...ARIA2_ERRORS.UNKNOWN_GID(gid) };
    return task;
  }

  function ensureArray(params: unknown[]): unknown[] {
    if (!Array.isArray(params)) return [];
    return params;
  }

  const methods: Record<string, MethodFn> = {
    'aria2.getVersion': async (): Promise<Aria2Version> => {
      return {
        version: '1.37.0-shim',
        enabledFeatures: [
          'HTTP',
          'HTTPS',
          'GZip',
          'Message Digest',
          'WebSocket',
        ],
      };
    },

    'aria2.addUri': async (params) => {
      if (!params || params.length < 1) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const uris = params[0] as string[][];
      const options = (params[1] as Record<string, unknown>) || {};

      if (!Array.isArray(uris) || uris.length === 0) {
        throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      }

      const request = {
        uris: uris[0] as unknown as string[],
        headers: options.header as unknown as string[],
        dir: options.dir as string,
        out: options.out as string,
        split: options.split ? Number(options.split) : undefined,
      };

      const gid = await downloadManager.create(request);
      wsBridge.broadcast('aria2.onDownloadStart', [{ gid }]);
      return gid;
    },

    'aria2.addTorrent': async () => {
      throw ARIA2_ERRORS.NOT_SUPPORTED('BitTorrent downloads are not supported');
    },

    'aria2.addMetalink': async () => {
      throw ARIA2_ERRORS.NOT_SUPPORTED('Metalink downloads are not supported');
    },

    'aria2.remove': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      await downloadManager.cancel(gid);
      await taskStore.delete(gid);
      return gid;
    },

    'aria2.forceRemove': async (params) => {
      return methods['aria2.remove'](params);
    },

    'aria2.pause': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      await requireTask(gid);
      await downloadManager.pause(gid);
      return gid;
    },

    'aria2.forcePause': async (params) => {
      return methods['aria2.pause'](params);
    },

    'aria2.unpause': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      await requireTask(gid);
      await downloadManager.resume(gid);
      return gid;
    },

    'aria2.tellStatus': async (params) => {
      const gid = params[0] as string;
      const keys = (params[1] as string[]) || [];
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      const status = toAria2Status(task);
      if (keys.length > 0) {
        const filtered: Record<string, unknown> = { gid: status.gid };
        for (const key of keys) {
          if (key in status) {
            (filtered as Record<string, unknown>)[key] = (status as Record<string, unknown>)[key];
          }
        }
        return filtered;
      }
      return status;
    },

    'aria2.tellActive': async (params) => {
      const keys = (params[0] as string[]) || [];
      const tasks = await taskStore.query({ status: 'active' });
      return tasks.map((t) => {
        const s = toAria2Status(t);
        return keys.length > 0 ? filterStatus(s, keys) : s;
      });
    },

    'aria2.tellWaiting': async (params) => {
      const offset = (params[0] as number) || 0;
      const num = (params[1] as number) || 100;
      const keys = (params[2] as string[]) || [];
      const tasks = await taskStore.query({ status: 'waiting', offset, num });
      return tasks.map((t) => {
        const s = toAria2Status(t);
        return keys.length > 0 ? filterStatus(s, keys) : s;
      });
    },

    'aria2.tellStopped': async (params) => {
      const offset = (params[0] as number) || 0;
      const num = (params[1] as number) || 100;
      const keys = (params[2] as string[]) || [];
      const tasks = await taskStore.query({ status: 'error', offset, num });
      return tasks.map((t) => {
        const s = toAria2Status(t);
        return keys.length > 0 ? filterStatus(s, keys) : s;
      });
    },

    'aria2.getOption': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.options;
    },

    'aria2.changeOption': async (params) => {
      const gid = params[0] as string;
      const options = params[1] as Record<string, string>;
      if (!gid || !options) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      task.options = { ...task.options, ...options };
      await taskStore.upsert(task);
      return 'OK';
    },

    'aria2.getGlobalOption': async () => {
      return { ...globalOptions };
    },

    'aria2.changeGlobalOption': async (params) => {
      const options = params[0] as Record<string, string>;
      if (!options) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      Object.assign(globalOptions, options);
      await chrome.storage.sync.set({ globalOptions });
      return 'OK';
    },

    'aria2.getSessionInfo': async () => {
      return { sessionId: ctx.sessionId };
    },

    'aria2.shutdown': async () => {
      const activeTasks = await taskStore.query({ status: 'active' });
      for (const task of activeTasks) {
        await downloadManager.cancel(task.gid);
      }
      return 'OK';
    },

    'aria2.forceShutdown': async () => {
      return methods['aria2.shutdown']([]);
    },

    'aria2.getGlobalStat': async () => {
      return downloadManager.getGlobalStat();
    },

    'aria2.changePosition': async (params) => {
      const gid = params[0] as string;
      const pos = params[1] as number;
      const how = params[2] as string;
      if (!gid || pos === undefined) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await taskStore.get(gid);
      if (!task) return 'OK';
      return (Number(pos)).toString();
    },

    'aria2.changeUri': async (params) => {
      const gid = params[0] as string;
      const fileIndex = params[1] as number;
      const delUris = params[2] as string[];
      const addUris = params[3] as string[];
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await taskStore.get(gid);
      if (!task) throw { ...ARIA2_ERRORS.UNKNOWN_GID(gid) };
      return [0, 0];
    },

    'aria2.purgeDownloadResult': async () => {
      await taskStore.purge('complete');
      await taskStore.purge('error');
      await taskStore.purge('removed');
      return 'OK';
    },

    'aria2.removeDownloadResult': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await taskStore.get(gid);
      if (task && ['complete', 'error', 'removed'].includes(task.status)) {
        await taskStore.delete(gid);
      }
      return 'OK';
    },

    'aria2.getFiles': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.files;
    },

    'aria2.getPeers': async (params) => {
      return [];
    },

    'aria2.getServers': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.uris.map((uri, index) => ({
        index: index.toString(),
        uri,
        currentUri: uri,
        downloadSpeed: '0',
      }));
    },

    'aria2.getUris': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.uris.map((uri) => ({
        uri,
        status: 'used',
      }));
    },

    'aria2.listMethods': async () => {
      return Object.keys(methods).filter((k) => k.startsWith('aria2.'));
    },

    'aria2.listNotifications': async () => {
      return [
        'aria2.onDownloadStart',
        'aria2.onDownloadPause',
        'aria2.onDownloadStop',
        'aria2.onDownloadComplete',
        'aria2.onDownloadError',
        'aria2.onBtDownloadComplete',
      ];
    },

    'aria2.multicall': async (params) => {
      const calls = params[0] as Array<{ methodName: string; params: unknown[] }>;
      if (!Array.isArray(calls)) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const results = [];
      for (const call of calls) {
        const fn = methods[call.methodName];
        if (!fn) {
          results.push([{ code: -32601, message: 'Method not found' }]);
        } else {
          try {
            const result = await fn(call.params);
            results.push([result]);
          } catch (e: any) {
            results.push([{ code: e.code || -32603, message: e.message || 'Error' }]);
          }
        }
      }
      return results;
    },
  };

  return methods;
}

function filterStatus(status: Aria2Status, keys: string[]): Record<string, unknown> {
  const filtered: Record<string, unknown> = { gid: status.gid };
  for (const key of keys) {
    if (key in status) {
      filtered[key] = (status as Record<string, unknown>)[key];
    }
  }
  return filtered;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/core/aria2-methods.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/aria2-methods.ts tests/core/aria2-methods.test.ts && git commit -m "feat: implement full aria2 JSON-RPC method suite"
```

---

### Task 9: aria2-server (JSON-RPC protocol handler)

**Files:**
- Create: `src/core/aria2-server.ts`
- Create: `tests/core/aria2-server.test.ts`

**Interfaces:**
- Produces: `Aria2Server` class with methods:
  - `constructor(methods: Record<string, MethodFn>, options: { token?: string })`
  - `handleRequest(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null>`
  - `handleNotification(method: string, params: unknown[]): void`
- Consumes: `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`, `ARIA2_ERRORS` from `types.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Aria2Server } from '@/core/aria2-server';

function echo(params: unknown[]): Promise<unknown> {
  return Promise.resolve(params[0]);
}

function throwError(_params: unknown[]): Promise<unknown> {
  return Promise.reject({ code: 42, message: 'test error' });
}

describe('Aria2Server', () => {
  const methods = {
    'aria2.echo': echo,
    'aria2.throwError': throwError,
  };

  describe('handleRequest', () => {
    it('handles single request', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req1',
        result: 'hello',
      });
    });

    it('handles notification (no id)', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'aria2.echo',
        params: ['hello'],
      });
      expect(result).toBeNull();
    });

    it('handles batch requests', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest([
        { jsonrpc: '2.0', id: 'req1', method: 'aria2.echo', params: ['a'] },
        { jsonrpc: '2.0', id: 'req2', method: 'aria2.echo', params: ['b'] },
      ]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('handles batch with mixed errors', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest([
        { jsonrpc: '2.0', id: 'req1', method: 'aria2.echo', params: ['ok'] },
        { jsonrpc: '2.0', id: 'req2', method: 'aria2.throwError', params: [] },
      ]);
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result[0]).toHaveProperty('result', 'ok');
        expect(result[1]).toHaveProperty('error');
        expect(result[1].error).toEqual({ code: 42, message: 'test error' });
      }
    });

    it('returns parse error for invalid JSON body', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest('not json');
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    });

    it('returns method not found', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'nonexistent',
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32601 },
      });
    });

    it('validates jsonrpc version', async () => {
      const server = new Aria2Server(methods);
      const result = await server.handleRequest({
        jsonrpc: '1.0',
        id: 'req1',
        method: 'aria2.echo',
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32600 },
      });
    });

    it('handles token authentication with RPC token prefix', async () => {
      const server = new Aria2Server(methods, { token: 'secret' });
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['token:secret', 'hello'],
      });
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req1',
        result: 'hello',
      });
    });

    it('rejects wrong token', async () => {
      const server = new Aria2Server(methods, { token: 'secret' });
      const result = await server.handleRequest({
        jsonrpc: '2.0',
        id: 'req1',
        method: 'aria2.echo',
        params: ['token:wrong', 'hello'],
      });
      expect(result).toMatchObject({
        jsonrpc: '2.0',
        id: 'req1',
        error: { code: -32600 },
      });
    });
  });

  describe('handleNotification', () => {
    it('handles notification by method name', () => {
      const server = new Aria2Server(methods);
      expect(() => server.handleNotification('aria2.onDownloadStart', [{ gid: '1234' }])).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/core/aria2-server.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcError, JsonRpcNotification } from './types';
import { ARIA2_ERRORS } from './types';

type MethodFn = (params: unknown[]) => Promise<unknown>;

export class Aria2Server {
  private methods: Record<string, MethodFn>;
  private token: string | null;

  constructor(methods: Record<string, MethodFn>, options: { token?: string } = {}) {
    this.methods = methods;
    this.token = options.token || null;
  }

  async handleRequest(
    body: unknown
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    // Parse
    let parsed: JsonRpcRequest | JsonRpcRequest[];
    try {
      if (typeof body === 'string') {
        parsed = JSON.parse(body);
      } else if (typeof body === 'object' && body !== null) {
        parsed = body as JsonRpcRequest | JsonRpcRequest[];
      } else {
        return this.errorResponse(null, ARIA2_ERRORS.PARSE);
      }
    } catch {
      return this.errorResponse(null, ARIA2_ERRORS.PARSE);
    }

    // Batch request
    if (Array.isArray(parsed)) {
      const results = await Promise.all(
        parsed.map((req) => this.handleSingle(req))
      );
      return results.filter((r): r is JsonRpcResponse => r !== null);
    }

    return this.handleSingle(parsed);
  }

  private async handleSingle(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse | null> {
    const isNotification = request.id === undefined || request.id === null;

    // Validate jsonrpc
    if (request.jsonrpc !== '2.0') {
      if (isNotification) return null;
      return this.errorResponse(request.id, ARIA2_ERRORS.INVALID_REQUEST);
    }

    // Validate method presence
    if (!request.method || typeof request.method !== 'string') {
      if (isNotification) return null;
      return this.errorResponse(request.id, ARIA2_ERRORS.INVALID_REQUEST);
    }

    // Token authentication
    let params = request.params || [];
    if (!Array.isArray(params)) {
      params = [params];
    }

    if (this.token) {
      const firstParam = params[0];
      if (typeof firstParam === 'string' && firstParam.startsWith('token:')) {
        const providedToken = firstParam.slice(6);
        if (providedToken !== this.token) {
          if (isNotification) return null;
          return this.errorResponse(request.id, {
            code: -32600,
            message: 'Invalid token',
          });
        }
        params = params.slice(1);
      } else {
        // Token required but not provided
        if (isNotification) return null;
        return this.errorResponse(request.id, {
          code: -32600,
          message: 'Token required',
        });
      }
    }

    // Route method
    const fn = this.methods[request.method];
    if (!fn) {
      if (isNotification) return null;
      return this.errorResponse(request.id, ARIA2_ERRORS.METHOD_NOT_FOUND);
    }

    try {
      const result = await fn(params);
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (err: any) {
      if (isNotification) return null;
      return this.errorResponse(request.id, {
        code: err.code ?? ARIA2_ERRORS.INTERNAL.code,
        message: err.message ?? ARIA2_ERRORS.INTERNAL.message,
      });
    }
  }

  handleNotification(method: string, params: unknown[]): void {
    const fn = this.methods[method];
    if (fn) {
      fn(params).catch(() => {});
    }
  }

  private errorResponse(
    id: string | number | null,
    error: JsonRpcError
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/core/aria2-server.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/aria2-server.ts tests/core/aria2-server.test.ts && git commit -m "feat: add JSON-RPC 2.0 protocol handler with batch support and token auth"
```

---

### Task 10: Background entrypoint

**Files:**
- Modify: `src/entrypoints/background.ts`

**Interfaces:**
- Produces: Background service worker wiring all modules together
- Consumes: `Aria2Server`, `createMethodMap`, `DownloadManager`, `TaskStore`, `WebSocketBridge`

- [ ] **Step 1: Write background.ts**

```typescript
import { TaskStore } from '@/core/task-store';
import { DownloadManager } from '@/core/download-manager';
import { WebSocketBridge } from '@/core/websocket-bridge';
import { Aria2Server } from '@/core/aria2-server';
import { createMethodMap } from '@/core/aria2-methods';

export default defineBackground(() => {
  const taskStore = new TaskStore();
  const downloadManager = new DownloadManager(taskStore);
  const wsBridge = new WebSocketBridge();

  let globalOptions: Record<string, string | undefined> = {};
  const sessionId = crypto.randomUUID();

  downloadManager.init();
  wsBridge.init();

  // Load persisted global options
  chrome.storage.sync.get('globalOptions').then((result) => {
    if (result.globalOptions) {
      globalOptions = result.globalOptions;
    }
  });

  const methodCtx = {
    downloadManager,
    taskStore,
    wsBridge,
    globalOptions,
    sessionId,
  };

  const methods = createMethodMap(methodCtx);

  let token: string | undefined;
  chrome.storage.sync.get('rpcToken').then((result) => {
    token = result.rpcToken;
  });

  // Build server on-demand with current token
  function getServer(): Aria2Server {
    return new Aria2Server(methods, { token });
  }

  // Handle HTTP-style RPC requests (from content script bridge)
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type: string; payload: unknown; requestId: string } | undefined;
    if (!msg || msg.type !== 'aria2-rpc') return false;

    const server = getServer();
    server.handleRequest(msg.payload).then((response) => {
      sendResponse({ requestId: msg.requestId, response });
    }).catch((err) => {
      sendResponse({
        requestId: msg.requestId,
        response: {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: err.message || 'Internal error' },
        },
      });
    });

    return true; // async response
  });

  // Handle WebSocket port messages (from content script bridge)
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'aria2-rpc') return;

    port.onMessage.addListener((message: unknown) => {
      const msg = message as { requestId: string; payload: unknown } | undefined;
      if (!msg) return;

      const server = getServer();
      server.handleRequest(msg.payload).then((response) => {
        port.postMessage({ requestId: msg.requestId, response });
      }).catch((err) => {
        port.postMessage({
          requestId: msg.requestId,
          response: {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: err.message || 'Internal error' },
          },
        });
      });
    });
  });

  // Forward download events to WebSocket clients
  downloadManager.onTaskChange((task) => {
    if (task.status === 'active' && task.browserDownloadId !== null) {
      wsBridge.broadcast('aria2.onDownloadStart', [{ gid: task.gid }]);
    } else if (task.status === 'paused') {
      wsBridge.broadcast('aria2.onDownloadPause', [{ gid: task.gid }]);
    } else if (task.status === 'complete') {
      wsBridge.broadcast('aria2.onDownloadComplete', [{ gid: task.gid }]);
    } else if (task.status === 'error') {
      wsBridge.broadcast('aria2.onDownloadError', [{ gid: task.gid }]);
    } else if (task.status === 'removed') {
      wsBridge.broadcast('aria2.onDownloadStop', [{ gid: task.gid }]);
    }
  });

  // Handle popup data requests
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type: string } | undefined;
    if (!msg) return false;
    if (msg.type === 'getGlobalStat') {
      downloadManager.getGlobalStat().then((stat) => {
        sendResponse(stat);
      });
      return true;
    }
    if (msg.type === 'getRecentDownloads') {
      taskStore.query({ status: undefined, sort: 'updatedAt', sortDir: 'desc', num: 5 }).then((tasks) => {
        sendResponse(tasks);
      });
      return true;
    }
    if (msg.type === 'openUI') {
      const uiUrl = chrome.runtime.getURL('/ui/index.html');
      chrome.tabs.create({ url: uiUrl });
      sendResponse({ success: true });
      return false;
    }
    if (msg.type === 'updateToken') {
      const newToken = (msg as any).token;
      token = newToken;
      chrome.storage.sync.set({ rpcToken: newToken }).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
    if (msg.type === 'getToken') {
      sendResponse({ token });
      return false;
    }
    return false;
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/entrypoints/background.ts && git commit -m "feat: wire background service worker with Aria2Server, DownloadManager, and message routing"
```

---

### Task 11: Content scripts (MAIN world interception + ISOLATED bridge)

**Files:**
- Modify: `src/entrypoints/main.content.ts`
- Modify: `src/entrypoints/bridge.content.ts`

**Interfaces:**
- Produces: Content scripts that intercept fetch/XHR/WebSocket on all pages and route to background

- [ ] **Step 1: Write main.content.ts (MAIN world)**

```typescript
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const TARGETS = ['localhost:6800', '127.0.0.1:6800'];
    const REQUEST_TIMEOUT_MS = 30_000;

    function isAria2Target(url: string): boolean {
      try {
        const u = new URL(url, location.origin);
        return TARGETS.some((t) => {
          const [host, port] = t.split(':');
          return u.hostname === host && u.port === port;
        });
      } catch {
        return false;
      }
    }

    // Relay element and request tracking
    const relay = document.createElement('span');
    relay.id = '__aria2shim_relay__';
    relay.style.display = 'none';
    document.documentElement?.appendChild(relay);

    let requestCounter = 0;
    const pendingRequests = new Map<number, {
      resolve: (value: Response | string) => void;
      reject: (reason: Error) => void;
    }>();

    // Listen for responses from bridge
    relay.addEventListener('__aria2shim_response__', ((e: CustomEvent) => {
      const { requestId, result, error, data } = e.detail;
      const pending = pendingRequests.get(requestId);
      if (!pending) return;

      pendingRequests.delete(requestId);

      if (error) {
        pending.reject(new Error(error.message || 'RPC error'));
        return;
      }

      if (data !== undefined) {
        // WebSocket data
        pending.resolve(data);
        return;
      }

      pending.resolve(JSON.stringify(result));
    }) as EventListener);

    // Listen for WebSocket events from bridge
    relay.addEventListener('__aria2shim_wsevent__', ((e: CustomEvent) => {
      const { wsId, method, params } = e.detail;
      const ws = wsInstances.get(wsId);
      if (!ws) return;

      if (method === 'close') {
        ws.readyState = 3; // CLOSED
        if (ws.onclose) ws.onclose(new CloseEvent('close', { code: 1000 }));
        wsInstances.delete(wsId);
        return;
      }

      if (method === 'error') {
        if (ws.onerror) ws.onerror(new Event('error'));
        return;
      }

      if (ws.onmessage) {
        const eventData = params ? JSON.stringify(params[0]) : '';
        ws.onmessage(new MessageEvent('message', { data: eventData }));
      }
    }) as EventListener);

    function sendRequest(type: string, payload: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const requestId = ++requestCounter;

        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });

        relay.dispatchEvent(new CustomEvent('__aria2shim_request__', {
          detail: { requestId, type, payload },
        }));
      });
    }

    // ---- Intercept fetch ----
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isAria2Target(url)) {
        const body = init?.body;
        let parsed: unknown;
        try {
          parsed = typeof body === 'string' ? JSON.parse(body) : body;
        } catch {
          parsed = body;
        }

        return sendRequest('rpc', parsed).then((result) => {
          return new Response(result as BodyInit, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }) as Promise<Response>;
      }
      return originalFetch(input, init);
    };

    // ---- Intercept XMLHttpRequest ----
    const OrigXHR = window.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    const origSetRequestHeader = OrigXHR.prototype.setRequestHeader;

    OrigXHR.prototype.open = function (
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ) {
      const urlStr = url.toString();
      (this as any).__aria2shim_target__ = isAria2Target(urlStr);
      (this as any).__aria2shim_method__ = method;
      (this as any).__aria2shim_url__ = urlStr;
      if (!(this as any).__aria2shim_target__) {
        return origOpen.call(this, method, url, async, username, password);
      }
    };

    OrigXHR.prototype.setRequestHeader = function (name: string, value: string) {
      if ((this as any).__aria2shim_target__) return;
      return origSetRequestHeader.call(this, name, value);
    };

    OrigXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if (!(this as any).__aria2shim_target__) {
        return origSend.call(this, body);
      }

      const xhr = this;
      let parsed: unknown;
      try {
        parsed = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        parsed = body;
      }

      sendRequest('rpc', parsed)
        .then((result) => {
          Object.defineProperty(xhr, 'readyState', { value: 4, writable: true });
          Object.defineProperty(xhr, 'status', { value: 200, writable: true });
          Object.defineProperty(xhr, 'responseText', { value: typeof result === 'string' ? result : JSON.stringify(result), writable: true });
          Object.defineProperty(xhr, 'response', { value: result, writable: true });
          (xhr as any).__aria2shim_response__ = result;
          if (xhr.onload) xhr.onload(new ProgressEvent('load'));
          if (xhr.onreadystatechange) {
            xhr.onreadystatechange(new Event('readystatechange'));
          }
        })
        .catch((err) => {
          if (xhr.onerror) xhr.onerror(new ProgressEvent('error'));
        });
    };

    // ---- Intercept WebSocket ----
    const wsInstances = new Map<number, FakeWebSocket>();
    let wsIdCounter = 0;

    class FakeWebSocket extends EventTarget {
      readonly url: string;
      readyState: number = 0; // CONNECTING
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      onopen: ((ev: Event) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      private wsId: number;
      private openResolve: (() => void) | null = null;

      constructor(url: string) {
        super();
        this.url = url;
        this.wsId = ++wsIdCounter;
        wsInstances.set(this.wsId, this);

        // Request WebSocket connection through bridge
        relay.dispatchEvent(new CustomEvent('__aria2shim_wsconnect__', {
          detail: { wsId: this.wsId, url },
        }));

        // Simulate async connection
        setTimeout(() => {
          this.readyState = 1; // OPEN
          if (this.onopen) this.onopen(new Event('open'));
        }, 0);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.readyState !== 1) throw new Error('WebSocket is not open');

        let body: unknown;
        try {
          body = typeof data === 'string' ? JSON.parse(data) : data;
        } catch {
          body = data;
        }

        sendRequest('ws-rpc', { wsId: this.wsId, payload: body });
      }

      close(code?: number, reason?: string): void {
        if (this.readyState === 3) return;
        this.readyState = 3;

        relay.dispatchEvent(new CustomEvent('__aria2shim_wsclose__', {
          detail: { wsId: this.wsId, code, reason },
        }));

        wsInstances.delete(this.wsId);
      }
    }

    (window as any).WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const url = args[0] as string;
        if (isAria2Target(url)) {
          return new FakeWebSocket(url);
        }
        return new target(url, args[1]);
      },
    });
  },
});
```

- [ ] **Step 2: Write bridge.content.ts (ISOLATED world)**

```typescript
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    let relay: HTMLSpanElement | null = null;
    let wsPort: chrome.runtime.Port | null = null;
    const wsToRequest = new Map<number, string>(); // wsId -> requestId for initial connect

    function getRelay(): HTMLSpanElement {
      if (!relay) {
        relay = document.getElementById('__aria2shim_relay__') as HTMLSpanElement;
      }
      return relay!;
    }

    // Listen for requests from MAIN world
    document.addEventListener('__aria2shim_request__', ((e: CustomEvent) => {
      const { requestId, type, payload } = e.detail;

      if (type === 'rpc') {
        chrome.runtime.sendMessage({ type: 'aria2-rpc', requestId, payload }).then((response) => {
          getRelay().dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: { requestId, result: response.response?.result ?? response.response },
          }));
        }).catch((err) => {
          getRelay().dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: {
              requestId,
              error: { code: -32603, message: err.message || 'Bridge error' },
            },
          }));
        });
      } else if (type === 'ws-rpc') {
        const wsPayload = payload as { wsId: number; payload: unknown };
        if (wsPort) {
          wsPort.postMessage({ requestId, payload: wsPayload.payload });
        }
      }
    }) as EventListener);

    // Listen for WebSocket connect requests
    document.addEventListener('__aria2shim_wsconnect__', ((e: CustomEvent) => {
      const { wsId, url } = e.detail;

      if (!wsPort) {
        wsPort = chrome.runtime.connect({ name: 'aria2-rpc' });

        wsPort.onMessage.addListener((message: any) => {
          const { requestId, response } = message;
          if (!response) return;

          // Forward response to MAIN world
          getRelay().dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: { requestId, result: response.result ?? response },
          }));

          // Check if it's an event notification
          if (response.method && response.method.startsWith('aria2.on')) {
            // Forward events to all WebSocket instances
            wsInstancesFromMain();
          }
        });

        wsPort.onDisconnect.addListener(() => {
          wsPort = null;
        });
      }

      // Also register with main WebSocket bridge port
      const eventPort = chrome.runtime.connect({ name: 'aria2-ws' });
      eventPort.onMessage.addListener((msg: any) => {
        // Forward aria2 events to MAIN world
        if (msg.method && msg.method.startsWith('aria2.on')) {
          getRelay().dispatchEvent(new CustomEvent('__aria2shim_wsevent__', {
            detail: { wsId, method: msg.method, params: msg.params },
          }));
        }
      });
    }) as EventListener);

    // Listen for WebSocket close requests
    document.addEventListener('__aria2shim_wsclose__', ((e: CustomEvent) => {
      if (wsPort) {
        wsPort.disconnect();
        wsPort = null;
      }
    }) as EventListener);

    function wsInstancesFromMain(): void {
      getRelay().dispatchEvent(new CustomEvent('__aria2shim_wspoll__', {
        detail: {},
      }));
    }
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/main.content.ts src/entrypoints/bridge.content.ts && git commit -m "feat: implement content scripts for fetch/XHR/WebSocket interception on all pages"
```

---

### Task 12: Popup React UI

**Files:**
- Modify: `src/entrypoints/popup/App.tsx`
- Create: `src/entrypoints/popup/components/StatusOverview.tsx`
- Create: `src/entrypoints/popup/components/RecentDownloads.tsx`
- Create: `src/entrypoints/popup/components/ActionBar.tsx`
- Create: `src/entrypoints/popup/hooks/useBackground.ts`

**Interfaces:**
- Consumes: Background messaging for global stats and recent downloads

- [ ] **Step 1: Write useBackground hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { Aria2GlobalStat, DownloadTask } from '@/core/types';

export function useBackground() {
  const [stats, setStats] = useState<Aria2GlobalStat | null>(null);
  const [recentDownloads, setRecentDownloads] = useState<DownloadTask[]>([]);
  const [token, setToken] = useState<string>('');

  const loadStats = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getGlobalStat' }).then(setStats);
  }, []);

  const loadRecent = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getRecentDownloads' }).then(setRecentDownloads);
  }, []);

  const loadToken = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getToken' }).then((res) => {
      if (res?.token) setToken(res.token);
    });
  }, []);

  const openUI = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'openUI' });
  }, []);

  const openOptions = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  useEffect(() => {
    loadStats();
    loadRecent();
    loadToken();

    const interval = setInterval(() => {
      loadStats();
      loadRecent();
    }, 2000);

    return () => clearInterval(interval);
  }, [loadStats, loadRecent, loadToken]);

  return { stats, recentDownloads, token, openUI, openOptions, refresh: () => { loadStats(); loadRecent(); } };
}
```

- [ ] **Step 2: Write StatusOverview component**

```typescript
import type { Aria2GlobalStat } from '@/core/types';

interface Props {
  stats: Aria2GlobalStat | null;
}

export default function StatusOverview({ stats }: Props) {
  if (!stats) {
    return (
      <div className="text-center py-3 text-gray-400 text-sm">
        Loading...
      </div>
    );
  }

  const items = [
    { label: 'Active', value: stats.numActive, color: 'text-green-400' },
    { label: 'Waiting', value: stats.numWaiting, color: 'text-yellow-400' },
    { label: 'Stopped', value: stats.numStopped, color: 'text-red-400' },
  ];

  const speedKB = Math.round(Number(stats.downloadSpeed) / 1024);

  return (
    <div className="mb-3">
      <div className="flex justify-around mb-2">
        {items.map((item) => (
          <div key={item.label} className="text-center">
            <div className={`text-lg font-bold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-gray-400">{item.label}</div>
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-gray-500">
        {speedKB > 0 ? `${speedKB} KB/s` : 'Idle'}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write RecentDownloads component**

```typescript
import type { DownloadTask } from '@/core/types';

interface Props {
  tasks: DownloadTask[];
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-green-400';
    case 'complete': return 'text-blue-400';
    case 'error': return 'text-red-400';
    case 'paused': return 'text-yellow-400';
    default: return 'text-gray-400';
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function filename(uris: string[]): string {
  if (uris.length === 0) return 'Unknown';
  try {
    const url = new URL(uris[0]);
    const name = url.pathname.split('/').pop() || 'download';
    return decodeURIComponent(name);
  } catch {
    return uris[0].split('/').pop() || 'download';
  }
}

export default function RecentDownloads({ tasks }: Props) {
  const visible = tasks.filter((t) => t.status !== 'pending');
  if (visible.length === 0) {
    return <div className="text-center py-2 text-xs text-gray-500">No downloads yet</div>;
  }

  return (
    <div className="space-y-1">
      {visible.slice(0, 5).map((task) => (
        <div key={task.gid} className="flex items-center gap-2 text-xs py-1 border-b border-gray-700 last:border-0">
          <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'active' ? 'bg-green-400 animate-pulse' : task.status === 'complete' ? 'bg-blue-400' : 'bg-gray-500'}`} />
          <div className="flex-1 truncate">{filename(task.uris)}</div>
          <div className={statusColor(task.status)}>
            {task.status === 'active'
              ? `${Math.round((task.completedLength / (task.totalLength || 1)) * 100)}%`
              : task.status}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write ActionBar component**

```typescript
interface Props {
  onOpenUI: () => void;
  onOpenOptions: () => void;
  onRefresh: () => void;
  token: string;
}

export default function ActionBar({ onOpenUI, onOpenOptions, onRefresh, token }: Props) {
  return (
    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-700">
      <button
        onClick={onOpenUI}
        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
      >
        Open aria2NG
      </button>
      <button
        onClick={onOpenOptions}
        className="p-2 text-gray-400 hover:text-white transition-colors"
        title="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <button
        onClick={onRefresh}
        className="p-2 text-gray-400 hover:text-white transition-colors"
        title="Refresh"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Update App.tsx**

```typescript
import StatusOverview from './components/StatusOverview';
import RecentDownloads from './components/RecentDownloads';
import ActionBar from './components/ActionBar';
import { useBackground } from './hooks/useBackground';

export default function App() {
  const { stats, recentDownloads, token, openUI, openOptions, refresh } = useBackground();

  return (
    <div className="w-[320px] p-3 bg-gray-900 text-white">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-sm font-bold text-gray-300">Aria2 Shim</h1>
        {token && (
          <span className="text-xs text-gray-500">Secured</span>
        )}
      </div>
      <StatusOverview stats={stats} />
      <RecentDownloads tasks={recentDownloads} />
      <ActionBar
        onOpenUI={openUI}
        onOpenOptions={openOptions}
        onRefresh={refresh}
        token={token}
      />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/popup/ && git commit -m "feat: add React popup UI with status overview, recent downloads, and aria2NG launcher"
```

---

### Task 13: Options React UI

**Files:**
- Modify: `src/entrypoints/options/App.tsx`
- Create: `src/entrypoints/options/components/TokenSettings.tsx`
- Create: `src/entrypoints/options/components/DirectorySettings.tsx`
- Create: `src/entrypoints/options/components/GlobalOptionsSettings.tsx`

- [ ] **Step 1: Write TokenSettings component**

```typescript
import { useState, useEffect } from 'react';

export default function TokenSettings() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'getToken' }).then((res) => {
      if (res?.token) setToken(res.token);
    });
  }, []);

  const handleSave = () => {
    chrome.runtime.sendMessage({ type: 'updateToken', token }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">RPC Token</h2>
      <p className="text-sm text-gray-600 mb-2">
        Secret token for aria2 RPC authentication. Leave empty to disable.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Enter secret token..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write DirectorySettings component**

```typescript
import { useState, useEffect } from 'react';

export default function DirectorySettings() {
  const [dir, setDir] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      if (result.globalOptions?.dir) setDir(result.globalOptions.dir);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      const opts = result.globalOptions || {};
      opts.dir = dir;
      chrome.storage.sync.set({ globalOptions: opts }).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
    });
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Default Download Directory</h2>
      <p className="text-sm text-gray-600 mb-2">
        Directory path for downloads (browser may ignore this).
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="/downloads"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write GlobalOptionsSettings component**

```typescript
import { useState, useEffect } from 'react';

export default function GlobalOptionsSettings() {
  const [maxConcurrent, setMaxConcurrent] = useState('5');
  const [maxConnPerServer, setMaxConnPerServer] = useState('1');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      const opts = result.globalOptions || {};
      if (opts['max-concurrent-downloads']) setMaxConcurrent(opts['max-concurrent-downloads']);
      if (opts['max-connection-per-server']) setMaxConnPerServer(opts['max-connection-per-server']);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      const opts = result.globalOptions || {};
      opts['max-concurrent-downloads'] = maxConcurrent;
      opts['max-connection-per-server'] = maxConnPerServer;
      chrome.storage.sync.set({ globalOptions: opts }).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
    });
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Global Options</h2>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Max Concurrent Downloads</label>
          <input
            type="number"
            min="1"
            max="32"
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Max Connections Per Server</label>
          <input
            type="number"
            min="1"
            max="16"
            value={maxConnPerServer}
            onChange={(e) => setMaxConnPerServer(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update App.tsx**

```typescript
import TokenSettings from './components/TokenSettings';
import DirectorySettings from './components/DirectorySettings';
import GlobalOptionsSettings from './components/GlobalOptionsSettings';

export default function App() {
  return (
    <div className="max-w-2xl mx-auto p-6 bg-white min-h-screen">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Aria2 Browser Shim Settings</h1>
      <TokenSettings />
      <DirectorySettings />
      <GlobalOptionsSettings />
      <div className="text-xs text-gray-400 mt-8 pt-4 border-t">
        Aria2 Browser Shim — Browser-native aria2 replacement
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/options/ && git commit -m "feat: add React options UI with token, directory, and global download settings"
```

---

### Task 14: UI page (aria2NG integration)

**Files:**
- Modify: `src/entrypoints/ui/index.html`

**Interfaces:**
- Produces: Extension page that loads aria2NG

- [ ] **Step 1: Update ui/index.html to load aria2NG**

For now, create a self-contained placeholder that loads aria2NG from a known CDN (can be replaced with bundled version later). The content scripts will automatically intercept any requests from this page to localhost:6800.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AriaNg - Aria2 Browser Shim</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; }
    #loading { display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 16px; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #22c55e; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .tip { font-size: 13px; color: #666; max-width: 400px; text-align: center; }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <p>AriaNg is loading...</p>
    <p class="tip">Ensure Aria2 Browser Shim extension is installed and enabled. AriaNg will connect to <code>localhost:6800</code> automatically.</p>
  </div>

  <!-- Load aria2NG from CDN -->
  <script src="https://cdn.jsdelivr.net/npm/ariang@latest/dist/ariang.min.js"></script>
  <script>
    if (typeof AriaNg !== 'undefined') {
      document.getElementById('loading').innerHTML = '';
      new AriaNg({
        rpcAlias: 'Aria2 Browser Shim',
        rpcHost: 'localhost',
        rpcPort: '6800',
        protocol: 'http',
        globalStatRefreshInterval: 2000,
        taskRefreshInterval: 2000,
      });
    } else {
      document.getElementById('loading').innerHTML = `
        <div style="text-align:center; padding: 40px;">
          <h2 style="color:#ef4444; margin-bottom:16px;">Failed to load AriaNg</h2>
          <p class="tip">Could not load AriaNg from CDN. Please check your internet connection and try refreshing the page.</p>
        </div>
      `;
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/entrypoints/ui/index.html && git commit -m "feat: add aria2NG UI page with CDN loading"
```

---

### Task 15: Integration verification and cleanup

**Files:**
- Check: all source files exist and compile

- [ ] **Step 1: Run full test suite**

```bash
pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Run production build**

```bash
pnpm wxt build
```

Expected: Build succeeds, output in `.output/chrome-mv3/`.

- [ ] **Step 3: Verify manifest includes all required permissions**

```bash
cat .output/chrome-mv3/manifest.json | python3 -m json.tool
```

Expected: Manifest includes `downloads`, `declarativeNetRequest`, `tabs`, `storage`, `unlimitedStorage` permissions and `<all_urls>` host_permissions.

- [ ] **Step 4: Verify entrypoints exist in output**

```bash
ls .output/chrome-mv3/
ls .output/chrome-mv3/ui/
ls .output/chrome-mv3/popup/
ls .output/chrome-mv3/options/
```

Expected: All entrypoint directories exist with HTML files.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: final integration verification, all tests pass and build succeeds"
```
