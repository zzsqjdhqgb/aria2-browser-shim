import type { MethodRegistry } from '../dispatcher';

class NotSupportedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not supported — this is a browser-based aria2 emulator`);
    this.name = 'NotSupportedError';
  }
}

export function register(registry: MethodRegistry): void {
  registry.register('aria2.addMetalink', async () => {
    throw new NotSupportedError('Metalink');
  });
}
