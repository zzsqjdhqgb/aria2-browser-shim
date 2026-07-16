import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Aria2 Browser Shim",
    permissions: [
      'downloads',
      'declarativeNetRequest',
      'tabs',
      'storage',
    ],
    host_permissions: [
      'http://localhost:6800/*',
      '<all_urls>' // 用于 declarativeNetRequest 注入 headers
    ],
  },
});
