import { handleAria2Request } from "@/core/aria2-handler";
import { setEnabled } from "@/core/storage";
import { downloadManager } from "@/core/download-manager";

const LOG_PREFIX = "[Background]";

export default defineBackground(() => {
    console.log(`${LOG_PREFIX} Aria2 Browser Shim service worker started`);
    downloadManager.init();

    // Listen for RPC messages from content bridge
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "aria2-rpc") {
            handleAria2Request(message.payload)
                .then((response) => sendResponse(response))
                .catch((err) =>
                    sendResponse({
                        jsonrpc: "2.0",
                        id: null,
                        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
                    }),
                );
            return true; // async response
        }

        if (message?.type === "set-enabled") {
            const enabled = Boolean(message.enabled);
            setEnabled(enabled).then(() => {
                if (!enabled) {
                    downloadManager.cancelAll();
                }
                sendResponse({ success: true, enabled });
            });
            return true;
        }

        if (message?.type === "get-enabled") {
            import("@/core/storage").then(({ isEnabled }) => {
                isEnabled().then((enabled) => sendResponse({ enabled }));
            });
            return true;
        }
    });

    // Clean up when service worker is about to be terminated (best effort)
    self.addEventListener("beforeunload", () => {
        console.log(`${LOG_PREFIX} Service worker terminating, cleaning up...`);
        downloadManager.destroy();
    });

    console.log(`${LOG_PREFIX} Ready`);
});
