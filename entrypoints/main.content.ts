import { createLogger } from "@/lib/logging";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const log = createLogger("[MainContent]");

    /**
     * Checks whether a URL targets the aria2 JSON-RPC endpoint.
     * Uses proper URL parsing to avoid substring-match false positives.
     */
    function isAria2Url(url: string): boolean {
      try {
        const parsed = new URL(url);
        return (
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
          parsed.port === "6800"
        );
      } catch {
        return false;
      }
    }

    /**
     * Sends a JSON-RPC body to the bridge via a CustomEvent and returns the
     * response.  Each request carries a unique crypto.randomUUID() requestId.
     * The response listener filters by that id and resolves the promise.
     * A 30 s timeout rejects the promise to prevent hanging forever.
     */
    function sendToBridge(body: unknown): Promise<unknown> {
      const requestId = crypto.randomUUID();

      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener("aria2-shim-response", handler);
          reject(new Error("sendToBridge: request timed out after 30s"));
        }, 30_000);

        function handler(event: Event): void {
          const detail = (event as CustomEvent).detail;
          if (!detail || detail._requestId !== requestId) return;

          clearTimeout(timeout);
          window.removeEventListener("aria2-shim-response", handler);
          resolve(detail.data);
        }

        window.addEventListener("aria2-shim-response", handler);

        window.dispatchEvent(
          new CustomEvent("aria2-shim-request", {
            detail: { _requestId: requestId, body },
          }),
        );
      });
    }

    /**
     * Constructs a synthetic fetch Response from the bridge result.
     */
    function buildFakeResponse(result: unknown): Response {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ====================================================================
    // Fetch interception
    // ====================================================================

    const originalFetch = window.fetch.bind(window);

    async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (!isAria2Url(url)) {
        return originalFetch(input, init);
      }

      let parsedBody: unknown = null;
      if (init?.body) {
        try {
          parsedBody = JSON.parse(init.body as string);
        } catch {
          // If the body is not valid JSON we still forward it — the bridge
          // or the actual aria2c would have to deal with it.
        }
      }

      const result = await sendToBridge(parsedBody ?? init?.body ?? null);
      return buildFakeResponse(result);
    }

    window.fetch = patchedFetch as typeof window.fetch;

    // ====================================================================
    // WebSocket interception
    // ====================================================================

    const OriginalWebSocket = window.WebSocket;

    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;

      url: string;
      readyState: number = FakeWebSocket.CONNECTING;

      onopen: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL, _protocols?: string | string[]) {
        super();
        this.url = url.toString();

        // Simulate an async connection as established immediately.
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          const openEvent = new Event("open");
          this.onopen?.(openEvent);
          this.dispatchEvent(openEvent);
        }, 0);
      }

      send(data: string): void {
        if (this.readyState !== FakeWebSocket.OPEN) {
          throw new DOMException(
            "WebSocket is not OPEN",
            "InvalidStateError",
          );
        }

        this.handleMessage(data);
      }

      close(code?: number, reason?: string): void {
        this.readyState = FakeWebSocket.CLOSING;

        setTimeout(() => {
          this.readyState = FakeWebSocket.CLOSED;
          const closeEvent = new CloseEvent("close", {
            code: code ?? 1000,
            reason: reason ?? "",
            wasClean: true,
          });
          this.onclose?.(closeEvent);
          this.dispatchEvent(closeEvent);
        }, 0);
      }

      private async handleMessage(data: string): Promise<void> {
        try {
          const parsed = JSON.parse(data);
          const result = await sendToBridge(parsed);

          const messageEvent = new MessageEvent("message", {
            data: JSON.stringify(result),
          });

          this.onmessage?.(messageEvent);
          this.dispatchEvent(messageEvent);
        } catch (_err: unknown) {
          const errorEvent = new Event("error");
          this.onerror?.(errorEvent);
          this.dispatchEvent(errorEvent);
        }
      }
    }

    // Proxy the global WebSocket constructor so aria2 URLs get a
    // FakeWebSocket while everything else uses the real implementation.
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(
        target,
        args: [string | URL, (string | string[])?],
      ) {
        const url = args[0].toString();

        if (isAria2Url(url)) {
          return new FakeWebSocket(url, args[1]);
        }

        return new target(...args);
      },
    }) as typeof WebSocket;

    log.debug("Injected — fetch and WebSocket interception active");
  },
});
