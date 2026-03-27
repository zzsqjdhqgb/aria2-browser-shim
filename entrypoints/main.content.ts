// entrypoints/content.ts
const LOG_PREFIX = "[ContentMain]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "MAIN",
    main() {
        console.log(`${LOG_PREFIX} Initializing interceptors on ${window.location.href}`);

        // ============ 拦截 fetch ============
        const originalFetch = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

            if (url.includes("localhost:6800") || url.includes("127.0.0.1:6800")) {
                console.log(`${LOG_PREFIX} Intercepted fetch to ${url}`);
                return handleAria2Request(init?.body as string);
            }

            return originalFetch.call(this, input, init);
        };

        // ============ 拦截 XMLHttpRequest ============
        const OriginalXHR = window.XMLHttpRequest;

        class FakeXMLHttpRequest extends EventTarget {
            // ReadyState constants
            static readonly UNSENT = 0;
            static readonly OPENED = 1;
            static readonly HEADERS_RECEIVED = 2;
            static readonly LOADING = 3;
            static readonly DONE = 4;

            readonly UNSENT = 0;
            readonly OPENED = 1;
            readonly HEADERS_RECEIVED = 2;
            readonly LOADING = 3;
            readonly DONE = 4;

            readyState: number = FakeXMLHttpRequest.UNSENT;
            response: any = "";
            responseText: string = "";
            responseType: XMLHttpRequestResponseType = "";
            responseURL: string = "";
            responseXML: Document | null = null;
            status: number = 0;
            statusText: string = "";
            timeout: number = 0;
            upload: XMLHttpRequestUpload = new OriginalXHR().upload;
            withCredentials: boolean = false;

            onreadystatechange: ((this: XMLHttpRequest, ev: Event) => any) | null = null;
            onabort: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
            onerror: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
            onload: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
            onloadend: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
            onloadstart: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
            onprogress: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
            ontimeout: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;

            private _method: string = "";
            private _url: string = "";
            private _async: boolean = true;
            private _requestHeaders: Record<string, string> = {};
            private _responseHeaders: Record<string, string> = {};
            private _intercepted: boolean = false;
            private _aborted: boolean = false;
            private _realXHR: XMLHttpRequest | null = null;

            open(method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null): void {
                this._method = method;
                this._url = url.toString();
                this._async = async;

                if (this._url.includes("localhost:6800") || this._url.includes("127.0.0.1:6800")) {
                    this._intercepted = true;
                    console.log(`${LOG_PREFIX} Intercepted XHR ${method} to ${this._url}`);
                    this.readyState = FakeXMLHttpRequest.OPENED;
                    this._fireReadyStateChange();
                } else {
                    // 非 aria2 请求，使用真实 XHR
                    this._intercepted = false;
                    this._realXHR = new OriginalXHR();
                    this._proxyRealXHR();
                    this._realXHR.open(method, url, async, username, password);
                }
            }

            setRequestHeader(name: string, value: string): void {
                if (this._intercepted) {
                    this._requestHeaders[name] = value;
                } else {
                    this._realXHR?.setRequestHeader(name, value);
                }
            }

            send(body?: Document | XMLHttpRequestBodyInit | null): void {
                if (this._intercepted) {
                    console.log(`${LOG_PREFIX} XHR send:`, body);
                    this._handleInterceptedSend(body as string | null);
                } else {
                    this._realXHR?.send(body);
                }
            }

            abort(): void {
                if (this._intercepted) {
                    this._aborted = true;
                    this.readyState = FakeXMLHttpRequest.UNSENT;
                    const abortEvent = new ProgressEvent("abort");
                    this.onabort?.call(this as any, abortEvent);
                    this.dispatchEvent(abortEvent);
                } else {
                    this._realXHR?.abort();
                }
            }

            getResponseHeader(name: string): string | null {
                if (this._intercepted) {
                    return this._responseHeaders[name.toLowerCase()] ?? null;
                }
                return this._realXHR?.getResponseHeader(name) ?? null;
            }

            getAllResponseHeaders(): string {
                if (this._intercepted) {
                    return Object.entries(this._responseHeaders)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join("\r\n");
                }
                return this._realXHR?.getAllResponseHeaders() ?? "";
            }

            overrideMimeType(mime: string): void {
                if (!this._intercepted) {
                    this._realXHR?.overrideMimeType(mime);
                }
            }

            private async _handleInterceptedSend(bodyStr: string | null): Promise<void> {
                try {
                    const body = bodyStr ? JSON.parse(bodyStr) : null;
                    if (body) {
                        const result = await sendToBackground(body);
                        if (this._aborted) return;

                        const responseStr = JSON.stringify(result);

                        this._responseHeaders = {
                            "content-type": "application/json",
                        };

                        // HEADERS_RECEIVED
                        this.readyState = FakeXMLHttpRequest.HEADERS_RECEIVED;
                        this.status = 200;
                        this.statusText = "OK";
                        this._fireReadyStateChange();

                        // LOADING
                        this.readyState = FakeXMLHttpRequest.LOADING;
                        this._fireReadyStateChange();

                        // DONE
                        this.readyState = FakeXMLHttpRequest.DONE;
                        this.responseText = responseStr;
                        this.response = this.responseType === "json" ? result : responseStr;
                        this.responseURL = this._url;
                        this._fireReadyStateChange();

                        // Fire load events
                        const loadEvent = new ProgressEvent("load", {
                            lengthComputable: true,
                            loaded: responseStr.length,
                            total: responseStr.length,
                        });
                        this.onload?.call(this as any, loadEvent);
                        this.dispatchEvent(loadEvent);

                        const loadEndEvent = new ProgressEvent("loadend", {
                            lengthComputable: true,
                            loaded: responseStr.length,
                            total: responseStr.length,
                        });
                        this.onloadend?.call(this as any, loadEndEvent);
                        this.dispatchEvent(loadEndEvent);

                        console.log(`${LOG_PREFIX} XHR response:`, result);
                    } else {
                        this._setError();
                    }
                } catch (err) {
                    console.error(`${LOG_PREFIX} XHR handle error:`, err);
                    this._setError();
                }
            }

            private _setError(): void {
                this.readyState = FakeXMLHttpRequest.DONE;
                this.status = 400;
                this.statusText = "Bad Request";
                this.responseText = JSON.stringify({ error: "Invalid request" });
                this.response = this.responseText;
                this._fireReadyStateChange();

                const errorEvent = new ProgressEvent("error");
                this.onerror?.call(this as any, errorEvent);
                this.dispatchEvent(errorEvent);

                const loadEndEvent = new ProgressEvent("loadend");
                this.onloadend?.call(this as any, loadEndEvent);
                this.dispatchEvent(loadEndEvent);
            }

            private _fireReadyStateChange(): void {
                const event = new Event("readystatechange");
                this.onreadystatechange?.call(this as any, event);
                this.dispatchEvent(event);
            }

            private _proxyRealXHR(): void {
                if (!this._realXHR) return;
                const self = this;
                const xhr = this._realXHR;

                // Proxy event handlers
                const events = ["readystatechange", "abort", "error", "load", "loadend", "loadstart", "progress", "timeout"] as const;

                xhr.onreadystatechange = function () {
                    self.readyState = xhr.readyState;
                    if (xhr.readyState >= FakeXMLHttpRequest.HEADERS_RECEIVED) {
                        self.status = xhr.status;
                        self.statusText = xhr.statusText;
                    }
                    if (xhr.readyState === FakeXMLHttpRequest.DONE) {
                        self.response = xhr.response;
                        self.responseText = xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : "";
                        self.responseURL = xhr.responseURL;
                        self.responseXML = xhr.responseType === "" || xhr.responseType === "document" ? xhr.responseXML : null;
                    }
                    self.onreadystatechange?.call(self as any, new Event("readystatechange"));
                    self.dispatchEvent(new Event("readystatechange"));
                };

                const proxyEvent = (eventName: string) => {
                    xhr.addEventListener(eventName, (e) => {
                        const handler = (self as any)[`on${eventName}`];
                        if (typeof handler === "function") {
                            handler.call(self, e);
                        }
                        self.dispatchEvent(new ProgressEvent(eventName, e as ProgressEventInit));
                    });
                };

                ["abort", "error", "load", "loadend", "loadstart", "progress", "timeout"].forEach(proxyEvent);
            }
        }

        // 替换全局 XMLHttpRequest
        window.XMLHttpRequest = FakeXMLHttpRequest as any;

        // ============ 拦截 WebSocket ============
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

            readyState: number = FakeWebSocket.CONNECTING;
            url: string;
            protocol: string = "";
            extensions: string = "";
            bufferedAmount: number = 0;
            binaryType: BinaryType = "blob";

            onopen: ((ev: Event) => void) | null = null;
            onclose: ((ev: CloseEvent) => void) | null = null;
            onmessage: ((ev: MessageEvent) => void) | null = null;
            onerror: ((ev: Event) => void) | null = null;

            constructor(url: string | URL, protocols?: string | string[]) {
                super();
                this.url = url.toString();
                console.log(`${LOG_PREFIX} Intercepted WebSocket connection to ${this.url}`);

                // 模拟异步连接成功
                setTimeout(() => {
                    this.readyState = FakeWebSocket.OPEN;
                    const openEvent = new Event("open");
                    this.onopen?.(openEvent);
                    this.dispatchEvent(openEvent);
                    console.log(`${LOG_PREFIX} Fake WebSocket opened`);
                }, 0);
            }

            send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
                if (this.readyState !== FakeWebSocket.OPEN) {
                    throw new DOMException("WebSocket is not open", "InvalidStateError");
                }

                console.log(`${LOG_PREFIX} WebSocket send:`, data);

                // 处理消息并返回响应
                this.handleMessage(data as string);
            }

            private async handleMessage(data: string): Promise<void> {
                try {
                    const response = await sendToBackground(JSON.parse(data));
                    const messageEvent = new MessageEvent("message", {
                        data: JSON.stringify(response),
                    });

                    console.log(`${LOG_PREFIX} WebSocket response:`, response);
                    this.onmessage?.(messageEvent);
                    this.dispatchEvent(messageEvent);
                } catch (err) {
                    console.error(`${LOG_PREFIX} WebSocket handle error:`, err);
                }
            }

            close(code?: number, reason?: string): void {
                console.log(`${LOG_PREFIX} WebSocket close requested`);
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
        }

        // 替换全局 WebSocket（仅针对 aria2 地址）
        window.WebSocket = new Proxy(OriginalWebSocket, {
            construct(target, args: [string | URL, (string | string[])?]) {
                const url = args[0].toString();

                if (url.includes("localhost:6800") || url.includes("127.0.0.1:6800")) {
                    console.log(`${LOG_PREFIX} Creating fake WebSocket for aria2`);
                    return new FakeWebSocket(url, args[1]);
                }

                // 其他 WebSocket 正常创建
                return new target(...args);
            },
        }) as typeof WebSocket;

        // ============ 通用处理函数 ============

        async function sendToBackground(body: unknown): Promise<unknown> {
            const requestId = crypto.randomUUID();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    reject(new Error("Request timeout"));
                }, 30000);

                const handler = (e: CustomEvent) => {
                    if (e.detail?._requestId !== requestId) return;
                    clearTimeout(timeout);
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    resolve(e.detail.data);
                };

                window.addEventListener("aria2-shim-response", handler as EventListener);
                window.dispatchEvent(
                    new CustomEvent("aria2-shim-request", {
                        detail: { _requestId: requestId, body }
                    })
                );
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
                console.error(`${LOG_PREFIX} Handle request error:`, e);
            }

            return new Response(JSON.stringify({ error: "Invalid request" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        console.log(`${LOG_PREFIX} Fetch, XHR, and WebSocket interceptors installed`);
    },
});