import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.getFiles', async (params: unknown[], ctx: HandlerContext) => {
    const gid = params[0] as string;
    if (!gid) throw new Error('No GID provided');

    const task = ctx.downloadManager.getTask(gid);
    if (!task) throw new Error(`Unknown GID: ${gid}`);

    const fileName = task.request.filename ?? task.request.url.split('/').pop() ?? 'unknown';

    return [
      {
        index: '1',
        path: fileName,
        length: String(task.totalBytes),
        completedLength: String(task.bytesReceived),
        selected: 'true',
        uris: [{ uri: task.request.url, status: 'used' }],
      },
    ];
  });
}
