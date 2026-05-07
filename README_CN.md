<p align="center">
  <img src="./src/logo.png" alt="ChatGPTBox logo" width="128" height="128" />
</p>

<h1 align="center">ChatGPTBox</h1>

<div align="center">

浏览器中的 AI 助手：选择工具、网站集成、浮动聊天界面和独立对话面板。

[![license][license-image]][license-url]
[![release][release-image]][release-url]
[![verify][verify-image]][verify-url]

[English](./README.md) &nbsp;&nbsp;|&nbsp;&nbsp; 中文

[功能](#功能) &nbsp;&nbsp;|&nbsp;&nbsp; [截图](#截图) &nbsp;&nbsp;|&nbsp;&nbsp; [安装](#安装) &nbsp;&nbsp;|&nbsp;&nbsp; [使用](#使用) &nbsp;&nbsp;|&nbsp;&nbsp; [配置](#配置) &nbsp;&nbsp;|&nbsp;&nbsp; [开发](#开发) &nbsp;&nbsp;|&nbsp;&nbsp; [API 服务桥接](#api-服务桥接) &nbsp;&nbsp;|&nbsp;&nbsp; [更新日志](#更新日志) &nbsp;&nbsp;|&nbsp;&nbsp; [致谢](#致谢)

</div>

## 功能

- 在任意页面使用浮动聊天、独立对话页面/窗口和侧边栏。
- 选择工具支持翻译/摘要/解释/改写，以及用户自定义的选择提示词。
- 网站集成支持搜索引擎和各类网站，包括 Google、GitHub、YouTube、Reddit、Stack Overflow、arXiv、Bilibili 和知乎。
- 支持 Web 和 API 提供商，包括 ChatGPT Web 以及 OpenAI、Anthropic、Azure OpenAI、OpenRouter、AIML、DeepSeek、Moonshot、Ollama、ChatGLM 和 OpenAI 兼容的自定义端点。
- Agent 运行时支持助手、ZIP 导入技能包、内置 MCP 工具集和外部 HTTP/SSE JSON-RPC MCP 服务器。
- 本地 API 服务桥接，通过 OpenAI 兼容的 `/v1/chat/completions` 端点暴露 ChatGPT Web，并支持缓存对话查看和跟进 API。
- Markdown 渲染支持代码块、语法高亮和 KaTeX。

## 截图

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_site_integration.webp" alt="网站集成" /><br />
      <b>网站集成</b><br />
      <sub>与 DuckDuckGo 等搜索引擎集成，在搜索结果旁显示 AI 响应</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_google_integration.webp" alt="Google 集成" /><br />
      <b>Google 集成</b><br />
      <sub>在 Google 搜索结果旁显示 AI 助手面板</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_options_page.webp" alt="设置页面（浅色）" /><br />
      <b>设置页面（浅色模式）</b><br />
      <sub>功能完善的设置面板，包含聊天历史和配置选项</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_darkmode.webp" alt="设置页面（深色）" /><br />
      <b>设置页面（深色模式）</b><br />
      <sub>精美的深色主题，支持自定义强调色</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_popup_window.webp" alt="弹出窗口" /><br />
      <b>弹出窗口</b><br />
      <sub>点击扩展图标即可从浏览器工具栏快速访问设置</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_context_menu.webp" alt="右键菜单" /><br />
      <b>右键菜单</b><br />
      <sub>右键菜单提供聊天、摘要页面等功能的快捷入口</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_independent_panel.webp" alt="独立面板" /><br />
      <b>独立对话面板</b><br />
      <sub>通过快捷键或右键菜单打开的专用对话页面</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_features_tab.webp" alt="功能选项卡" /><br />
      <b>网站集成设置</b><br />
      <sub>切换 Google、GitHub、YouTube、Reddit、Stack Overflow 等网站的集成</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_agents_tab.webp" alt="Agent 选项卡" /><br />
      <b>Agent 与助手</b><br />
      <sub>管理助手、导入的技能包和 MCP 服务器</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_modules_tab.webp" alt="模块选项卡" /><br />
      <b>模块与 API 模式</b><br />
      <sub>配置 API 模式、选择工具、网站适配器和内容提取器</sub>
    </td>
  </tr>
</table>

## 安装

这是一个社区分支，未在官方浏览器扩展商店上架。

请从 [GitHub Releases](https://github.com/aaaAlexanderaaa/chatGPTBox/releases) 下载构建包，或从源码构建：

```bash
npm ci
npm run dev        # 开发构建 → build/chromium/、build/firefox/
npm run build      # 生产构建 → build/*.zip
```

加载扩展：

- **基于 Chromium 的浏览器**：在扩展页面启用开发者模式，将 `build/chromium/` 作为未打包的扩展加载。
- **Firefox**：将 `build/firefox/` 作为临时附加组件加载。

## 使用

- 打开聊天：<kbd>Ctrl</kbd>+<kbd>B</kbd>（可在浏览器快捷键中自定义）。
- 摘要页面：<kbd>Alt</kbd>+<kbd>B</kbd>（通过快捷键或右键菜单）。
- 独立对话面板：<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>。
- 在页面上选择文本即可打开选择工具栏。
- 点击扩展图标打开快速工作区，包含 `常规`、`站点` 和 `高级`。使用 `完整设置` 打开完整配置工作区。

## 配置

从扩展图标或扩展选项页面打开设置界面。

- 工具栏弹出窗口是一个快速工作区，包含 `常规`、`站点` 和 `高级`，以及一个 `完整设置` 按钮。
- 完整设置工作区包含所有顶级选项卡：`常规`、`功能`、`Agent`、`模块` 和 `高级`。

完整设置工作区的主要区域：

- **常规**：模型/提供商选择、语言、触发行为、外观、运行时模式、默认助手和 Agent 协议。
- **功能**：启用/禁用支持的网站集成。
- **Agent**：助手、导入的 ZIP 技能包和 MCP 服务器。
- **模块**：API 模式、选择工具、网站适配器和内容提取器。
- **高级**：上下文长度、最大令牌数、温度、自定义端点、调试/导出/导入/重置设置。

Agent/运行时说明：

- 导入的技能是 Agent/运行时资产，位于 **Agent -> 技能** 下。
- 传统自定义选择工具保留在 **模块 -> 选择工具** 中。
- 在 `safe` 运行时模式下，MCP HTTP 端点需使用 HTTPS；`developer` 模式更为宽松。
- 助手/技能/MCP 主要用于 API/自定义运行时流程。ChatGPT Web 模型在普通聊天中继续可用，但不使用完整的 Agent 上下文路径。

提供商说明：

- **自定义模型** 支持 OpenAI 兼容端点（默认：`http://localhost:8000/v1/chat/completions`）。
- **Ollama** 使用本地端点（默认：`http://127.0.0.1:11434`）。

## 开发

ChatGPTBox 在 CI 中使用 **Node.js 20**。

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20
npm ci
```

常用命令：

```bash
npm run dev
npm run lint
npm run test:agent
npm run verify
npm run pretty
npm run build
npm run build:safari
npm run api-server
```

`npm run dev` 将未打包的浏览器构建写入：

- `build/chromium/`
- `build/firefox/`

浏览器测试：

- 基于 Chromium 的浏览器：在扩展页面启用开发者模式并加载 `build/chromium/`。
- Firefox：将 `build/firefox/` 作为临时附加组件加载。
- 如果没有有效的提供商凭据或 ChatGPT Web 登录，发送聊天请求可能返回 `UNAUTHORIZED`。这通常意味着缺少身份验证，而非构建错误。

生产构建在 `build/` 下输出压缩包：

```bash
npm run build
```

构建产物包括：

- `build/chromium.zip`
- `build/firefox.zip`
- `build/chromium-without-katex-and-tiktoken.zip`
- `build/firefox-without-katex-and-tiktoken.zip`

Safari 打包需要 macOS/Xcode：

```bash
npm run build:safari
```

## API 服务桥接

ChatGPTBox 包含一个本地 OpenAI 兼容网关，通过扩展代理 ChatGPT Web：

- 在扩展中打开 `高级 -> API 服务桥接 -> 打开 API 服务桥接`。
- 在该页面开启 `启用 API 服务桥接`。
- 使用 `npm run api-server` 启动本地服务器。
- 使用网关时保持 API 服务页面处于打开状态。
- 确保已登录 [chatgpt.com](https://chatgpt.com)。
- 默认发送请求到 `http://127.0.0.1:18080/v1/chat/completions`。

如需手动打开页面，也可以在扩展 Service Worker 控制台中运行：

```js
chrome.tabs.create({ url: chrome.runtime.getURL('ApiServer.html') })
```

桥接工作原理：

- 客户端向 [`scripts/api-server.mjs`](./scripts/api-server.mjs) 中的本地 Node.js 网关发送 HTTP 请求。
- 网关通过 WebSocket 或 HTTP 轮询将请求转发到 [`src/pages/ApiServer/App.jsx`](./src/pages/ApiServer/App.jsx) 中的扩展页面。
- 该页面要求扩展后台通过 ChatGPT Web 流程发送提示词。
- 响应以 OpenAI 兼容格式流式传回客户端。

支持的端点：

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /status`
- `GET /health`
- `GET /chatgpt/conversations`
- `GET /chatgpt/conversations/:id`
- `POST /chatgpt/conversations/:id/messages`
- `POST /chatgpt/conversations/:id/refresh`

网关配置：

- CLI 参数：`--port`、`--host`、`--timeout-seconds`、`--thinking-timeout-seconds`
- 环境变量：`CHATGPT_GATEWAY_PORT`、`CHATGPT_GATEWAY_HOST`、`CHATGPT_GATEWAY_TIMEOUT_SECONDS`、`CHATGPT_GATEWAY_THINKING_TIMEOUT_SECONDS`
- 扩展设置：`保留 API 服务聊天到 ChatGPT 历史`、`API 请求超时（秒）`、`思考请求超时（秒）`

默认健康检查端点为 `http://127.0.0.1:18080/health`。

对话 API 说明：

- `GET /chatgpt/conversations` 返回本地缓存的 ChatGPT Web 对话列表。添加 `force_sync=true` 可在读取前触发同步。
- `GET /chatgpt/conversations/:id` 返回标准化的对话快照。添加 `think=true` 可包含推理相关节点，`force_refresh=true` 可立即获取最新快照。
- `POST /chatgpt/conversations/:id/messages` 向现有 ChatGPT 对话发送后续消息，然后刷新快照。
- `POST /chatgpt/conversations/:id/refresh` 刷新对话，可选择恢复待处理的助手输出。

完整 API 服务文档：[`docs/api-server.md`](./docs/api-server.md)

## 架构说明

- 扩展完全运行在客户端，没有项目后端或数据库。
- 导入的技能是必须包含 `SKILL.md` 的 ZIP 包。
- 内置助手、内置技能和内置 MCP 工具集定义在 [`src/config/index.mjs`](./src/config/index.mjs) 中。
- 当前运行时概述见 [`docs/agents-runtime-v2.md`](./docs/agents-runtime-v2.md)。

## 隐私

ChatGPTBox 在浏览器中本地运行。仅在您配置的提供商/端点上发送网络请求，且仅在您主动触发工具时才发出请求。

## 更新日志

### v3.2.2

- 为本地 API 服务桥接添加了缓存的 ChatGPT 对话 API，包括列表、详情、创建、后续消息和刷新端点。
- 添加了本地对话缓存以及用于检查线程和通过网关发送排队跟进的草稿工作流脚本。
- 重新设计了设置体验，围绕快速设置和更清晰的顶级选项卡（常规、功能、Agent、模块和高级配置）。
- 改进了网关和 Brave 浏览器的兼容性，包括反向端口消息传递、连接健康处理、缓冲的 WebSocket 事件和更安全的设置页面行为。
- 更新了模型处理方式，使 ChatGPT Web 对话请求保留上游 slug 并适配新的动态模型列表流程。
- 扩展了 API 服务文档，包含准确的端点行为、缓存语义和请求/响应示例。
- 改进了 Brave 和 macOS 上 ChatGPT Web 桥接的可靠性，包括更安全的代理路由、连接恢复和缓冲的 WebSocket 处理。

## 维护者

本分支由 [@aaaAlexanderaaa](https://github.com/aaaAlexanderaaa) 维护。

## 致谢

本项目从 [ChatGPTBox-dev/chatGPTBox](https://github.com/ChatGPTBox-dev/chatGPTBox) 分支而来，
原项目基于 [josStorer/chatGPT-search-engine-extension](https://github.com/josStorer/chatGPT-search-engine-extension)，
该项目又从 [wong2/chat-gpt-google-extension](https://github.com/wong2/chat-gpt-google-extension) 分支，
并受到 [ZohaibAhmed/ChatGPT-Google](https://github.com/ZohaibAhmed/ChatGPT-Google) 的启发。

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/aaaAlexanderaaa/chatGPTBox/blob/master/LICENSE

[release-image]: https://img.shields.io/github/v/release/aaaAlexanderaaa/chatGPTBox?display_name=tag
[release-url]: https://github.com/aaaAlexanderaaa/chatGPTBox/releases/latest

[verify-image]: https://github.com/aaaAlexanderaaa/chatGPTBox/actions/workflows/verify-configs.yml/badge.svg
[verify-url]: https://github.com/aaaAlexanderaaa/chatGPTBox/actions/workflows/verify-configs.yml
