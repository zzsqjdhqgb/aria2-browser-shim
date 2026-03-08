# aria2-browser-shim

![Status](https://img.shields.io/badge/Status-Proof_of_Concept-orange)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue)

**aria2-browser-shim** is a lightweight browser extension that seamlessly intercepts Aria2 requests and redirects them to your browser's native download manager.

It acts as a **polyfill**, allowing you to use third-party UserScripts (like those for cloud drives) that mandate an Aria2 connection, **without ever needing to install, configure, or run the actual Aria2 software.**

---

### 🚀 Why this project?

Aria2 is a powerful tool, but setting it up can be a nightmare for average users. You often need to download command-line tools, create configuration files (`aria2.conf`), manage RPC tokens, and manually start background processes just to download a file from a script.

**This extension eliminates that entire learning curve.**

*   **For Beginners:** You don't need to know what "RPC" or "Port 6800" is. Just install this extension, and your scripts will work instantly.
*   **For Minimalists:** Keep your system clean. No background processes, no extra software installed on your OS.
*   **For "It Just Works":** We handle the complex stuff (Cookies, Headers, POST data) automatically behind the scenes.

### ✨ Features

*   **Zero Configuration:** Works immediately after installation. No settings to tweak.
*   **Aria2 Emulation:** Automatically intercepts requests sent to `http://localhost:6800/jsonrpc`. The calling script believes it is talking to a real Aria2 instance.
*   **Seamless Handover:** Takes complex download requests (including authentication Cookies, Referers, and User-Agents) and hands them off to the browser's native downloader.
*   **Smart Directories:** Respects the folder structure requested by the script (e.g., `Batch_Download/file.mp4`) by creating subfolders in your default Downloads directory.

### ⚠️ Limitations

Please note that this project is a **compatibility layer**, not a full-featured download accelerator.

*   ❌ **No BitTorrent / Magnet support.** (Browser native downloads only support HTTP/HTTPS).
*   ❌ **Single-threaded.** Downloads are handled by the browser, so you won't get multi-threaded acceleration.
*   ❌ **No FTP / SFTP support.**
*   ❌ **Limited Resume Capability.** (Dependent on browser and server support).
*   ❌ **Cannot intercept `GM_xmlhttpRequest`.** UserScripts using Greasemonkey/Tampermonkey's `GM_xmlhttpRequest` to call aria2 cannot be intercepted. Only native `fetch` and `WebSocket` are supported.

**If you specifically need multi-threading or BitTorrent support, please install the official [Aria2](https://github.com/aria2/aria2) client.**

### 🗺️ Roadmap

This project is currently in the **Proof of Concept (PoC)** phase. The goal is to validate the interception logic before building a robust architecture.

- [ ] **v0.1.0 - Core Implementation (PoC)**
    - [x] ~~Implement the core download module using `chrome.downloads` API & handle custom Headers (Cookies/Referer) via `declarativeNetRequest`.~~ (Abandoned: [see known issues](./KNOWN_ISSUES.md#chrome-dnr-downloads-bug))
    - [x] Implement the basic interception module for Aria2 JSON-RPC.
        - Intercept `fetch` / `WebSocket` requests to `localhost:6800`
        - Implement basic `aria2.addUri` parsing
    - [ ] Implement Offscreen-based download with header injection
    - [ ] End-to-end test with a real aria2-based script

### 📄 Documentation

- [Known Issues](./KNOWN_ISSUES.md) - Current limitations and browser-specific bugs

---