import { TaskStore } from '../src/core/task-store';
import { DownloadManager } from '../src/core/download-manager';
import { WebSocketBridge } from '../src/core/websocket-bridge';
import { Aria2Server } from '../src/core/aria2-server';
import { createMethodMap } from '../src/core/aria2-methods';

export default defineBackground(() => {
  const taskStore = new TaskStore();
  const downloadManager = new DownloadManager(taskStore);
  const wsBridge = new WebSocketBridge();

  let globalOptions: Record<string, string | undefined> = {};
  const sessionId = crypto.randomUUID();

  downloadManager.init();
  wsBridge.init();

  chrome.storage.sync.get('globalOptions').then((result) => {
    if (result.globalOptions) {
      globalOptions = result.globalOptions;
    }
  });

  const methodCtx = {
    downloadManager,
    taskStore,
    wsBridge,
    globalOptions,
    sessionId,
  };

  const methods = createMethodMap(methodCtx);

  let token: string | undefined;
  chrome.storage.sync.get('rpcToken').then((result) => {
    token = result.rpcToken;
  });

  function getServer(): Aria2Server {
    return new Aria2Server(methods, { token });
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type: string; payload?: unknown; requestId?: string } | undefined;
    if (!msg) return false;

    if (msg.type === 'aria2-rpc' && msg.requestId) {
      const server = getServer();
      server.handleRequest(msg.payload).then((response) => {
        sendResponse({ requestId: msg.requestId, response });
      }).catch((err) => {
        sendResponse({
          requestId: msg.requestId,
          response: {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: err.message || 'Internal error' },
          },
        });
      });
      return true; // async response
    }

    if (msg.type === 'getGlobalStat') {
      downloadManager.getGlobalStat().then((stat) => sendResponse(stat));
      return true;
    }

    if (msg.type === 'getRecentDownloads') {
      taskStore.query({ sort: 'updatedAt', sortDir: 'desc', num: 5 }).then((tasks) => {
        sendResponse(tasks);
      });
      return true;
    }

    if (msg.type === 'openUI') {
      const uiUrl = chrome.runtime.getURL('/ui.html');
      chrome.tabs.create({ url: uiUrl });
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === 'getToken') {
      sendResponse({ token });
      return false;
    }

    if (msg.type === 'updateToken') {
      const newToken = (msg as any).token;
      token = newToken;
      chrome.storage.sync.set({ rpcToken: newToken }).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    return false;
  });

  // Handle WebSocket port connections from content script
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'aria2-rpc') return;

    port.onMessage.addListener((message: unknown) => {
      const msg = message as { requestId: string; payload: unknown } | undefined;
      if (!msg) return;

      const server = getServer();
      server.handleRequest(msg.payload).then((response) => {
        port.postMessage({ requestId: msg.requestId, response });
      }).catch((err) => {
        port.postMessage({
          requestId: msg.requestId,
          response: {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: err.message || 'Internal error' },
          },
        });
      });
    });
  });

  // Forward download events to WebSocket clients
  const taskLastStatus = new Map<string, string>();

  downloadManager.onTaskChange((task) => {
    const prev = taskLastStatus.get(task.gid);
    taskLastStatus.set(task.gid, task.status);

    if (prev !== task.status) {
      if (task.status === 'active') {
        wsBridge.broadcast('aria2.onDownloadStart', [{ gid: task.gid }]);
      } else if (task.status === 'paused') {
        wsBridge.broadcast('aria2.onDownloadPause', [{ gid: task.gid }]);
      } else if (task.status === 'complete') {
        wsBridge.broadcast('aria2.onDownloadComplete', [{ gid: task.gid }]);
      } else if (task.status === 'error') {
        wsBridge.broadcast('aria2.onDownloadError', [{ gid: task.gid }]);
      } else if (task.status === 'removed') {
        wsBridge.broadcast('aria2.onDownloadStop', [{ gid: task.gid }]);
      }
    }
  });

  console.log('aria2-browser-shim background running');
});
