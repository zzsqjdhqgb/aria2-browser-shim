import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';
import type { DownloadTask } from '../../types';

const HISTORY_KEY = 'aria2_download_history';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.removeDownloadResult', async (params: unknown[], _ctx: HandlerContext) => {
    const gid = params[0] as string;
    if (!gid) throw new Error('No GID provided');

    const result = await browser.storage.local.get({ [HISTORY_KEY]: [] });
    const history: DownloadTask[] = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    const updated = history.filter((t) => t.gid !== gid);
    await browser.storage.local.set({ [HISTORY_KEY]: updated });

    return 'OK';
  });
}
