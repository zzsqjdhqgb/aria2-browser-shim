export class WebSocketBridge {
  private ports = new Map<number, chrome.runtime.Port>();
  private connectCallbacks: Array<(port: chrome.runtime.Port) => void> = [];
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== 'aria2-ws') return;

        const portId = port.sender?.tab?.id ?? Date.now();
        this.ports.set(portId, port);

        port.postMessage({
          jsonrpc: '2.0',
          method: 'aria2.onConnect',
          params: [{ portId }],
        });

        port.onDisconnect.addListener(() => {
          this.ports.delete(portId);
        });

        for (const cb of this.connectCallbacks) {
          cb(port);
        }
      });
    }
  }

  broadcast(method: string, params: unknown[]): void {
    for (const port of this.ports.values()) {
      try {
        port.postMessage({
          jsonrpc: '2.0',
          method,
          params,
        });
      } catch {
        // Port may be disconnected
      }
    }
  }

  onConnect(callback: (port: chrome.runtime.Port) => void): void {
    this.connectCallbacks.push(callback);
  }

  getConnectedCount(): number {
    return this.ports.size;
  }
}
