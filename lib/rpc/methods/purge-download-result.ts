import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';
import type { DownloadTask } from '../../types';

const HISTORY_KEY = 'aria2_download_history';
const TERMINAL_STATUSES = new Set(['complete', 'error', 'cancelled']);

export function register(registry: MethodRegistry): void {
  registry.register('aria2.purgeDownloadResult', async (_params: unknown[], _ctx: HandlerContext) => {
    const result = await browser.storage.local.get({ [HISTORY_KEY]: [] });
    const history: DownloadTask[] = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    const updated = history.filter((t) => !TERMINAL_STATUSES.has(t.status));
    await browser.storage.local.set({ [HISTORY_KEY]: updated });

    return 'OK';
  });
}
