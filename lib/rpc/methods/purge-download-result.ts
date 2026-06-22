import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.purgeDownloadResult', async (_params: unknown[], ctx: HandlerContext) => {
    await ctx.store.local.purgeTerminalHistory();
    return 'OK';
  });
}
