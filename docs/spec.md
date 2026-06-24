# Aria2 Browser Shim — 功能规格说明

一个浏览器扩展，在扩展环境中模拟完整的 Aria2 JSON-RPC 服务：

1. **模拟完整 Aria2 RPC** — 尽可能将 RPC 方法映射到浏览器扩展原生能力（downloads、tabs、DNR 等），对外保持 Aria2 协议兼容。
2. **请求拦截与重定向** — 通过注入脚本拦截页面中指向 `localhost:6800/jsonrpc` 的 Aria2 请求，透明重定向到扩展后台处理，使依赖 Aria2 的网页无需安装 Aria2 即可工作。

---

# 核心功能点与代码实现要求

---

### 1. 网页端请求拦截器 (Content Script)
*   **MAIN World 注入脚本**：
    *   重写 `window.fetch`：匹配 `localhost:6800/jsonrpc`，挂起并拦截请求。
    *   代理 `window.WebSocket`：伪造 `ws://localhost:6800/jsonrpc` 握手成功，接管消息收发。
    *   *要求*：对非 6800 端口或非 jsonrpc 的请求直接放行，不影响网页正常业务。
*   **跨运行环境（World）通信**：
    *   在 MAIN World 拦截到 RPC 请求后，转为结构化 JSON，通过 `CustomEvent` 或 `window.postMessage` 发给 ISOLATED World。
    *   在 ISOLATED World 的 Content Script 中监听该事件，通过 `chrome.runtime.sendMessage` 发送给后台 Service Worker，并等待 Promise 异步回执。

---

### 2. 后台 RPC 协议解析与路由 (Service Worker)
*   **Aria2 协议兼容解析**：
    *   解析并兼容单笔请求与 Batch（数组）请求。
    *   提取 `jsonrpc`, `id`, `method`, `params`。
*   **方法映射与 Mock（支持以下方法）**：
    *   `aria2.addUri` → 触发下载核心流程，返回 `gid`。
    *   `aria2.tellStatus` → 传入 `gid`，转换并返回进度、速度、大小、状态等。
    *   `aria2.tellActive` / `aria2.tellWaiting` / `aria2.tellStopped` → 返回对应过滤状态的任务列表。
    *   `aria2.pause` / `aria2.forcePause` → 调用 `chrome.downloads.pause(downloadId)`。
    *   `aria2.unpause` / `aria2.forceUnpause` → 调用 `chrome.downloads.resume(downloadId)`。
    *   `aria2.remove` / `aria2.forceRemove` → 调用 `chrome.downloads.cancel(downloadId)` 和 `erase()`。
    *   `aria2.getVersion` / `aria2.getSessionInfo` / `system.listMethods` → 返回硬编码的伪造数据，避免调用脚本报错。

---

### 3. 动态 Header 注入 (DNR 配置器)
*   **Header 规则提取**：
    *   从 `aria2.addUri` 的参数 `options.header` 中，提取 `Cookie`、`Referer`、`User-Agent` 等字段。
*   **DNR 规则配置**：
    *   调用 `chrome.declarativeNetRequest.updateSessionRules` 动态添加一条规则：
        *   `id`: 递增的唯一整数。
        *   `condition`: 严格匹配目标下载 URL，限制请求发起者。
        *   `action`: 类型为 `modifyHeaders`，将提取出的 Header 写入 `requestHeaders` 列表中。
*   **规则回收**：
    *   在下载任务开始（触发 `chrome.downloads.onCreated`）或失败后，立刻调用 `updateSessionRules` 将该 `id` 的规则删除。

---

### 4. 静默下载触发 (Tab 触发器)
*   **后台创建 Tab**：
    *   调用 `chrome.tabs.create({ url, active: false })` 隐式打开目标下载 URL。
    *   保存该 `tabId` 并与当前任务的 `gid` 绑定。
*   **垃圾回收机制**：
    *   监听到 `downloads.onCreated` 且确认是该标签页触发后，立即调用 `chrome.tabs.remove(tabId)` 关闭标签页。
    *   *容错处理*：防止 URL 并非直接下载文件而是打开了普通网页。若 Tab 打开超过 5 秒未触发下载，强制调用 `chrome.tabs.remove(tabId)` 关闭并标记任务失败，避免残留僵尸标签页。

---

### 5. 下载状态同步与内存数据库 (状态管理器)
*   **ID 关系映射表**：
    *   维护一个 Map：`Aria2 Gid ↔ 浏览器原生 DownloadId ↔ 触发 TabId`。
*   **事件监听与同步**：
    *   监听 `chrome.downloads.onCreated`：
        *   通过 `tabId` 匹配到之前静默打开的 Tab，获取浏览器分配的原生 `downloadId` 并与 `gid` 关联。
    *   监听 `chrome.downloads.onChanged`：
        *   若 `state.current === "interrupted"` → 映射任务状态为 `error`。
        *   若 `state.current === "complete"` → 映射任务状态为 `complete`。
        *   实时计算速度：根据 `bytesReceived` 的差值与时间计算每秒下载速率（Aria2 格式的 `downloadSpeed`）。
*   **内存状态落库**：
    *   维护一个内存任务列表，响应 `tellStatus` 等查询方法。
