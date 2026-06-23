import { useState, useEffect } from 'react';

export default function TokenSettings() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'getToken' }).then((res) => {
      if (res?.token) setToken(res.token);
    });
  }, []);

  const handleSave = () => {
    chrome.runtime.sendMessage({ type: 'updateToken', token }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">RPC Token</h2>
      <p className="text-sm text-gray-600 mb-2">
        Secret token for aria2 RPC authentication. Leave empty to disable.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Enter secret token..."
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
