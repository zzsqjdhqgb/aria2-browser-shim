import type { DownloadTask } from '../../../src/core/types';

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
