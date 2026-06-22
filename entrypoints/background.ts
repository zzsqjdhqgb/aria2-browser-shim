import { DownloadManager } from "@/lib/download-manager";
import { MethodRegistry } from "@/lib/rpc/dispatcher";
import { registerAll } from "@/lib/rpc/methods/register-all";
import {
  handleAria2RpcMessage,
  MSG_ARIA2_RPC,
  MSG_GET_SETTINGS,
  MSG_UPDATE_SETTINGS,
  MSG_GET_POPUP_STATE,
} from "@/lib/message-router";
import type { HandlerContext } from "@/lib/rpc/types";
import { LocalStore, SessionStore } from "@/lib/storage";
import { createLogger } from "@/lib/logging";

export default defineBackground(async () => {
  const log = createLogger("[Background]");
  log.info("aria2-browser-shim background loaded");

  // 1. Initialize core modules
  const downloadManager = new DownloadManager();
  await downloadManager.hydrate();

  const settings = await LocalStore.getSettings();
  const registry = new MethodRegistry();
  registerAll(registry);

  // 2. Build handler context
  const ctx: HandlerContext = {
    downloadManager,
    settings,
    store: { session: SessionStore, local: LocalStore },
  };

  // 3. Message listener
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case MSG_ARIA2_RPC: {
        const requestId = message.payload?.id ?? null;
        handleAria2RpcMessage(message.payload, registry, ctx)
          .then(sendResponse)
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            log.error("RPC handler error:", errorMessage);
            sendResponse({
              jsonrpc: "2.0",
              id: requestId,
              error: { code: -32603, message: errorMessage },
            });
          });
        return true; // async response
      }

      case MSG_GET_SETTINGS:
        sendResponse(ctx.settings);
        return false;

      case MSG_UPDATE_SETTINGS:
        LocalStore.putSettings({ ...ctx.settings, ...message.payload })
          .then(() => {
            ctx.settings = { ...ctx.settings, ...message.payload };
            sendResponse({ ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendResponse({ ok: false, error: message });
          });
        return true;

      case MSG_GET_POPUP_STATE: {
        const active = downloadManager.queryTasks({ status: "in_progress" });
        const waiting = downloadManager.queryTasks({ status: "pending" });
        sendResponse({
          activeCount: active.length,
          waitingCount: waiting.length,
          interceptionEnabled: ctx.settings.interceptionEnabled,
        });
        return false;
      }

      default:
        log.warn("Unknown message type:", (message as { type?: string }).type);
        return false;
    }
  });

  log.info("Message listener registered");
});
