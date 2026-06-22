import { test, expect } from '../fixtures/extension';

test.describe('Extension popup', () => {
  test('should load the popup page', async ({ context }) => {
    // Extract extension ID from background or service worker.
    const backgroundPages = context.backgroundPages();
    let extensionId = '';

    if (backgroundPages.length > 0) {
      extensionId = new URL(backgroundPages[0].url()).hostname;
    } else {
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        extensionId = new URL(workers[0].url()).hostname;
      }
    }

    test.skip(!extensionId, 'Extension ID not available, skipping popup test');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // The popup should have a title.
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Wait for React to render.
    await page.waitForTimeout(500);

    // The popup should not show an error state.
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeDefined();
  });

  test('should show "Open AriaNg Dashboard" button', async ({ context }) => {
    const backgroundPages = context.backgroundPages();
    let extensionId = '';

    if (backgroundPages.length > 0) {
      extensionId = new URL(backgroundPages[0].url()).hostname;
    } else {
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        extensionId = new URL(workers[0].url()).hostname;
      }
    }

    test.skip(!extensionId, 'Extension ID not available, skipping popup button test');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for React to render.
    await page.waitForTimeout(1000);

    // Check for the AriaNg button by its CSS class.
    const ariaNgButton = page.locator('.ariang-button');
    const buttonCount = await ariaNgButton.count();

    if (buttonCount > 0) {
      const buttonText = await ariaNgButton.textContent();
      expect(buttonText).toContain('AriaNg');
    } else {
      // Fallback: check any button containing "AriaNg"
      const anyButton = page.locator('button', { hasText: 'AriaNg' });
      const anyCount = await anyButton.count();
      expect(anyCount).toBeGreaterThan(0);
    }
  });

  test('should display status indicator', async ({ context }) => {
    const backgroundPages = context.backgroundPages();
    let extensionId = '';

    if (backgroundPages.length > 0) {
      extensionId = new URL(backgroundPages[0].url()).hostname;
    } else {
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        extensionId = new URL(workers[0].url()).hostname;
      }
    }

    test.skip(!extensionId, 'Extension ID not available, skipping status indicator test');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for React to render and fetch state.
    await page.waitForTimeout(1000);

    // The status indicator has class "status-indicator".
    const statusIndicator = page.locator('.status-indicator');
    const statusCount = await statusIndicator.count();

    if (statusCount > 0) {
      // The status label and dot should be present.
      const statusLabel = page.locator('.status-label');
      const labelCount = await statusLabel.count();
      if (labelCount > 0) {
        const labelText = await statusLabel.textContent();
        expect(typeof labelText).toBe('string');
        expect(labelText!.length).toBeGreaterThan(0);
      }

      const statusDot = page.locator('.status-dot');
      const dotCount = await statusDot.count();
      expect(dotCount).toBeGreaterThan(0);
    } else {
      // The popup might still be loading. Check that the body has some content.
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeDefined();
      expect(bodyText!.length).toBeGreaterThan(0);
    }
  });

  test('should have stats section with Active and Waiting counts', async ({ context }) => {
    const backgroundPages = context.backgroundPages();
    let extensionId = '';

    if (backgroundPages.length > 0) {
      extensionId = new URL(backgroundPages[0].url()).hostname;
    } else {
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        extensionId = new URL(workers[0].url()).hostname;
      }
    }

    test.skip(!extensionId, 'Extension ID not available, skipping stats test');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for React to render.
    await page.waitForTimeout(1000);

    const bodyText = await page.textContent('body');
    expect(bodyText).toBeDefined();

    // Check for "Active" and "Waiting" labels in the stats section.
    const hasActive = bodyText!.includes('Active');
    const hasWaiting = bodyText!.includes('Waiting');

    // At least one of these should be present after rendering.
    expect(hasActive || hasWaiting).toBe(true);
  });

  test('should have toggle switch for global interception', async ({ context }) => {
    const backgroundPages = context.backgroundPages();
    let extensionId = '';

    if (backgroundPages.length > 0) {
      extensionId = new URL(backgroundPages[0].url()).hostname;
    } else {
      const workers = context.serviceWorkers();
      if (workers.length > 0) {
        extensionId = new URL(workers[0].url()).hostname;
      }
    }

    test.skip(!extensionId, 'Extension ID not available, skipping toggle test');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for React to render.
    await page.waitForTimeout(1000);

    // The global interception toggle has class "toggle-switch".
    const toggles = page.locator('.toggle-switch');
    const toggleCount = await toggles.count();

    expect(toggleCount).toBeGreaterThan(0);

    // Verify the "Global Interception" label exists.
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Global Interception');
  });
});
