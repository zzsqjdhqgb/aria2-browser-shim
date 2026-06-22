import type { MethodRegistry } from '../dispatcher';
import type { HandlerContext } from '../types';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.getGlobalStat', async (_params: unknown[], ctx: HandlerContext) => {
    const allTasks = ctx.downloadManager.queryTasks({});

    let numActive = 0;
    let numWaiting = 0;
    let numStopped = 0;
    let downloadSpeed = 0;

    for (const task of allTasks) {
      switch (task.status) {
        case 'in_progress':
          numActive++;
          break;
        case 'pending':
          numWaiting++;
          break;
        case 'paused':
          numWaiting++;
          break;
        case 'complete':
        case 'error':
        case 'cancelled':
          numStopped++;
          break;
      }
    }

    return {
      numActive: String(numActive),
      numWaiting: String(numWaiting),
      numStopped: String(numStopped),
      numStoppedTotal: String(numStopped),
      downloadSpeed: String(downloadSpeed),
      uploadSpeed: '0',
    };
  });
}
