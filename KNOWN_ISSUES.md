# Known Issues

This document tracks known issues and browser-specific bugs encountered during development.

---

## 1. Chrome DNR + downloads.download Bug

**Status:** Abandoned — replaced by Tab-based approach  
**Affects:** Chrome / Chromium-based browsers  
**Related:** [Stack Overflow - Chrome Downloads API http requests are not getting modified by Declarative Net Request API](https://stackoverflow.com/questions/77932227/chrome-downloads-api-http-requests-are-not-getting-modified-by-declarative-net-r)

### Problem

When using `browser.downloads.download()` to initiate a download, Chrome does not allow `declarativeNetRequest` (DNR) rules to modify the request headers (e.g., `Cookie`, `Referer`, `User-Agent`).

This means downloads requiring custom headers will fail to authenticate or be rejected by the server.

### Resolution

This approach was abandoned. See issue #2 for the next attempt, and the final working solution below.

---

## 2. Offscreen Document Cannot Trigger Downloads

**Status:** Abandoned — replaced by Tab-based approach  
**Affects:** Chrome / Chromium-based browsers

### Problem

The original workaround for issue #1 was to use an **Offscreen Document** to trigger downloads by creating an `<a>` element and programmatically clicking it. However, testing revealed that:

1. Offscreen documents run in a restricted context where navigation-triggered downloads do not work as expected.
2. The `<a>` click in an offscreen document does not reliably trigger the browser's download pipeline.
3. Even with `declarativeNetRequest` rules in place, the offscreen document's requests were not properly matched by DNR rules.

Ultimately, the offscreen approach provides no advantage over simply opening a background tab — and the tab approach actually works.

### Resolution

The final working approach uses **`tabs.create()`** to open a background tab:

1. Create `declarativeNetRequest` session rules to:
   - Inject custom request headers (`Cookie`, `Referer`, `User-Agent`, etc.)
   - Inject `Content-Disposition: attachment` response header to force download
2. Open a background tab (`active: false`) navigating to the download URL
3. The browser processes the navigation, applies DNR rules, and triggers a native download
4. Capture the download via `downloads.onCreated`, match it to the pending task by URL
5. Clean up: remove DNR rules and close the tab once the download starts

This approach works reliably because tab navigations are full `MAIN_FRAME` requests that DNR rules can intercept.

---

## 3. GM_xmlhttpRequest Cannot Be Intercepted

**Status:** Known Limitation (Workaround Planned)  
**Affects:** All browsers

### Problem

UserScripts that use `GM_xmlhttpRequest` (Greasemonkey/Tampermonkey/Violentmonkey API) to communicate with aria2 cannot be intercepted by this extension.

`GM_xmlhttpRequest` bypasses the page's JavaScript context entirely, so our `fetch` / `WebSocket` interception has no effect.

### Potential Workarounds

1. **One-click converter page:** A tool to automatically transform UserScripts by replacing `GM_xmlhttpRequest` calls with interceptable `fetch` equivalents
2. **Auto-transform on install:** Intercept `.user.js` pages before Tampermonkey/Violentmonkey processes them, automatically applying the conversion

Until these features are implemented, users must manually modify their scripts or use scripts that rely on native `fetch` / `WebSocket`.

---

## 4. Pending Tasks and Background Tab Leaks

**Status:** Known Issue (Fix Planned)  
**Affects:** All browsers

### Problem

When a download is initiated, the extension creates a background tab (`tabs.create({ active: false })`) to trigger the browser's native download pipeline. 

If the target URL is invalid (e.g., 404 Not Found), encounters a network error, or the server responds with a regular web page instead of triggering a file download, the `browser.downloads.onCreated` event will never fire. Consequently, the extension fails to match and track the download. The task remains stuck in the `pending` state forever, and the background tab is left open, causing a "tab leak".

### Planned Resolution

Implement a global timeout mechanism for pending download tasks. 

If a task remains in the `pending` state for too long without being successfully tracked by the download manager, it will automatically trigger a `cancel` action. The existing cancellation logic will then cleanly recycle the orphaned background tab (`browser.tabs.remove`) and clear any associated `declarativeNetRequest` rules, preventing resource leaks.