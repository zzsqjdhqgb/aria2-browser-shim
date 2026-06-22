import type { MethodRegistry } from '../dispatcher';

class NotSupportedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not supported — this is a browser-based aria2 emulator`);
    this.name = 'NotSupportedError';
  }
}

export function register(registry: MethodRegistry): void {
  registry.register('aria2.addTorrent', async () => {
    throw new NotSupportedError('BitTorrent');
  });
}
