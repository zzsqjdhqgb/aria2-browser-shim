import type { DownloadTask, Aria2Status, Aria2Version, ServerContext, Aria2File } from './types';
import { ARIA2_ERRORS, type TaskStatus } from './types';
import type { DownloadManager } from './download-manager';
import type { TaskStore } from './task-store';
import type { WebSocketBridge } from './websocket-bridge';

interface MethodContext {
  downloadManager: DownloadManager;
  taskStore: TaskStore;
  wsBridge: WebSocketBridge;
  globalOptions: Record<string, string | undefined>;
  sessionId: string;
}

type MethodFn = (params: unknown[]) => Promise<unknown>;

function toAria2Status(task: DownloadTask): Aria2Status {
  return {
    gid: task.gid,
    status: task.status,
    totalLength: task.totalLength.toString(),
    completedLength: task.completedLength.toString(),
    uploadLength: '0',
    bitfield: task.bitfield,
    downloadSpeed: task.downloadSpeed.toString(),
    uploadSpeed: task.uploadSpeed.toString(),
    infoHash: task.infoHash ?? '',
    numSeeders: task.numSeeders,
    seeder: task.seeder,
    pieceLength: task.pieceLength,
    numPieces: task.numPieces,
    connections: task.connections.toString(),
    errorCode: task.errorCode ?? '0',
    errorMessage: task.errorMessage ?? '',
    followedBy: task.followedBy ? [task.followedBy] : [],
    following: task.following ?? '',
    belongsTo: task.belongsTo ?? '',
    dir: task.dir,
    files: task.files,
    bittorrent: {},
    verifiedLength: task.verifiedLength,
    verifyIntegrityPending: task.verifyIntegrityPending,
  };
}

function filterStatus(status: Aria2Status, keys: string[]): Record<string, unknown> {
  const filtered: Record<string, unknown> = { gid: status.gid };
  for (const key of keys) {
    if (key in status) {
      filtered[key] = (status as Record<string, unknown>)[key];
    }
  }
  return filtered;
}

export function createMethodMap(ctx: MethodContext): Record<string, MethodFn> {
  const { downloadManager, taskStore, wsBridge, globalOptions } = ctx;

  async function requireTask(gid: string): Promise<DownloadTask> {
    const task = await taskStore.get(gid);
    if (!task) throw { ...ARIA2_ERRORS.UNKNOWN_GID(gid) };
    return task;
  }

  const methods: Record<string, MethodFn> = {
    'aria2.getVersion': async (): Promise<Aria2Version> => {
      return {
        version: '1.37.0-shim',
        enabledFeatures: ['HTTP', 'HTTPS', 'GZip', 'Message Digest', 'WebSocket'],
      };
    },

    'aria2.addUri': async (params) => {
      if (!params || params.length < 1) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const uris = params[0] as string[];
      const options = (params[1] as Record<string, unknown>) || {};

      if (!Array.isArray(uris) || uris.length === 0) {
        throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      }

      const request = {
        uris,
        headers: options.header as string[] | undefined,
        dir: options.dir as string | undefined,
        out: options.out as string | undefined,
        split: options.split ? Number(options.split) : undefined,
      };

      const gid = await downloadManager.create(request);
      wsBridge.broadcast('aria2.onDownloadStart', [{ gid }]);
      return gid;
    },

    'aria2.addTorrent': async () => {
      throw ARIA2_ERRORS.NOT_SUPPORTED('BitTorrent downloads are not supported');
    },

    'aria2.addMetalink': async () => {
      throw ARIA2_ERRORS.NOT_SUPPORTED('Metalink downloads are not supported');
    },

    'aria2.remove': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      await downloadManager.cancel(gid);
      await taskStore.delete(gid);
      return gid;
    },

    'aria2.forceRemove': async (params) => {
      return methods['aria2.remove'](params);
    },

    'aria2.pause': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      await requireTask(gid);
      await downloadManager.pause(gid);
      return gid;
    },

    'aria2.forcePause': async (params) => {
      return methods['aria2.pause'](params);
    },

    'aria2.unpause': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      await requireTask(gid);
      await downloadManager.resume(gid);
      return gid;
    },

    'aria2.tellStatus': async (params) => {
      const gid = params[0] as string;
      const keys = (params[1] as string[]) || [];
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      const status = toAria2Status(task);
      if (keys.length > 0) {
        const filtered: Record<string, unknown> = { gid: status.gid };
        for (const key of keys) {
          if (key in status) {
            (filtered as Record<string, unknown>)[key] = (status as Record<string, unknown>)[key];
          }
        }
        return filtered;
      }
      return status;
    },

    'aria2.tellActive': async (params) => {
      const keys = (params[0] as string[]) || [];
      const tasks = await taskStore.query({ status: 'active' });
      return tasks.map((t) => {
        const s = toAria2Status(t);
        return keys.length > 0 ? filterStatus(s, keys) : s;
      });
    },

    'aria2.tellWaiting': async (params) => {
      const offset = (params[0] as number) || 0;
      const num = (params[1] as number) || 100;
      const keys = (params[2] as string[]) || [];
      const tasks = await taskStore.query({ status: 'waiting', offset, num });
      return tasks.map((t) => {
        const s = toAria2Status(t);
        return keys.length > 0 ? filterStatus(s, keys) : s;
      });
    },

    'aria2.tellStopped': async (params) => {
      const offset = (params[0] as number) || 0;
      const num = (params[1] as number) || 100;
      const keys = (params[2] as string[]) || [];
      const tasks = await taskStore.query({ status: 'error', offset, num });
      return tasks.map((t) => {
        const s = toAria2Status(t);
        return keys.length > 0 ? filterStatus(s, keys) : s;
      });
    },

    'aria2.getOption': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.options;
    },

    'aria2.changeOption': async (params) => {
      const gid = params[0] as string;
      const options = params[1] as Record<string, string>;
      if (!gid || !options) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      task.options = { ...task.options, ...options };
      await taskStore.upsert(task);
      return 'OK';
    },

    'aria2.getGlobalOption': async () => {
      return { ...globalOptions };
    },

    'aria2.changeGlobalOption': async (params) => {
      const options = params[0] as Record<string, string>;
      if (!options) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      Object.assign(globalOptions, options);
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.sync.set({ globalOptions });
      }
      return 'OK';
    },

    'aria2.getSessionInfo': async () => {
      return { sessionId: ctx.sessionId };
    },

    'aria2.shutdown': async () => {
      const activeTasks = await taskStore.query({ status: 'active' });
      for (const task of activeTasks) {
        await downloadManager.cancel(task.gid);
      }
      return 'OK';
    },

    'aria2.forceShutdown': async () => {
      return methods['aria2.shutdown']([]);
    },

    'aria2.getGlobalStat': async () => {
      return downloadManager.getGlobalStat();
    },

    'aria2.changePosition': async (params) => {
      const gid = params[0] as string;
      const pos = params[1] as number;
      const how = params[2] as string;
      if (!gid || pos === undefined) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await taskStore.get(gid);
      if (!task) return 'OK';
      return (Number(pos)).toString();
    },

    'aria2.changeUri': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await taskStore.get(gid);
      if (!task) throw { ...ARIA2_ERRORS.UNKNOWN_GID(gid) };
      return [0, 0];
    },

    'aria2.purgeDownloadResult': async () => {
      await taskStore.purge('complete');
      await taskStore.purge('error');
      await taskStore.purge('removed');
      return 'OK';
    },

    'aria2.removeDownloadResult': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await taskStore.get(gid);
      if (task && ['complete', 'error', 'removed'].includes(task.status)) {
        await taskStore.delete(gid);
      }
      return 'OK';
    },

    'aria2.getFiles': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.files;
    },

    'aria2.getPeers': async () => {
      return [];
    },

    'aria2.getServers': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.uris.map((uri, index) => ({
        index: index.toString(),
        uri,
        currentUri: uri,
        downloadSpeed: '0',
      }));
    },

    'aria2.getUris': async (params) => {
      const gid = params[0] as string;
      if (!gid) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const task = await requireTask(gid);
      return task.uris.map((uri) => ({
        uri,
        status: 'used',
      }));
    },

    'aria2.listMethods': async () => {
      return Object.keys(methods).filter((k) => k.startsWith('aria2.'));
    },

    'aria2.listNotifications': async () => {
      return [
        'aria2.onDownloadStart',
        'aria2.onDownloadPause',
        'aria2.onDownloadStop',
        'aria2.onDownloadComplete',
        'aria2.onDownloadError',
        'aria2.onBtDownloadComplete',
      ];
    },

    'aria2.multicall': async (params) => {
      const calls = params[0] as Array<{ methodName: string; params: unknown[] }>;
      if (!Array.isArray(calls)) throw { ...ARIA2_ERRORS.INVALID_PARAMS };
      const results = [];
      for (const call of calls) {
        const fn = methods[call.methodName];
        if (!fn) {
          results.push([{ code: -32601, message: 'Method not found' }]);
        } else {
          try {
            const result = await fn(call.params);
            results.push([result]);
          } catch (e: any) {
            results.push([{ code: e.code || -32603, message: e.message || 'Error' }]);
          }
        }
      }
      return results;
    },
  };

  return methods;
}
