import type { Aria2GlobalStat } from '../../../src/core/types';

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
