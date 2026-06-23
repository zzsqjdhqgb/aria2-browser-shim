import { useState, useEffect, useCallback } from 'react';
import type { Aria2GlobalStat, DownloadTask } from '../../../src/core/types';

export function useBackground() {
  const [stats, setStats] = useState<Aria2GlobalStat | null>(null);
  const [recentDownloads, setRecentDownloads] = useState<DownloadTask[]>([]);
  const [token, setToken] = useState<string>('');

  const loadStats = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getGlobalStat' }).then(setStats);
  }, []);

  const loadRecent = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getRecentDownloads' }).then(setRecentDownloads);
  }, []);

  const loadToken = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getToken' }).then((res) => {
      if (res?.token) setToken(res.token);
    });
  }, []);

  const openUI = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'openUI' });
  }, []);

  const openOptions = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  useEffect(() => {
    loadStats();
    loadRecent();
    loadToken();

    const interval = setInterval(() => {
      loadStats();
      loadRecent();
    }, 2000);

    return () => clearInterval(interval);
  }, [loadStats, loadRecent, loadToken]);

  return { stats, recentDownloads, token, openUI, openOptions, refresh: () => { loadStats(); loadRecent(); } };
}
