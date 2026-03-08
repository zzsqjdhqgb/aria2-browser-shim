// entrypoints/background.ts
import { handleAria2Request } from "@/shim/aria2-interceptor";

const LOG_PREFIX = "[Background]";

export default defineBackground(() => {
    console.log(`${LOG_PREFIX} aria2-browser-shim background loaded`);

    // 监听来自 content script 或 popup 的消息
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log(`${LOG_PREFIX} Received message`, {
            type: message?.type,
            senderId: sender.tab?.id,
            senderUrl: sender.tab?.url,
        });

        if (message?.type === "aria2-rpc") {
            console.log(`${LOG_PREFIX} Processing aria2-rpc message`, message.payload);

            handleAria2Request(message.payload)
                .then((response) => {
                    console.log(`${LOG_PREFIX} aria2-rpc response`, response);
                    sendResponse(response);
                })
                .catch((err) => {
                    console.error(`${LOG_PREFIX} aria2-rpc error`, err);
                    sendResponse({ error: err.message });
                });
            return true; // 异步响应
        }

        console.log(`${LOG_PREFIX} Unknown message type: ${message?.type}`);
    });

    console.log(`${LOG_PREFIX} Message listener registered`);
});