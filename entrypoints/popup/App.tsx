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
