import type { MethodRegistry } from '../dispatcher';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.changeGlobalOption', async () => {
    return 'OK';
  });
}
