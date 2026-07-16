const LOG_PREFIX = "[ContentBridge]";

export default defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_start",
    // ISOLATED world (default) — bridges MAIN world to background
    main() {
        console.log(`${LOG_PREFIX} Bridge initializing`);

        window.addEventListener("aria2-shim-request", async (e) => {
            const detail = (e as CustomEvent).detail;
            const { _requestId, body } = detail;

            try {
                const response = await browser.runtime.sendMessage({
                    type: "aria2-rpc",
                    payload: body,
                });
                window.dispatchEvent(new CustomEvent("aria2-shim-response", {
                    detail: { _requestId, data: response },
                }));
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                window.dispatchEvent(new CustomEvent("aria2-shim-response", {
                    detail: {
                        _requestId,
                        error: message,
                        data: {
                            jsonrpc: "2.0",
                            id: body?.id ?? null,
                            error: { code: -32603, message },
                        },
                    },
                }));
            }
        });

        console.log(`${LOG_PREFIX} Bridge ready`);
    },
});
