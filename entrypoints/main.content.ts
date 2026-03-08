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
            return new Promise((resolve) => {
                const handler = (e: CustomEvent) => {
                    window.removeEventListener("aria2-shim-response", handler as EventListener);
                    resolve(e.detail);
                };
                window.addEventListener("aria2-shim-response", handler as EventListener);
                
                window.dispatchEvent(
                    new CustomEvent("aria2-shim-request", { detail: body })
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

        console.log(`${LOG_PREFIX} Fetch and WebSocket interceptors installed`);
    },
});