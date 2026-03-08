# Known Issues

This document tracks known issues and browser-specific bugs encountered during development.

---

## Chrome DNR + downloads.download Bug

**Status:** Blocking PoC  
**Affects:** Chrome / Chromium-based browsers
**Related:** [Stack Overflow - Chrome Downloads API http requests are not getting modified by Declarative Net Request API](https://stackoverflow.com/questions/77932227/chrome-downloads-api-http-requests-are-not-getting-modified-by-declarative-net-r)

### Problem

When using `browser.downloads.download()` to initiate a download, Chrome does not allow `declarativeNetRequest` (DNR) rules to modify the request headers (e.g., `Cookie`, `Referer`, `User-Agent`).

This means downloads requiring custom headers will fail to authenticate or be rejected by the server.

### Workaround

Use an **Offscreen Document** approach:

1. Create an offscreen page
2. Trigger a navigation to the download URL: inject an `<a href="...">` element and programmatically click it
3. Use `declarativeNetRequest.updateDynamicRules` and modify `requestHeaders` to inject custom request headers (Cookie, Referer, etc.)
4. Use `declarativeNetRequest.updateDynamicRules` and modify `responseHeaders` to inject `Content-Disposition: attachment` header, forcing download
5. Capture the download via `downloads.onCreated` for state management

### Impact

The original plan to use `browser.downloads.download()` directly has been abandoned in favor of the Offscreen approach for cross-browser consistency.

---

## GM_xmlhttpRequest Cannot Be Intercepted

**Status:** Known Limitation (Workaround Planned)  
**Affects:** All browsers

### Problem

UserScripts that use `GM_xmlhttpRequest` (Greasemonkey/Tampermonkey/Violentmonkey API) to communicate with aria2 cannot be intercepted by this extension.

`GM_xmlhttpRequest` bypasses the page's JavaScript context entirely, so our `fetch` / `WebSocket` interception has no effect.

### Workaround

1. **One-click converter page:** A tool to automatically transform UserScripts by replacing `GM_xmlhttpRequest` calls with interceptable `fetch` equivalents
2. **Auto-transform on install:** Intercept `.user.js` pages before Tampermonkey/Violentmonkey processes them, automatically applying the conversion

Until these features are implemented, users must manually modify their scripts or use scripts that rely on native `fetch` / `WebSocket`.

---