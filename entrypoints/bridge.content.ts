export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    let relay: HTMLSpanElement | null = null;
    let wsPort: chrome.runtime.Port | null = null;
    let eventPort: chrome.runtime.Port | null = null;

    function getRelay(): HTMLSpanElement {
      if (!relay) {
        relay = document.getElementById('__aria2shim_relay__') as HTMLSpanElement;
      }
      return relay!;
    }

    document.addEventListener('__aria2shim_request__', ((e: CustomEvent) => {
      const { requestId, type, payload } = e.detail;

      if (type === 'rpc') {
        chrome.runtime.sendMessage({ type: 'aria2-rpc', requestId, payload }).then((response: any) => {
          const r = response?.response;
          getRelay().dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: { requestId, result: r?.result ?? r },
          }));
        }).catch((err) => {
          getRelay().dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: {
              requestId,
              error: { code: -32603, message: err.message || 'Bridge error' },
            },
          }));
        });
      } else if (type === 'ws-rpc') {
        const wsPayload = payload as { wsId: number; payload: unknown };
        if (wsPort) {
          wsPort.postMessage({ requestId, payload: wsPayload.payload });
        }
      }
    }) as EventListener);

    document.addEventListener('__aria2shim_wsconnect__', ((e: CustomEvent) => {
      const { wsId } = e.detail;

      if (!wsPort) {
        wsPort = chrome.runtime.connect({ name: 'aria2-rpc' });

        wsPort.onMessage.addListener((message: any) => {
          const { requestId, response } = message;
          if (!response) return;

          getRelay().dispatchEvent(new CustomEvent('__aria2shim_response__', {
            detail: { requestId, result: response.result ?? response },
          }));
        });

        wsPort.onDisconnect.addListener(() => {
          wsPort = null;
          if (eventPort) {
            eventPort.disconnect();
            eventPort = null;
          }
        });

        if (!eventPort) {
          eventPort = chrome.runtime.connect({ name: 'aria2-ws' });
          eventPort.onMessage.addListener((msg: any) => {
            if (msg.method && msg.method.startsWith('aria2.on')) {
              getRelay().dispatchEvent(new CustomEvent('__aria2shim_wsevent__', {
                detail: { wsId, method: msg.method, params: msg.params },
              }));
            }
          });
          eventPort.onDisconnect.addListener(() => {
            eventPort = null;
          });
        }
      }
    }) as EventListener);

    document.addEventListener('__aria2shim_wsclose__', (() => {
      if (eventPort) {
        eventPort.disconnect();
        eventPort = null;
      }
      if (wsPort) {
        wsPort.disconnect();
        wsPort = null;
      }
    }) as EventListener);
  },
});
