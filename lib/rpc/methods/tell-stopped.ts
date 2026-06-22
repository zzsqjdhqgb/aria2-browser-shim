import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';
import type { DownloadTask } from '../../types';

function mapStatus(status: string): string {
  switch (status) {
    case 'in_progress': return 'active';
    case 'paused': return 'paused';
    case 'pending': return 'waiting';
    case 'complete': return 'complete';
    case 'error': return 'error';
    case 'cancelled': return 'removed';
    default: return status;
  }
}

function formatTaskStatus(task: DownloadTask) {
  const fileName = task.request.filename ?? task.request.url.split('/').pop() ?? 'unknown';

  return {
    gid: task.gid,
    status: mapStatus(task.status),
    totalLength: String(task.totalBytes),
    completedLength: String(task.bytesReceived),
    downloadSpeed: '0',
    uploadSpeed: '0',
    uploadLength: '0',
    dir: task.request.directory ?? '.',
    files: [
      {
        index: '1',
        path: fileName,
        length: String(task.totalBytes),
        completedLength: String(task.bytesReceived),
        selected: 'true',
        uris: [{ uri: task.request.url, status: 'used' }],
      },
    ],
    bitfield: '',
    pieceLength: '0',
    numPieces: '0',
    connections: '1',
    errorCode: task.error ? '1' : '0',
    errorMessage: task.error ?? '',
    followedBy: null,
    following: null,
    belongsTo: null,
    infoHash: '',
    numSeeders: '0',
    seeder: 'false',
    bittorrent: {},
  };
}

const STOPPED_STATUSES = ['complete', 'error', 'cancelled'] as const;

export function register(registry: MethodRegistry): void {
  registry.register('aria2.tellStopped', async (params: unknown[], ctx: HandlerContext) => {
    const options = (params[0] as Record<string, number> | undefined) ?? {};
    const tasks = ctx.downloadManager.queryTasks({
      status: [...STOPPED_STATUSES],
      offset: options.offset,
      limit: options.num,
    });

    return tasks.map((task) => formatTaskStatus(task));
  });
}
