const LOG_PREFIX = "[ContentMain]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "MAIN",
    main() {
        console.log(`${LOG_PREFIX} Initializing on ${window.location.href}`);

        // =====================================================================
        // Shared: send aria2 request to background via ISOLATED world bridge
        // =====================================================================

        function sendToBackground(body: unknown): Promise<unknown> {
            const requestId = crypto.randomUUID();
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    reject(new Error("Request timeout"));
                }, 30_000);

                function handler(e: CustomEvent) {
                    if (e.detail?._requestId !== requestId) return;
                    clearTimeout(timeout);
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    const d = (e as CustomEvent).detail;
                    if (d?.error) reject(new Error(d.error));
                    else resolve(d.data);
                }

                window.addEventListener("aria2-shim-response", handler as EventListener);
                window.dispatchEvent(new CustomEvent("aria2-shim-request", {
                    detail: { _requestId: requestId, body },
                }));
            });
        }

        async function handleAria2Request(bodyStr: string | null): Promise<Response> {
            try {
                const body = bodyStr ? JSON.parse(bodyStr) : null;
                if (body) {
                    const result = await sendToBackground(body);
                    return new Response(JSON.stringify(result), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} handleAria2Request error:`, e);
            }
            return new Response(JSON.stringify({ error: "Invalid request" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // =====================================================================
        // 1. Intercept fetch()
        // =====================================================================

        const originalFetch = window.fetch;
        window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const url = typeof input === "string" ? input
                : input instanceof URL ? input.href
                : input instanceof Request ? input.url
                : String(input);

            if (url.includes("localhost:6800") || url.includes("127.0.0.1:6800")) {
                console.log(`${LOG_PREFIX} Intercepted fetch to ${url}`);
                if (init?.body) {
                    return handleAria2Request(init.body as string);
                }
                // GET request — probably a health check, return empty success
                return new Response('{"result":"OK"}', {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            return originalFetch.call(this, input, init);
        };

        // =====================================================================
        // 2. Intercept XMLHttpRequest
        // =====================================================================

        const XHRProto = XMLHttpRequest.prototype;
        const origXHROpen = XHRProto.open;
        const origXHRSend = XHRProto.send;

        XHRProto.open = function (
            method: string,
            url: string | URL,
            async?: boolean,
            user?: string | null,
            password?: string | null,
        ) {
            const urlStr = url.toString();
            const isAria2 = urlStr.includes("localhost:6800") || urlStr.includes("127.0.0.1:6800");
            (this as any).__aria2 = isAria2;
            if (!isAria2) {
                return origXHROpen.call(this, method, url, async!, user, password);
            }
            // Don't actually connect for aria2 requests
            console.log(`${LOG_PREFIX} Intercepted XHR open to ${urlStr}`);
        };

        XHRProto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
            if (!(this as any).__aria2) {
                return origXHRSend.call(this, body);
            }

            console.log(`${LOG_PREFIX} Intercepted XHR send`);
            const xhr = this as XMLHttpRequest;
            const bodyStr = typeof body === "string" ? body : null;

            handleAria2Request(bodyStr).then(async (response) => {
                const text = await response.text();
                Object.defineProperties(xhr, {
                    readyState:  { get: () => 4 },
                    status:      { get: () => 200, configurable: true },
                    statusText:  { get: () => "OK", configurable: true },
                    responseText:{ get: () => text, configurable: true },
                    response:    { get: () => text, configurable: true },
                    responseType:{ get: () => "", configurable: true },
                });
                const e = new ProgressEvent("load");
                if (xhr.onload) xhr.onload(e);
                xhr.dispatchEvent(e);
                xhr.dispatchEvent(new ProgressEvent("loadend"));
            }).catch((err) => {
                if (xhr.onerror) xhr.onerror(new ProgressEvent("error"));
                xhr.dispatchEvent(new ProgressEvent("error"));
            });
        };

        // =====================================================================
        // 3. Intercept WebSocket
        // =====================================================================

        const OriginalWebSocket = window.WebSocket;

        class FakeWebSocket extends EventTarget {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            static readonly CLOSING = 2;
            static readonly CLOSED = 3;

            readonly CONNECTING = FakeWebSocket.CONNECTING;
            readonly OPEN = FakeWebSocket.OPEN;
            readonly CLOSING = FakeWebSocket.CLOSING;
            readonly CLOSED = FakeWebSocket.CLOSED;

            readyState = FakeWebSocket.CONNECTING;
            url: string;
            protocol = "";
            extensions = "";
            bufferedAmount = 0;
            binaryType: BinaryType = "blob";

            onopen: ((ev: Event) => void) | null = null;
            onclose: ((ev: CloseEvent) => void) | null = null;
            onmessage: ((ev: MessageEvent) => void) | null = null;
            onerror: ((ev: Event) => void) | null = null;

            constructor(url: string | URL, protocols?: string | string[]) {
                super();
                this.url = url.toString();
                console.log(`${LOG_PREFIX} Fake WebSocket created for ${this.url}`);

                setTimeout(() => {
                    this.readyState = FakeWebSocket.OPEN;
                    const ev = new Event("open");
                    if (this.onopen) this.onopen(ev);
                    this.dispatchEvent(ev);
                }, 0);
            }

            send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
                if (this.readyState !== FakeWebSocket.OPEN) {
                    throw new DOMException("WebSocket is not open", "InvalidStateError");
                }
                console.log(`${LOG_PREFIX} WebSocket send`);
                this._handleMessage(data as string);
            }

            private async _handleMessage(data: string): Promise<void> {
                try {
                    const response = await sendToBackground(JSON.parse(data));
                    const ev = new MessageEvent("message", { data: JSON.stringify(response) });
                    if (this.onmessage) this.onmessage(ev);
                    this.dispatchEvent(ev);
                } catch (err) {
                    console.error(`${LOG_PREFIX} WebSocket handle error:`, err);
                    if (this.onerror) this.onerror(new Event("error"));
                }
            }

            close(code?: number, reason?: string): void {
                this.readyState = FakeWebSocket.CLOSING;
                setTimeout(() => {
                    this.readyState = FakeWebSocket.CLOSED;
                    const ev = new CloseEvent("close", {
                        code: code ?? 1000, reason: reason ?? "", wasClean: true,
                    });
                    if (this.onclose) this.onclose(ev);
                    this.dispatchEvent(ev);
                }, 0);
            }
        }

        window.WebSocket = new Proxy(OriginalWebSocket, {
            construct(_target, args: [string | URL, (string | string[])?]) {
                const urlStr = args[0].toString();
                if (urlStr.includes("localhost:6800") || urlStr.includes("127.0.0.1:6800")) {
                    console.log(`${LOG_PREFIX} Intercepted WebSocket to ${urlStr}`);
                    return new FakeWebSocket(urlStr, args[1]);
                }
                return Reflect.construct(_target, args);
            },
        }) as typeof WebSocket;

        console.log(`${LOG_PREFIX} All interceptors installed (fetch + XHR + WebSocket)`);
    },
});
