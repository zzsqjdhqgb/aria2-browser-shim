import type { MethodRegistry } from '../dispatcher';

export function register(registry: MethodRegistry): void {
  registry.register('aria2.getVersion', async () => {
    return {
      version: '1.37.0-shim',
      enabledFeatures: ['Firefox3Cookie', 'GZip', 'HTTPS', 'Message Digest'],
    };
  });
}
