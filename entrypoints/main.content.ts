export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const TARGETS = ['localhost:6800', '127.0.0.1:6800'];
    const REQUEST_TIMEOUT_MS = 30_000;

    function isAria2Target(url: string): boolean {
      try {
        const u = new URL(url, location.origin);
        return TARGETS.some((t) => {
          const [host, port] = t.split(':');
          return u.hostname === host && u.port === port;
        });
      } catch {
        return false;
      }
    }

    // Use document as the shared event target (works even at document_start
    // when documentElement is not yet available)
    const bus = document;

    let requestCounter = 0;
    const pendingRequests = new Map<number, {
      resolve: (value: string) => void;
      reject: (reason: Error) => void;
    }>();

    bus.addEventListener('__aria2shim_response__', ((e: CustomEvent) => {
      const { requestId, result, error, data } = e.detail;
      const pending = pendingRequests.get(requestId);
      if (!pending) return;

      pendingRequests.delete(requestId);

      if (error) {
        pending.reject(new Error(error.message || 'RPC error'));
        return;
      }

      pending.resolve(data !== undefined ? data : JSON.stringify(result));
    }) as EventListener);

    bus.addEventListener('__aria2shim_wsevent__', ((e: CustomEvent) => {
      const { wsId, method, params } = e.detail;
      const ws = wsInstances.get(wsId);
      if (!ws) return;

      if (method === 'close') {
        ws.readyState = 3;
        if (ws.onclose) ws.onclose(new CloseEvent('close', { code: 1000 }));
        wsInstances.delete(wsId);
        return;
      }

      if (method === 'error') {
        if (ws.onerror) ws.onerror(new Event('error'));
        return;
      }

      if (ws.onmessage) {
        const eventData = params ? JSON.stringify(params[0]) : '';
        ws.onmessage(new MessageEvent('message', { data: eventData }));
      }
    }) as EventListener);

    function sendRequest(type: string, payload: unknown): Promise<string> {
      return new Promise((resolve, reject) => {
        const requestId = ++requestCounter;

        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });

        bus.dispatchEvent(new CustomEvent('__aria2shim_request__', {
          detail: { requestId, type, payload },
        }));
      });
    }

    // Intercept fetch
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isAria2Target(url)) {
        const body = init?.body;
        let parsed: unknown;
        try {
          parsed = typeof body === 'string' ? JSON.parse(body) : body;
        } catch {
          parsed = body;
        }
        return sendRequest('rpc', parsed).then((result) => {
          return new Response(result as BodyInit, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }) as Promise<Response>;
      }
      return originalFetch(input, init);
    };

    // Intercept XMLHttpRequest
    const OrigXHR = window.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSetRequestHeader = OrigXHR.prototype.setRequestHeader;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ) {
      const urlStr = url.toString();
      (this as any).__aria2shim_target__ = isAria2Target(urlStr);
      (this as any).__aria2shim_method__ = method;
      (this as any).__aria2shim_url__ = urlStr;
      if (!(this as any).__aria2shim_target__) {
        return origOpen.call(this, method, url, async, username, password) as any;
      }
    };

    OrigXHR.prototype.setRequestHeader = function (name: string, value: string) {
      if ((this as any).__aria2shim_target__) return;
      origSetRequestHeader.call(this, name, value);
    };

    OrigXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if (!(this as any).__aria2shim_target__) {
        return origSend.call(this, body);
      }

      const xhr = this;
      let parsed: unknown;
      try {
        parsed = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        parsed = body;
      }

      sendRequest('rpc', parsed)
        .then((result) => {
          Object.defineProperty(xhr, 'readyState', { value: 4, writable: true });
          Object.defineProperty(xhr, 'status', { value: 200, writable: true });
          Object.defineProperty(xhr, 'responseText', { value: result, writable: true });
          let responseValue: unknown = result;
          try { responseValue = JSON.parse(result); } catch {}
          Object.defineProperty(xhr, 'response', { value: responseValue, writable: true });
          if (xhr.onload) xhr.onload(new ProgressEvent('load'));
          if (xhr.onreadystatechange) xhr.onreadystatechange(new Event('readystatechange'));
        })
        .catch((_err) => {
          if (xhr.onerror) xhr.onerror(new ProgressEvent('error'));
        });
    };

    // Intercept WebSocket
    const wsInstances = new Map<number, FakeWebSocket>();
    let wsIdCounter = 0;

    class FakeWebSocket extends EventTarget {
      readonly url: string;
      readyState: number = 0;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      onopen: ((ev: Event) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      private wsId: number;

      constructor(url: string) {
        super();
        this.url = url;
        this.wsId = ++wsIdCounter;
        wsInstances.set(this.wsId, this);

        bus.dispatchEvent(new CustomEvent('__aria2shim_wsconnect__', {
          detail: { wsId: this.wsId, url },
        }));

        setTimeout(() => {
          this.readyState = 1;
          if (this.onopen) this.onopen(new Event('open'));
        }, 0);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.readyState !== 1) throw new Error('WebSocket is not open');

        let body: unknown;
        try {
          body = typeof data === 'string' ? JSON.parse(data) : data;
        } catch {
          body = data;
        }

        sendRequest('ws-rpc', { wsId: this.wsId, payload: body });
      }

      close(code?: number, reason?: string): void {
        if (this.readyState === 3) return;
        this.readyState = 3;

        bus.dispatchEvent(new CustomEvent('__aria2shim_wsclose__', {
          detail: { wsId: this.wsId, code, reason },
        }));

        wsInstances.delete(this.wsId);
      }
    }

    (window as any).WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const url = args[0] as string;
        if (isAria2Target(url)) {
          return new FakeWebSocket(url);
        }
        return new target(url, args[1]);
      },
    });
  },
});
