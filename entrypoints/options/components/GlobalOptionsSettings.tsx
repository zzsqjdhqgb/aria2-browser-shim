import { useState, useEffect } from 'react';

export default function GlobalOptionsSettings() {
  const [maxConcurrent, setMaxConcurrent] = useState('5');
  const [maxConnPerServer, setMaxConnPerServer] = useState('1');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      const opts = result.globalOptions || {};
      if (opts['max-concurrent-downloads']) setMaxConcurrent(opts['max-concurrent-downloads']);
      if (opts['max-connection-per-server']) setMaxConnPerServer(opts['max-connection-per-server']);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      const opts = result.globalOptions || {};
      opts['max-concurrent-downloads'] = maxConcurrent;
      opts['max-connection-per-server'] = maxConnPerServer;
      chrome.storage.sync.set({ globalOptions: opts }).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
    });
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Global Options</h2>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Max Concurrent Downloads</label>
          <input
            type="number"
            min="1"
            max="32"
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Max Connections Per Server</label>
          <input
            type="number"
            min="1"
            max="16"
            value={maxConnPerServer}
            onChange={(e) => setMaxConnPerServer(e.target.value)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
