import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      alias: {
        '@': '/workspace/src',
      },
    },
  }),
  manifest: {
    name: 'Aria2 Browser Shim',
    description: 'Browser-native aria2 replacement for cloud drive userscripts',
    permissions: [
      'downloads',
      'declarativeNetRequest',
      'tabs',
      'storage',
      'unlimitedStorage',
    ],
    host_permissions: ['<all_urls>'],
  },
  webExt: false,
});
