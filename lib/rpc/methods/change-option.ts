import type { MethodRegistry } from '../dispatcher';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.changeOption', async () => {
    return 'OK';
  });
}
