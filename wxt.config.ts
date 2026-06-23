import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Aria2 Browser Shim",
    permissions: ['downloads', 'declarativeNetRequest', 'storage', 'tabs'],
    host_permissions: ['http://localhost:6800/*', '<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['ariang/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
