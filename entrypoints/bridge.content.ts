// entrypoints/bridge.content.ts
const LOG_PREFIX = "[ContentBridge]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    main() {
        console.log(`${LOG_PREFIX} Content bridge initializing`);

        // 监听来自 MAIN world 的请求
        window.addEventListener("aria2-shim-request", async (e) => {
            const detail = (e as CustomEvent).detail;
            const { _requestId, body } = detail;
            console.log(`${LOG_PREFIX} Received aria2-shim-request`, { _requestId, body });

            try {
                console.log(`${LOG_PREFIX} Sending message to background`);
                const response = await browser.runtime.sendMessage({
                    type: "aria2-rpc",
                    payload: body,
                });
                console.log(`${LOG_PREFIX} Received response from background`, response);

                window.dispatchEvent(
                    new CustomEvent("aria2-shim-response", {
                        detail: { _requestId, data: response },
                    })
                );
                console.log(`${LOG_PREFIX} Dispatched aria2-shim-response`);
            } catch (err) {
                console.error(`${LOG_PREFIX} Error sending message to background`, err);
                window.dispatchEvent(
                    new CustomEvent("aria2-shim-response", {
                        detail: {
                            _requestId,
                            data: {
                                jsonrpc: "2.0",
                                id: body?.id,
                                error: { code: -32603, message: String(err) },
                            },
                        },
                    })
                );
            }
        });

        console.log(`${LOG_PREFIX} Content bridge ready`);
    },
});