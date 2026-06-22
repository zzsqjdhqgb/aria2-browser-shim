import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROMIUM_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

export const test = base.extend<{ extensionId: string; context: BrowserContext }>({
  context: async ({ }, use) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const extensionPath = path.resolve(__dirname, '../../.output/chrome-mv3');

    const context = await chromium.launchPersistentContext('', {
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...CHROMIUM_ARGS,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let extensionId = '';

    // Wait for the service worker to be ready, then extract the extension ID.
    try {
      const worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
      extensionId = worker.url().split('/')[2];
    } catch {
      // In headless CI environments the service worker may not start.
      // Fall back to extracting the extension ID from the background page.
      const pages = context.pages();
      if (pages.length > 0) {
        const url = pages[0].url();
        const match = url.match(/chrome-extension:\/\/([^/]+)/);
        if (match) {
          extensionId = match[1];
        }
      }
    }

    await use(extensionId);
  },
});

export const expect = test.expect;
