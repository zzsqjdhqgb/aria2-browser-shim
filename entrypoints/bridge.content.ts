// entrypoints/content-bridge.ts
const LOG_PREFIX = "[ContentBridge]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    main() {
        console.log(`${LOG_PREFIX} Content bridge initializing`);

        // 监听来自 MAIN world 的请求
        window.addEventListener("aria2-shim-request", async (e) => {
            const payload = (e as CustomEvent).detail;
            console.log(`${LOG_PREFIX} Received aria2-shim-request`, payload);

            try {
                console.log(`${LOG_PREFIX} Sending message to background`);
                const response = await browser.runtime.sendMessage({
                    type: "aria2-rpc",
                    payload,
                });
                console.log(`${LOG_PREFIX} Received response from background`, response);

                window.dispatchEvent(
                    new CustomEvent("aria2-shim-response", { detail: response })
                );
                console.log(`${LOG_PREFIX} Dispatched aria2-shim-response`);
            } catch (err) {
                console.error(`${LOG_PREFIX} Error sending message to background`, err);
                window.dispatchEvent(
                    new CustomEvent("aria2-shim-response", {
                        detail: { jsonrpc: "2.0", id: payload?.id, error: { code: -32603, message: String(err) } },
                    })
                );
            }
        });

        console.log(`${LOG_PREFIX} Content bridge ready`);
    },
});