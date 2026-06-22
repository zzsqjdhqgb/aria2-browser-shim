import { test, expect } from '../fixtures/extension';

/**
 * Helper: create a blank page in the extension context and navigate to a
 * data: URL that runs a fetch test inside the page.
 *
 * The content script runs in MAIN world for `<all_urls>`, so fetch and
 * WebSocket interception apply to data: URLs as well.
 */
async function createTestPage(context: Parameters<Parameters<typeof test>[0]>[0]['context']) {
  const page = await context.newPage();
  return page;
}

// ─── Fetch interception ───────────────────────────────────────────────

test.describe('Fetch interception', () => {
  test('should intercept fetch to localhost:6800/jsonrpc and return valid JSON-RPC response', async ({ context }) => {
    const page = await createTestPage(context);

    const result = await page.evaluate(async () => {
      const response = await fetch('http://localhost:6800/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'aria2.getVersion',
          params: [],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    });

    expect(result).toBeDefined();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe('1');
    // aria2.getVersion should return an object with version and enabledFeatures
    expect(result.result).toBeDefined();
    expect(typeof result.result).toBe('object');
    expect(result.result).toHaveProperty('version');
    expect(result.result).toHaveProperty('enabledFeatures');
    expect(result.error).toBeUndefined();
  });

  test('should pass through non-aria2 URLs to original fetch', async ({ context }) => {
    const page = await createTestPage(context);

    const result = await page.evaluate(async () => {
      // Using a data: URL should go through the original fetch.
      const response = await fetch('data:application/json,%7B%22ok%22%3Atrue%7D');
      return response.json();
    });

    expect(result).toEqual({ ok: true });
  });

  test('should handle addUri RPC call via fetch', async ({ context }) => {
    const page = await createTestPage(context);

    const result = await page.evaluate(async () => {
      const response = await fetch('http://localhost:6800/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '2',
          method: 'aria2.addUri',
          params: [['https://example.com/test-file.bin']],
        }),
      });

      return response.json();
    });

    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe('2');
    expect(result.result).toBeDefined();
    // addUri returns a GID string
    expect(typeof result.result).toBe('string');
    expect((result.result as string).length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  test('should handle invalid JSON body gracefully', async ({ context }) => {
    const page = await createTestPage(context);

    const result = await page.evaluate(async () => {
      const response = await fetch('http://localhost:6800/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-valid-json',
      });

      return response.json();
    });

    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toHaveProperty('code');
    expect(result.error).toHaveProperty('message');
  });
});

// ─── WebSocket interception ───────────────────────────────────────────

test.describe('WebSocket interception', () => {
  test('should intercept WebSocket to ws://localhost:6800/jsonrpc and return a response', async ({ context }) => {
    const page = await createTestPage(context);

    const response = await page.evaluate(async () => {
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 10000);

        try {
          const ws = new WebSocket('ws://localhost:6800/jsonrpc');

          ws.onopen = () => {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: 'ws-1',
              method: 'aria2.getVersion',
              params: [],
            }));
          };

          ws.onmessage = (event) => {
            clearTimeout(timeout);
            ws.close();
            resolve(JSON.parse(event.data));
          };

          ws.onerror = (err) => {
            clearTimeout(timeout);
            reject(new Error('WebSocket error: ' + JSON.stringify(err)));
          };
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });

    const data = response as Record<string, unknown>;
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe('ws-1');
    expect(data.result).toBeDefined();
    expect((data.result as Record<string, unknown>)).toHaveProperty('version');
    expect(data.error).toBeUndefined();
  });

  test('should pass through non-aria2 WebSocket URLs to original implementation', async ({ context }) => {
    const page = await createTestPage(context);

    const result = await page.evaluate(async () => {
      // Create a WebSocket to a non-localhost:6800 URL.
      // The original WebSocket constructor should be used.
      // We verify the constructor returns a WebSocket-like object
      // (it won't connect but at least the instanceof check passes).
      try {
        const ws = new WebSocket('ws://example.invalid/socket');
        return {
          isWebSocket: ws instanceof WebSocket,
          readyState: ws.readyState,
        };
      } catch {
        return { isWebSocket: false, readyState: -1 };
      }
    });

    // The real WebSocket constructor returns a WebSocket instance even for
    // unreachable URLs (CONNECTING state).
    expect(result.isWebSocket).toBe(true);
    expect(result.readyState).toBe(0); // WebSocket.CONNECTING
  });

  test('should handle WebSocket send without open state', async ({ context }) => {
    const page = await createTestPage(context);

    const errorMessage = await page.evaluate(async () => {
      try {
        const ws = new WebSocket('ws://localhost:6800/jsonrpc');
        // Try to send before onopen fires (readyState should be CONNECTING)
        ws.send('data');
        return 'no-error';
      } catch (err) {
        return (err as DOMException).message || String(err);
      }
    });

    expect(errorMessage).toContain('OPEN');
  });
});

// ─── Error responses ──────────────────────────────────────────────────

test.describe('Error handling', () => {
  test('should return method-not-found error for unknown methods', async ({ context }) => {
    const page = await createTestPage(context);

    const result = await page.evaluate(async () => {
      const response = await fetch('http://localhost:6800/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'unknown-1',
          method: 'nonexistent.method',
          params: [],
        }),
      });

      return response.json();
    });

    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe('unknown-1');
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601); // Method not found
  });
});
