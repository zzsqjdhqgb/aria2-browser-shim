import { useState, useEffect } from 'react';

export default function DirectorySettings() {
  const [dir, setDir] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      if (result.globalOptions?.dir) setDir(result.globalOptions.dir);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.sync.get('globalOptions').then((result) => {
      const opts = result.globalOptions || {};
      opts.dir = dir;
      chrome.storage.sync.set({ globalOptions: opts }).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
    });
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Default Download Directory</h2>
      <p className="text-sm text-gray-600 mb-2">
        Directory path for downloads (browser may ignore this).
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="/downloads"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
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
