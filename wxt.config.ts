import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: [
      'downloads',
      'declarativeNetRequest',
      'tabs',
    ],
    host_permissions: [
      'http://localhost:6800/*',
      '<all_urls>' // 用于 declarativeNetRequest 注入 headers
    ],
  },
});