import TokenSettings from './components/TokenSettings';
import DirectorySettings from './components/DirectorySettings';
import GlobalOptionsSettings from './components/GlobalOptionsSettings';

export default function App() {
  return (
    <div className="max-w-2xl mx-auto p-6 bg-white min-h-screen">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Aria2 Browser Shim Settings</h1>
      <TokenSettings />
      <DirectorySettings />
      <GlobalOptionsSettings />
      <div className="text-xs text-gray-400 mt-8 pt-4 border-t">
        Aria2 Browser Shim — Browser-native aria2 replacement
      </div>
    </div>
  );
}
