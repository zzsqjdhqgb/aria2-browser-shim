import { DownloadManager } from "@/lib/download-manager";
import { MethodRegistry } from "@/lib/rpc/dispatcher";
import { registerAll } from "@/lib/rpc/methods/register-all";
import {
  handleAria2RpcMessage,
  MSG_ARIA2_RPC,
  MSG_GET_SETTINGS,
  MSG_UPDATE_SETTINGS,
  MSG_GET_POPUP_STATE,
  MSG_UPDATE_PER_SITE,
} from "@/lib/message-router";
import type { HandlerContext } from "@/lib/rpc/types";
import type { AppSettings } from "@/lib/types";
import { LocalStore, SessionStore } from "@/lib/storage";
import { createLogger } from "@/lib/logging";

const ALLOWED_SETTING_KEYS = ["interceptionEnabled", "perSiteOverrides", "pendingTimeoutMs"] as const;

export default defineBackground(() => {
  const log = createLogger("[Background]");
  log.info("aria2-browser-shim background loaded");

  const downloadManager = new DownloadManager();
  const registry = new MethodRegistry();
  registerAll(registry);

  let readyResolve!: (ctx: HandlerContext) => void;
  let readyReject!: (err: unknown) => void;
  const readyPromise = new Promise<HandlerContext>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case MSG_ARIA2_RPC: {
        const requestId = message.payload?.id ?? null;
        readyPromise
          .then((ctx) => handleAria2RpcMessage(message.payload, registry, ctx))
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            log.error("RPC handler error:", errorMessage);
            return {
              jsonrpc: "2.0" as const,
              id: requestId,
              error: { code: -32603, message: errorMessage },
            };
          })
          .then(sendResponse);
        return true;
      }

      case MSG_GET_SETTINGS:
        LocalStore.getSettings()
          .then(sendResponse)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            log.error("Failed to read settings:", message);
            sendResponse({
              interceptionEnabled: true,
              perSiteOverrides: {},
              pendingTimeoutMs: 120_000,
              error: message,
            });
          });
        return true;

      case MSG_UPDATE_SETTINGS: {
        const sanitized: Record<string, unknown> = {};
        if (message.payload && typeof message.payload === "object") {
          for (const key of ALLOWED_SETTING_KEYS) {
            if (key in message.payload) {
              sanitized[key] = (message.payload as Record<string, unknown>)[key];
            }
          }
        }
        LocalStore.getSettings()
          .then((current) => LocalStore.putSettings({ ...current, ...sanitized } as AppSettings))
          .then(() => sendResponse({ ok: true }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendResponse({ ok: false, error: message });
          });
        return true;
      }

      case MSG_GET_POPUP_STATE: {
        const active = downloadManager.queryTasks({ status: "in_progress" });
        const waiting = downloadManager.queryTasks({ status: "pending" });
        LocalStore.getSettings()
          .then((fresh) => {
            sendResponse({
              activeCount: active.length,
              waitingCount: waiting.length,
              interceptionEnabled: fresh.interceptionEnabled,
            });
          })
          .catch(() => {
            sendResponse({
              activeCount: active.length,
              waitingCount: waiting.length,
              interceptionEnabled: false,
            });
          });
        return true;
      }

      case MSG_UPDATE_PER_SITE: {
        const payload = message.payload as { origin?: string; enabled?: boolean } | undefined;
        if (payload?.origin && typeof payload.enabled === "boolean") {
          LocalStore.setPerSiteEnabled(payload.origin, payload.enabled)
            .then(() => sendResponse({ ok: true }))
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              sendResponse({ ok: false, error: message });
            });
        } else {
          sendResponse({ ok: false, error: "Invalid origin or enabled value" });
        }
        return true;
      }

      default:
        log.warn("Unknown message type:", (message as { type?: string }).type);
        return false;
    }
  });

  (async () => {
    try {
      await downloadManager.hydrate();
      const settings = await LocalStore.getSettings();

      const ctx: HandlerContext = {
        downloadManager,
        settings,
        store: { session: SessionStore, local: LocalStore },
      };

      readyResolve(ctx);
      log.info("Background ready");
    } catch (err: unknown) {
      log.error("Background initialization failed:", err);
      readyReject(err);
    }
  })();

  log.info("Message listener registered");
});
