import type { MethodRegistry } from '../dispatcher';

const DEFAULT_GLOBAL_OPTIONS = {
  dir: '.',
  out: '',
  split: 1,
  'max-connection-per-server': 1,
  header: [],
};

export function register(registry: MethodRegistry): void {
  registry.register('aria2.getGlobalOption', async () => {
    return { ...DEFAULT_GLOBAL_OPTIONS };
  });
}
