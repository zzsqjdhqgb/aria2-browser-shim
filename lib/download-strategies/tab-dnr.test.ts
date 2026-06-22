import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DownloadRequest, DownloadTask, DownloadResult } from '../types';
import { TabDnrStrategy } from './tab-dnr';

// Mock the browser global
const mockBrowser = {
  tabs: {
    create: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  declarativeNetRequest: {
    updateSessionRules: vi.fn().mockResolvedValue(undefined),
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).browser = mockBrowser;

function createDownloadRequest(overrides: Partial<DownloadRequest> = {}): DownloadRequest {
  return {
    url: 'https://example.com/file.zip',
    filename: 'file.zip',
    headers: {},
    ...overrides,
  };
}

function createDownloadTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    gid: '48a1b2c30000002d',
    request: createDownloadRequest(),
    status: 'pending',
    bytesReceived: 0,
    totalBytes: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// Helper to build the Content-Disposition value we expect
function expectedContentDisposition(task: DownloadTask): string {
  const filename = task.request.filename ?? '';
  const basename = filename.split('/').pop() ?? '';
  if (basename && basename !== '') {
    return `attachment; filename="${basename}"`;
  }
  return 'attachment';
}

describe('TabDnrStrategy', () => {
  let strategy: TabDnrStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new TabDnrStrategy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================
  // name
  // =========================================================
  describe('name', () => {
    it('is "tab-dnr"', () => {
      expect(strategy.name).toBe('tab-dnr');
    });
  });

  // =========================================================
  // canHandle
  // =========================================================
  describe('canHandle', () => {
    it('returns true for https URLs', () => {
      const request = createDownloadRequest({ url: 'https://example.com/file.zip' });
      expect(strategy.canHandle(request)).toBe(true);
    });

    it('returns true for http URLs', () => {
      const request = createDownloadRequest({ url: 'http://example.com/file.zip' });
      expect(strategy.canHandle(request)).toBe(true);
    });

    it('returns false for ftp URLs', () => {
      const request = createDownloadRequest({ url: 'ftp://example.com/file.zip' });
      expect(strategy.canHandle(request)).toBe(false);
    });

    it('returns false for magnet URLs', () => {
      const request = createDownloadRequest({ url: 'magnet:?xt=urn:btih:abcdef' });
      expect(strategy.canHandle(request)).toBe(false);
    });

    it('returns false for data URLs', () => {
      const request = createDownloadRequest({ url: 'data:text/plain,hello' });
      expect(strategy.canHandle(request)).toBe(false);
    });

    it('returns false for blob URLs', () => {
      const request = createDownloadRequest({ url: 'blob:https://example.com/uuid' });
      expect(strategy.canHandle(request)).toBe(false);
    });

    it('returns false for empty string URL', () => {
      const request = createDownloadRequest({ url: '' });
      expect(strategy.canHandle(request)).toBe(false);
    });

    it('returns false for URL without protocol', () => {
      const request = createDownloadRequest({ url: 'example.com/file.zip' });
      expect(strategy.canHandle(request)).toBe(false);
    });
  });

  // =========================================================
  // execute
  // =========================================================
  describe('execute', () => {
    it('returns { success: true } on successful execution', async () => {
      const task = createDownloadTask();
      const result: DownloadResult = await strategy.execute(task.request, task);

      expect(result).toEqual({ success: true });
    });

    it('calls declarativeNetRequest.updateSessionRules to add a rule', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(1);
      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      expect(callArgs).toHaveProperty('addRules');
      expect(callArgs.addRules).toHaveLength(1);
    });

    it('creates a rule with urlFilter matching the request URL', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];

      expect(rule.condition.urlFilter).toBe('https://example.com/file.zip');
      expect(rule.condition.resourceTypes).toEqual(['main_frame']);
    });

    it('injects Content-Disposition header with attachment', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const responseHeaders = rule.action.responseHeaders ?? rule.action.type?.responseHeaders;

      // Find the Content-Disposition header
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      expect(cdHeader).toBeDefined();
      expect(cdHeader.value).toBe(expectedContentDisposition(task));
    });

    it('uses basename from filename for Content-Disposition', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/path/to/file.zip',
          filename: 'downloads/subdir/file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      expect(cdHeader.value).toBe('attachment; filename="file.zip"');
    });

    it('uses just "attachment" when no filename provided', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: undefined,
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      expect(cdHeader.value).toBe('attachment');
    });

    it('injects request headers from request.headers', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
          headers: {
            Authorization: 'Bearer token123',
            'X-Custom': 'value',
          },
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const requestHeaders: Array<{ header: string; operation: string; value: string }> =
        rule.action.requestHeaders ?? [];

      expect(requestHeaders).toHaveLength(2);

      const authHeader = requestHeaders.find((h) => h.header === 'Authorization');
      expect(authHeader).toBeDefined();
      expect(authHeader!.operation).toBe('set');
      expect(authHeader!.value).toBe('Bearer token123');

      const customHeader = requestHeaders.find((h) => h.header === 'X-Custom');
      expect(customHeader).toBeDefined();
      expect(customHeader!.operation).toBe('set');
      expect(customHeader!.value).toBe('value');
    });

    it('handles empty request headers gracefully', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          headers: {},
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      expect(rule.action.requestHeaders ?? []).toHaveLength(0);
    });

    it('opens a background tab with the request URL', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      expect(mockBrowser.tabs.create).toHaveBeenCalledTimes(1);
      expect(mockBrowser.tabs.create).toHaveBeenCalledWith({
        url: 'https://example.com/file.zip',
        active: false,
      });
    });

    it('returns { success: false, error } when DNR updateSessionRules throws', async () => {
      mockBrowser.declarativeNetRequest.updateSessionRules.mockRejectedValueOnce(
        new Error('DNR failed')
      );

      const task = createDownloadTask();
      const result: DownloadResult = await strategy.execute(task.request, task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DNR failed');
    });

    it('returns { success: false, error } when tabs.create throws', async () => {
      mockBrowser.tabs.create.mockRejectedValueOnce(new Error('Tab creation failed'));

      const task = createDownloadTask();
      const result: DownloadResult = await strategy.execute(task.request, task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tab creation failed');
    });

    it('handles non-Error rejections (string)', async () => {
      mockBrowser.declarativeNetRequest.updateSessionRules.mockRejectedValueOnce(
        'string error'
      );

      const task = createDownloadTask();
      const result: DownloadResult = await strategy.execute(task.request, task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('handles non-Error rejections (object)', async () => {
      mockBrowser.declarativeNetRequest.updateSessionRules.mockRejectedValueOnce({
        message: 'nested error',
      });

      const task = createDownloadTask();
      const result: DownloadResult = await strategy.execute(task.request, task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // =========================================================
  // cancel
  // =========================================================
  describe('cancel', () => {
    it('removes the DNR rule by ruleId when the task was previously executed', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      // The rule should have been added with ruleId 1 (first rule)
      expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(1);

      await strategy.cancel(task);

      // Now we expect updateSessionRules called again with removeRuleIds
      expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(2);
      const removeCallArgs =
        mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[1][0];
      expect(removeCallArgs).toHaveProperty('removeRuleIds');
      expect(removeCallArgs.removeRuleIds).toHaveLength(1);
      expect(removeCallArgs.removeRuleIds[0]).toBeGreaterThan(0);
    });

    it('does not throw when cancel called on a task that was not executed', async () => {
      const task = createDownloadTask();

      await expect(strategy.cancel(task)).resolves.toBeUndefined();
    });

    it('handles DNR removeRuleIds failure gracefully (string error)', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
        }),
      });

      // First execute to create the rule
      await strategy.execute(task.request, task);

      // Then make remove fail with a string (non-Error)
      mockBrowser.declarativeNetRequest.updateSessionRules.mockRejectedValueOnce(
        'remove failed'
      );

      // cancel should not throw
      await expect(strategy.cancel(task)).resolves.toBeUndefined();
    });
  });

  // =========================================================
  // cleanupOnMatched
  // =========================================================
  describe('cleanupOnMatched', () => {
    it('removes the DNR rule via cancel', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      // Clear the mock to isolate the cleanup call
      const callCountBeforeCleanup =
        mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls.length;

      await strategy.cleanupOnMatched(task);

      const callCountAfterCleanup =
        mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls.length;
      expect(callCountAfterCleanup).toBe(callCountBeforeCleanup + 1);

      const removeCallArgs =
        mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[
          callCountAfterCleanup - 1
        ][0];
      expect(removeCallArgs).toHaveProperty('removeRuleIds');
    });

    it('does not throw when called on a task without a ruleId', async () => {
      const task = createDownloadTask();

      await expect(strategy.cleanupOnMatched(task)).resolves.toBeUndefined();
    });
  });

  // =========================================================
  // buildFilename (tested indirectly via Content-Disposition)
  // =========================================================
  describe('Content-Disposition filename sanitization', () => {
    it('strips leading slashes from filename', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: '/downloads/file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      expect(cdHeader.value).not.toContain('//');
    });

    it('replaces .. with _ in filename path', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: '/downloads/../file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      // After sanitization, .. is replaced with _
      expect(cdHeader.value).not.toContain('..');
    });

    it('handles directory in buildFilename correctly', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          directory: '/downloads/stuff',
          filename: 'file.zip',
        }),
      });

      // directory + filename should not break anything; Content-Disposition
      // still uses the basename of filename
      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      expect(cdHeader.value).toBe('attachment; filename="file.zip"');
    });

    it('handles filename with only dots gracefully', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: '..',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      // .. becomes _ _ or __ after sanitization
      expect(cdHeader.value).not.toContain('.'); // all dots replaced
    });

    it('handles directory containing only slashes', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          directory: '///',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      expect(cdHeader.value).toBe('attachment; filename="file.zip"');
    });

    it('handles directory containing only dots', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          directory: '..',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      // ".." replaced with "__" for directory part, basename of filename still used
      expect(cdHeader.value).toBe('attachment; filename="file.zip"');
    });

    it('handles undefined headers in request', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          headers: undefined,
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      expect(rule.action.requestHeaders ?? []).toHaveLength(0);
    });

    it('handles filename that becomes empty after sanitization (only slashes)', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: '///',
        }),
      });

      await strategy.execute(task.request, task);

      const callArgs = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const rule = callArgs.addRules[0];
      const cdHeader = (rule.action.responseHeaders ?? []).find(
        (h: { header: string; operation: string; value: string }) =>
          h.header.toLowerCase() === 'content-disposition'
      );
      // No basename available, should fall back to plain "attachment"
      expect(cdHeader.value).toBe('attachment');
    });
  });

  // =========================================================
  // Rule ID uniqueness
  // =========================================================
  describe('rule ID assignment', () => {
    it('assigns incrementing rule IDs for consecutive executions', async () => {
      const task1 = createDownloadTask({
        gid: '48a1b2c300000001',
        request: createDownloadRequest({
          url: 'https://example.com/file1.zip',
          filename: 'file1.zip',
        }),
      });

      const task2 = createDownloadTask({
        gid: '48a1b2c300000002',
        request: createDownloadRequest({
          url: 'https://example.com/file2.zip',
          filename: 'file2.zip',
        }),
      });

      await strategy.execute(task1.request, task1);
      await strategy.execute(task2.request, task2);

      // First rule should have ID 1, second should have ID 2
      const call1 = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0];
      const call2 = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[1][0];

      expect(call1.addRules[0].id).toBe(1);
      expect(call2.addRules[0].id).toBe(2);
    });

    it('removes the correct ruleId when cancelling second of two tasks', async () => {
      const task1 = createDownloadTask({
        gid: '48a1b2c300000001',
        request: createDownloadRequest({
          url: 'https://example.com/file1.zip',
          filename: 'file1.zip',
        }),
      });

      const task2 = createDownloadTask({
        gid: '48a1b2c300000002',
        request: createDownloadRequest({
          url: 'https://example.com/file2.zip',
          filename: 'file2.zip',
        }),
      });

      await strategy.execute(task1.request, task1);
      await strategy.execute(task2.request, task2);

      // Cancel task1 specifically
      await strategy.cancel(task1);

      const removeCall =
        mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[2][0];
      expect(removeCall.removeRuleIds).toEqual([1]);
    });

    it('does not attempt to remove a ruleId twice for the same task', async () => {
      const task = createDownloadTask({
        request: createDownloadRequest({
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
        }),
      });

      await strategy.execute(task.request, task);
      await strategy.cancel(task);

      const callCountBeforeSecondCancel =
        mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls.length;

      // Second cancel should be a no-op
      await strategy.cancel(task);

      // The call count should not have increased
      expect(mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls.length).toBe(
        callCountBeforeSecondCancel
      );
    });
  });
});
