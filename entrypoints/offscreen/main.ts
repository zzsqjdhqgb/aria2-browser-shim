// entrypoints/offscreen/main.ts
const LOG_PREFIX = "[Offscreen]";

console.log(`${LOG_PREFIX} Offscreen document loading...`);

// 监听来自 background 的消息
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log(`${LOG_PREFIX} Received message`, message);

    if (message?.type === "offscreen-download") {
        const { taskId, url } = message;
        console.log(`${LOG_PREFIX} Triggering download for task ${taskId}`, url);

        try {
            // 创建一个隐藏的 anchor 元素来触发下载
            const a = document.createElement("a");
            a.href = url;
            a.setAttribute("target", "_blank");
            a.addEventListener("click", () => false);
            document.body.appendChild(a);
            a.click();

            // 清理
            setTimeout(() => {
                a.remove();
                console.log(`${LOG_PREFIX} Anchor cleaned up for task ${taskId}`);
            }, 1000);

            console.log(`${LOG_PREFIX} Download triggered for task ${taskId}`);
            sendResponse({ success: true });
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to trigger download for task ${taskId}`, err);
            sendResponse({
                success: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return true;
    }

    if (message?.type === "offscreen-ping") {
        sendResponse({ ready: true });
        return true;
    }
});

// 通知 background offscreen 已准备就绪
browser.runtime.sendMessage({ type: "offscreen-ready" }).catch(() => {
    // 忽略错误（可能没有监听器）
});

console.log(`${LOG_PREFIX} Offscreen document ready`);