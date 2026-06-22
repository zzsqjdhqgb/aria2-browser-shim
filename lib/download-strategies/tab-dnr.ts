import type { DownloadRequest, DownloadTask, DownloadResult, DownloadStrategy } from '../types';
import { createLogger, type Logger } from '../logging';

export class TabDnrStrategy implements DownloadStrategy {
  readonly name = 'tab-dnr';
  private logger: Logger = createLogger('[TabDnr]');
  private ruleCounter = 0;
  private ruleIdMap = new Map<string, number>();

  canHandle(request: DownloadRequest): boolean {
    const url = request.url;
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async execute(request: DownloadRequest, task: DownloadTask): Promise<DownloadResult> {
    try {
      const ruleId = ++this.ruleCounter;
      this.ruleIdMap.set(task.gid, ruleId);

      const rule = this.buildRule(request, ruleId);

      await browser.declarativeNetRequest.updateSessionRules({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        addRules: [rule as any],
      });

      await browser.tabs.create({
        url: request.url,
        active: false,
      });

      this.logger.info(`Rule ${ruleId} applied, tab opened for ${request.url}`);
      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.logger.error(`Execute failed for ${request.url}:`, message);
      return { success: false, error: message };
    }
  }

  async cancel(task: DownloadTask): Promise<void> {
    const ruleId = this.ruleIdMap.get(task.gid);
    if (ruleId === undefined) {
      return;
    }

    try {
      await browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      });
      this.ruleIdMap.delete(task.gid);
      this.logger.info(`Rule ${ruleId} removed for GID ${task.gid}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to remove rule for GID ${task.gid}:`, message);
    }
  }

  async cleanupOnMatched(task: DownloadTask): Promise<void> {
    return this.cancel(task);
  }

  private buildFilename(directory?: string, filename?: string): string | null {
    const parts: string[] = [];
    if (directory) {
      const cleaned = directory.replace(/^\/+/, '').replace(/\.\./g, '_');
      if (cleaned) {
        parts.push(cleaned);
      }
    }
    if (filename) {
      const cleaned = filename.replace(/^\/+/, '').replace(/\.\./g, '_');
      if (cleaned) {
        parts.push(cleaned);
      }
    }
    if (parts.length === 0) {
      return null;
    }
    return parts.join('/');
  }

  private buildRule(request: DownloadRequest, ruleId: number): Record<string, unknown> {
    const requestHeaders: Array<{ header: string; operation: string; value: string }> = [];

    if (request.headers) {
      for (const [header, value] of Object.entries(request.headers)) {
        requestHeaders.push({
          header,
          operation: 'set',
          value,
        });
      }
    }

    const responseHeaders: Array<{ header: string; operation: string; value: string }> = [];

    const fullPath = this.buildFilename(request.directory, request.filename);
    const basename = fullPath ? fullPath.split('/').pop() ?? null : null;

    if (basename) {
      responseHeaders.push({
        header: 'Content-Disposition',
        operation: 'set',
        value: `attachment; filename="${basename}"`,
      });
    } else {
      responseHeaders.push({
        header: 'Content-Disposition',
        operation: 'set',
        value: 'attachment',
      });
    }

    return {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders' as const,
        requestHeaders,
        responseHeaders,
      },
      condition: {
        urlFilter: request.url,
        resourceTypes: ['main_frame'],
      },
    };
  }
}
