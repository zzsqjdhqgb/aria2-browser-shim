import { MSG_ARIA2_RPC } from "@/lib/message-router";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 200;

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("Receiving end does not exist")
    || err.message.includes("Could not establish connection");
}

async function sendMessageWithRetry(
  message: { type: string; payload: unknown },
  retries = MAX_RETRIES,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err: unknown) {
      lastError = err;
      if (!isConnectionError(err) || attempt >= retries) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt)),
      );
    }
  }

  throw lastError;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const LOG_PREFIX = "[ContentBridge]";

    console.debug(LOG_PREFIX, "Injected — listening for aria2-shim-request events");

    window.addEventListener("aria2-shim-request", async (e) => {
      const detail = (e as CustomEvent).detail;
      const { _requestId, body } = detail;

      try {
        const response = await sendMessageWithRetry({
          type: MSG_ARIA2_RPC,
          payload: body,
        });

        window.dispatchEvent(
          new CustomEvent("aria2-shim-response", {
            detail: { _requestId, data: response },
          }),
        );
      } catch (err) {
        console.debug(LOG_PREFIX, "Error sending to background", err);
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
  },
});
