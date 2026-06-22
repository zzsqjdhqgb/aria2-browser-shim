import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.removeDownloadResult', async (params: unknown[], ctx: HandlerContext) => {
    const gid = params[0] as string;
    if (!gid) throw new Error('No GID provided');

    await ctx.store.local.removeFromHistory(gid);
    return 'OK';
  });
}
