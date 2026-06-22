/**
 * AriaNg Interceptor — injected at build time into the AriaNg AllInOne page.
 *
 * This script runs in the MAIN world of the AriaNg extension page.
 * It intercepts fetch and WebSocket requests to localhost:6800 and
 * redirects them through the extension bridge (ISOLATED world content script).
 *
 * Self-contained — no TypeScript, no module imports; inlined as a plain <script> tag.
 */

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────

  function isAria2Url(url) {
    try {
      var parsed = new URL(url, location.origin);
      return (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        parsed.port === '6800'
      );
    } catch (_e) {
      return false;
    }
  }

  function sendToBridge(body) {
    var requestId = crypto.randomUUID();

    return new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () {
        window.removeEventListener('aria2-shim-response', handler);
        reject(new Error('sendToBridge: request timed out after 30s'));
      }, 30000);

      function handler(event) {
        var detail = event.detail;
        if (!detail || detail._requestId !== requestId) return;

        clearTimeout(timeout);
        window.removeEventListener('aria2-shim-response', handler);
        resolve(detail.data);
      }

      window.addEventListener('aria2-shim-response', handler);

      window.dispatchEvent(
        new CustomEvent('aria2-shim-request', {
          detail: { _requestId: requestId, body: body },
        })
      );
    });
  }

  function buildFakeResponse(result) {
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch interception ───────────────────────────────────────────────

  var originalFetch = window.fetch.bind(window);

  async function patchedFetch(input, init) {
    var url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (!isAria2Url(url)) {
      return originalFetch(input, init);
    }

    var parsedBody = null;
    if (init && init.body) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch (_e) {
        // Non-JSON body — forward as-is
      }
    }

    var result = await sendToBridge(parsedBody != null ? parsedBody : (init && init.body) || null);
    return buildFakeResponse(result);
  }

  window.fetch = patchedFetch;

  // ── WebSocket interception ───────────────────────────────────────────

  var OriginalWebSocket = window.WebSocket;

  var WsConnect = /** @class */ (function (_super) {
    function FakeWebSocket(url, _protocols) {
      var _this = _super.call(this) || this;
      _this.CONNECTING = 0;
      _this.OPEN = 1;
      _this.CLOSING = 2;
      _this.CLOSED = 3;
      _this.readyState = 0;
      _this.onopen = null;
      _this.onclose = null;
      _this.onmessage = null;
      _this.onerror = null;
      _this.url = url.toString();

      setTimeout(function () {
        _this.readyState = FakeWebSocket.OPEN;
        var openEvent = new Event('open');
        if (_this.onopen) _this.onopen(openEvent);
        _this.dispatchEvent(openEvent);
      }, 0);
      return _this;
    }

    FakeWebSocket.prototype.send = function (data) {
      if (this.readyState !== FakeWebSocket.OPEN) {
        throw new DOMException('WebSocket is not OPEN', 'InvalidStateError');
      }
      this.handleMessage(data);
    };

    FakeWebSocket.prototype.close = function (code, reason) {
      this.readyState = FakeWebSocket.CLOSING;
      var self = this;

      setTimeout(function () {
        self.readyState = FakeWebSocket.CLOSED;
        var closeEvent = new CloseEvent('close', {
          code: code != null ? code : 1000,
          reason: reason != null ? reason : '',
          wasClean: true,
        });
        if (self.onclose) self.onclose(closeEvent);
        self.dispatchEvent(closeEvent);
      }, 0);
    };

    FakeWebSocket.prototype.handleMessage = async function (data) {
      try {
        var parsed = JSON.parse(data);
        var result = await sendToBridge(parsed);

        var messageEvent = new MessageEvent('message', {
          data: JSON.stringify(result),
        });

        if (this.onmessage) this.onmessage(messageEvent);
        this.dispatchEvent(messageEvent);
      } catch (_err) {
        var errorEvent = new Event('error');
        if (this.onerror) this.onerror(errorEvent);
        this.dispatchEvent(errorEvent);
      }
    };

    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;

    return FakeWebSocket;
  })(EventTarget);

  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct: function (target, args) {
      var url = args[0].toString();

      if (isAria2Url(url)) {
        return new WsConnect(url, args[1]);
      }

      return new (Function.prototype.bind.apply(target, [null].concat(args)))();
    },
  });

  console.debug('[AriaNgInterceptor] Fetch and WebSocket interceptors installed');
})();
