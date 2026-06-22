import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';
import type { DownloadRequest } from '../../types';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.addUri', async (params: unknown[], ctx: HandlerContext) => {
    const uris = params[0] as string[];
    if (!uris || uris.length === 0) {
      throw new Error('No URIs provided');
    }

    const options = (params[1] as Record<string, unknown>) ?? {};

    // Parse headers: split "Key: Value" on first ":"
    let headers: Record<string, string> | undefined;
    if (Array.isArray(options.header)) {
      headers = {};
      for (const h of options.header) {
        const colonIndex = h.indexOf(':');
        if (colonIndex > 0) {
          const key = h.slice(0, colonIndex).trim();
          const value = h.slice(colonIndex + 1).trim();
          headers[key] = value;
        }
      }
    }

    const request: DownloadRequest = {
      url: uris[0],
      filename: typeof options.out === 'string' ? options.out : undefined,
      directory: typeof options.dir === 'string' ? options.dir : undefined,
      headers,
    };

    const gid = await ctx.downloadManager.create(request);
    return gid;
  });
}
