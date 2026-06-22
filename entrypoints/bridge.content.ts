export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const LOG_PREFIX = "[ContentBridge]";
    console.log(LOG_PREFIX, "Initializing...");

    // Listen for requests from MAIN world
    window.addEventListener("aria2-shim-request", async (e) => {
      const detail = (e as CustomEvent).detail;
      const { _requestId, body } = detail;

      try {
        const response = await browser.runtime.sendMessage({
          type: "aria2-rpc",
          payload: body,
        });

        window.dispatchEvent(
          new CustomEvent("aria2-shim-response", {
            detail: { _requestId, data: response },
          }),
        );
      } catch (err) {
        console.error(LOG_PREFIX, "Error sending to background", err);
        window.dispatchEvent(
          new CustomEvent("aria2-shim-response", {
            detail: {
              _requestId,
              data: {
                jsonrpc: "2.0",
                id: body?.id ?? null,
                error: {
                  code: -32603,
                  message: err instanceof Error ? err.message : String(err),
                },
              },
            },
          }),
        );
      }
    });

    console.log(LOG_PREFIX, "Ready");
  },
});
