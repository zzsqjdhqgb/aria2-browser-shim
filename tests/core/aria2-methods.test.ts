import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMethodMap } from '@/core/aria2-methods';
import type { DownloadTask } from '@/core/types';

function mockTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: 'abcd123400000001',
    uris: ['https://example.com/file.zip'],
    status: 'active',
    browserDownloadId: null,
    totalLength: 1024000,
    completedLength: 512000,
    downloadSpeed: 102400,
    uploadSpeed: 0,
    connections: 1,
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/file.zip',
        length: '1024000',
        completedLength: '512000',
        selected: 'true',
        uris: [{ uri: 'https://example.com/file.zip', status: 'used' }],
      },
    ],
    errorCode: null,
    errorMessage: null,
    followedBy: null,
    following: null,
    belongsTo: null,
    bitfield: '',
    infoHash: null,
    numSeeders: '0',
    seeder: 'false',
    pieceLength: '0',
    numPieces: '0',
    verifiedLength: '0',
    verifyIntegrityPending: 'false',
    options: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tabId: null,
    ruleId: null,
    ...overrides,
  };
}

describe('createMethodMap', () => {
  let methods: ReturnType<typeof createMethodMap>;
  let mockStore: any;
  let mockDm: any;
  let mockWs: any;

  beforeEach(() => {
    mockStore = {
      get: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      purge: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      getAll: vi.fn().mockResolvedValue([]),
      getByBrowserId: vi.fn(),
      getPendingByUrl: vi.fn(),
    };
    mockDm = {
      create: vi.fn().mockResolvedValue('abcd123400000001'),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      getTask: vi.fn(),
      getGlobalStat: vi.fn().mockResolvedValue({
        downloadSpeed: '0',
        uploadSpeed: '0',
        numActive: '0',
        numWaiting: '0',
        numStopped: '0',
        numStoppedTotal: '0',
      }),
    };
    mockWs = {
      broadcast: vi.fn(),
    };

    const ctx = {
      downloadManager: mockDm as any,
      taskStore: mockStore as any,
      wsBridge: mockWs as any,
      globalOptions: {} as any,
      sessionId: 'test-session-001',
    };

    methods = createMethodMap(ctx);
  });

  describe('aria2.getVersion', () => {
    it('returns version info', async () => {
      const result = await methods['aria2.getVersion']([]);
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('enabledFeatures');
      expect(result.enabledFeatures).toContain('HTTP');
      expect(result.enabledFeatures).not.toContain('BitTorrent');
    });
  });

  describe('aria2.addUri', () => {
    it('calls downloadManager.create', async () => {
      const result = await methods['aria2.addUri']([
        ['https://example.com/file.zip'],
        { dir: '/downloads' },
      ]);
      expect(result).toBe('abcd123400000001');
      expect(mockDm.create).toHaveBeenCalledWith({
        uris: ['https://example.com/file.zip'],
        headers: undefined,
        dir: '/downloads',
        out: undefined,
        split: undefined,
      });
    });

    it('validates params', async () => {
      await expect(methods['aria2.addUri']([])).rejects.toHaveProperty('code', -32602);
    });
  });

  describe('aria2.tellStatus', () => {
    it('returns task status', async () => {
      const task = mockTask();
      mockStore.get.mockResolvedValue(task);

      const result = await methods['aria2.tellStatus'](['abcd123400000001']);
      expect(result).toHaveProperty('gid', 'abcd123400000001');
      expect(result).toHaveProperty('status', 'active');
      expect(result).toHaveProperty('totalLength', '1024000');
      expect(result).toHaveProperty('completedLength', '512000');
      expect(result).toHaveProperty('downloadSpeed', '102400');
    });

    it('returns error for unknown GID', async () => {
      mockStore.get.mockResolvedValue(undefined);
      await expect(
        methods['aria2.tellStatus'](['nonexistent'])
      ).rejects.toHaveProperty('code', 1);
    });
  });

  describe('aria2.tellActive', () => {
    it('returns active tasks', async () => {
      const task = mockTask();
      mockStore.query.mockResolvedValue([task]);
      const result = await methods['aria2.tellActive']([]);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('gid', 'abcd123400000001');
    });
  });

  describe('aria2.remove', () => {
    it('cancels and removes task', async () => {
      mockStore.get.mockResolvedValue(mockTask());
      const result = await methods['aria2.remove'](['abcd123400000001']);
      expect(result).toBe('abcd123400000001');
      expect(mockDm.cancel).toHaveBeenCalledWith('abcd123400000001');
    });
  });

  describe('aria2.pause', () => {
    it('pauses a download', async () => {
      mockStore.get.mockResolvedValue(mockTask());
      const result = await methods['aria2.pause'](['abcd123400000001']);
      expect(result).toBe('abcd123400000001');
      expect(mockDm.pause).toHaveBeenCalledWith('abcd123400000001');
    });
  });

  describe('aria2.unpause', () => {
    it('resumes a download', async () => {
      mockStore.get.mockResolvedValue(mockTask());
      const result = await methods['aria2.unpause'](['abcd123400000001']);
      expect(result).toBe('abcd123400000001');
      expect(mockDm.resume).toHaveBeenCalledWith('abcd123400000001');
    });
  });

  describe('aria2.getGlobalStat', () => {
    it('returns global stats', async () => {
      mockDm.getGlobalStat.mockResolvedValue({
        downloadSpeed: '102400',
        uploadSpeed: '0',
        numActive: '2',
        numWaiting: '1',
        numStopped: '3',
        numStoppedTotal: '10',
      });
      const result = await methods['aria2.getGlobalStat']([]);
      expect(result).toHaveProperty('downloadSpeed', '102400');
      expect(result).toHaveProperty('numActive', '2');
    });
  });

  describe('aria2.addTorrent', () => {
    it('returns not supported', async () => {
      await expect(
        methods['aria2.addTorrent']([])
      ).rejects.toHaveProperty('code', 4);
    });
  });

  describe('aria2.shutdown', () => {
    it('shuts down normally', async () => {
      mockStore.query.mockResolvedValue([mockTask()]);
      const result = await methods['aria2.shutdown']([]);
      expect(result).toBe('OK');
    });
  });

  describe('aria2.purgeDownloadResult', () => {
    it('purges completed/error/removed tasks', async () => {
      const result = await methods['aria2.purgeDownloadResult']([]);
      expect(result).toBe('OK');
      expect(mockStore.purge).toHaveBeenCalledWith('complete');
      expect(mockStore.purge).toHaveBeenCalledWith('error');
      expect(mockStore.purge).toHaveBeenCalledWith('removed');
    });
  });
});
