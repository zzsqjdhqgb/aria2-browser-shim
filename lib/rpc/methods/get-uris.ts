import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.getUris', async (params: unknown[], ctx: HandlerContext) => {
    const gid = params[0] as string;
    if (!gid) throw new Error('No GID provided');

    const task = ctx.downloadManager.getTask(gid);
    if (!task) throw new Error(`Unknown GID: ${gid}`);

    return [{ uri: task.request.url, status: 'used' }];
  });
}
