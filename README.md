<p align="center">
  <img src="./src/logo.png" alt="ChatGPTBox logo" width="128" height="128" />
</p>

<h1 align="center">ChatGPTBox</h1>

<div align="center">

AI assistant in your browser: selection tools, site integrations, a floating chat UI, and an independent conversation panel.

[![license][license-image]][license-url]
[![release][release-image]][release-url]
[![verify][verify-image]][verify-url]

[![Chrome][Chrome-image]][Chrome-url]
[![Edge][Edge-image]][Edge-url]
[![Firefox][Firefox-image]][Firefox-url]
[![Safari][Safari-image]][Safari-url]

[Install](#install) &nbsp;&nbsp;|&nbsp;&nbsp; [Features](#features) &nbsp;&nbsp;|&nbsp;&nbsp; [Screenshots](#screenshots) &nbsp;&nbsp;|&nbsp;&nbsp; [Usage](#usage) &nbsp;&nbsp;|&nbsp;&nbsp; [Configuration](#configuration) &nbsp;&nbsp;|&nbsp;&nbsp; [Development](#development) &nbsp;&nbsp;|&nbsp;&nbsp; [API Server Bridge](#api-server-bridge) &nbsp;&nbsp;|&nbsp;&nbsp; [Architecture Notes](#architecture-notes) &nbsp;&nbsp;|&nbsp;&nbsp; [Privacy](#privacy)

</div>

## Install

Official browser installs:

- Chrome: [Chrome Web Store][Chrome-url]
- Edge: [Microsoft Edge Add-ons][Edge-url]
- Firefox: [Firefox Add-ons][Firefox-url]
- Safari: [App Store][Safari-url]

Builds from source:

- GitHub releases: https://github.com/aaaAlexanderaaa/chatGPTBox/releases
- Local development builds: run `npm run dev`, then load `build/chromium/` as an unpacked extension.

## Features

- Chat on any page with floating chat, independent conversation page/window, and side-panel support.
- Selection tools for translate / summarize / explain / rewrite, plus user-defined custom selection prompts.
- Site integrations for search engines and supported sites such as Google, GitHub, YouTube, Reddit, Stack Overflow, arXiv, Bilibili, and Zhihu.
- Web and API provider support, including ChatGPT Web plus API/custom runtimes such as OpenAI, Anthropic, Azure OpenAI, OpenRouter, AIML, DeepSeek, Moonshot, Ollama, ChatGLM, and OpenAI-compatible custom endpoints.
- Agent runtime with assistants, ZIP-imported skills, built-in MCP toolkits, and external HTTP/SSE JSON-RPC MCP servers.
- Local API Server Bridge that exposes ChatGPT Web through an OpenAI-compatible `/v1/chat/completions` endpoint.
- Markdown rendering with code blocks, syntax highlighting, and KaTeX in the full build.

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_site_integration.png" alt="Site Integration" /><br />
      <b>Site Integration</b><br />
      <sub>Integrates with search engines like DuckDuckGo, showing AI responses alongside search results</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_selection_tools.png" alt="Selection Tools" /><br />
      <b>Selection Tools</b><br />
      <sub>Highlight text to access quick actions: translate, summarize, explain, and more</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_context_menu.png" alt="Context Menu" /><br />
      <b>Context Menu</b><br />
      <sub>Right-click menu for quick access to chat, summarize page, and other features</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_popup_window.png" alt="Popup Window" /><br />
      <b>Popup Window</b><br />
      <sub>Click the extension icon to access settings directly from the browser toolbar</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./screenshots/preview_options_page.png" alt="Options Page (Light)" /><br />
      <b>Options Page (Light Mode)</b><br />
      <sub>Full-featured settings panel with chat history and configuration options</sub>
    </td>
    <td align="center" width="50%">
      <img src="./screenshots/preview_darkmode.png" alt="Options Page (Dark)" /><br />
      <b>Options Page (Dark Mode)</b><br />
      <sub>Beautiful dark theme with customizable accent colors</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="./screenshots/preview_context_extractor.png" alt="Context Extractor" width="400" /><br />
      <b>Context Extractor</b><br />
      <sub>Preview and customize what content is extracted from web pages for AI context</sub>
    </td>
  </tr>
</table>

## Usage

- Open chat: <kbd>Ctrl</kbd>+<kbd>B</kbd> (configurable in browser shortcuts).
- Summarize page: <kbd>Alt</kbd>+<kbd>B</kbd> (via shortcut or context menu).
- Independent conversation panel: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>.
- Select text on a page to open the selection toolbar.
- Click the extension icon to open the quick workspace with `General`, `Sites`, and `Advanced`. Use `Full settings` for the complete configuration workspace.

## Configuration

Open the Settings UI from the extension icon or the extension options page.

- The toolbar popup is a quick workspace with `General`, `Sites`, and `Advanced`, plus a `Full settings` button.
- The full settings workspace exposes all top-level tabs: `General`, `Features`, `Agents`, `Modules`, and `Advanced`.

Main areas in the full settings workspace:

- **General**: model/provider selection, language, trigger behavior, appearance, runtime mode, default assistant, and agent protocol.
- **Features**: enable/disable supported site integrations.
- **Agents**: assistants, imported ZIP skill packs, and MCP servers.
- **Modules**: API modes, selection tools, site adapters, and content extractors.
- **Advanced**: context length, max tokens, temperature, custom endpoints, debug/export/import/reset settings.

Agent/runtime notes:

- Imported skills are agent/runtime assets and live under **Agents -> Skills**.
- Legacy custom selection tools remain separate under **Modules -> Selection Tools**.
- In `safe` runtime mode, MCP HTTP endpoints are expected to use HTTPS; `developer` mode is more permissive.
- Assistant / Skills / MCP are intended for API/custom runtime flows. ChatGPT Web models continue to work for normal chat, but they do not use the full agent-context path.

Provider notes:

- **Custom Model** supports OpenAI-compatible endpoints (default: `http://localhost:8000/v1/chat/completions`).
- **Ollama** uses a local endpoint (default: `http://127.0.0.1:11434`).

## Development

ChatGPTBox targets **Node.js 20** in CI.

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20
npm ci
```

Common commands:

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

`npm run dev` writes unpacked browser builds to:

- `build/chromium/`
- `build/firefox/`

Browser testing:

- Chromium-based browsers: enable Developer mode on the extensions page and load `build/chromium/`.
- Firefox: load `build/firefox/` as a temporary add-on.
- Without a valid provider credential or ChatGPT Web login, sending a chat request can return `UNAUTHORIZED`. That usually means missing auth, not a broken build.

Production build outputs zipped builds under `build/`:

```bash
npm run build
```

Artifacts include:

- `build/chromium.zip`
- `build/firefox.zip`
- `build/chromium-without-katex-and-tiktoken.zip`
- `build/firefox-without-katex-and-tiktoken.zip`

Safari packaging is separate and requires macOS/Xcode:

```bash
npm run build:safari
```

## API Server Bridge

ChatGPTBox includes a local OpenAI-compatible gateway that proxies ChatGPT Web through the extension:

- Open `Advanced -> API Server Bridge -> Open API Server Bridge` in the extension.
- On that page, turn on `Enable API Server Bridge`.
- Start the local server with `npm run api-server`.
- Keep the API Server page open while using the gateway.
- Make sure you are logged in at [chatgpt.com](https://chatgpt.com).
- Send requests to `http://127.0.0.1:18080/v1/chat/completions` by default.

If you need to open the page manually, you can also run this from the extension service worker console:

```js
chrome.tabs.create({ url: chrome.runtime.getURL('ApiServer.html') })
```

How the bridge works:

- Your client sends an HTTP request to the local Node.js gateway in [`scripts/api-server.mjs`](./scripts/api-server.mjs).
- The gateway forwards the request to the extension page at [`src/pages/ApiServer/App.jsx`](./src/pages/ApiServer/App.jsx) over WebSocket or HTTP polling.
- That page asks the extension background to send the prompt through the ChatGPT Web flow.
- The response is streamed back to your client in an OpenAI-compatible format.

Supported endpoints:

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /status`
- `GET /health`
- `GET /chatgpt/conversations`
- `GET /chatgpt/conversations/:id`
- `POST /chatgpt/conversations/:id/refresh`

Gateway configuration:

- CLI flags: `--port`, `--host`, `--timeout-seconds`, `--thinking-timeout-seconds`
- Environment variables: `CHATGPT_GATEWAY_PORT`, `CHATGPT_GATEWAY_HOST`, `CHATGPT_GATEWAY_TIMEOUT_SECONDS`, `CHATGPT_GATEWAY_THINKING_TIMEOUT_SECONDS`
- Extension settings: `Keep API Server chats in ChatGPT history`, `API request timeout (s)`, `Thinking request timeout (s)`

The default health endpoint is `http://127.0.0.1:18080/health`.

The three conversation APIs are implemented now:

- `GET /chatgpt/conversations`
- `GET /chatgpt/conversations/:id`
- `POST /chatgpt/conversations/:id/refresh`

`GET /chatgpt/conversations` now preserves the upstream ChatGPT Web list response shape.

Full API server docs: [`docs/api-server.md`](./docs/api-server.md)

## Architecture Notes

- The extension is fully client-side. There is no project backend or database.
- Imported skills are ZIP packages that must contain `SKILL.md`.
- Built-in assistants, built-in skills, and built-in MCP toolkits are defined in [`src/config/index.mjs`](./src/config/index.mjs).
- The current runtime overview lives in [`docs/agents-runtime-v2.md`](./docs/agents-runtime-v2.md).

## Privacy

ChatGPTBox runs locally in your browser. Network requests are only made to the providers/endpoints you configure and when you explicitly trigger a tool.

## Maintainer

This fork is maintained by [@aaaAlexanderaaa](https://github.com/aaaAlexanderaaa).

## Credits

This project is based on [josStorer/chatGPT-search-engine-extension](https://github.com/josStorer/chatGPT-search-engine-extension),
which was originally forked from [wong2/chat-gpt-google-extension](https://github.com/wong2/chat-gpt-google-extension) and inspired by
[ZohaibAhmed/ChatGPT-Google](https://github.com/ZohaibAhmed/ChatGPT-Google).

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/aaaAlexanderaaa/chatGPTBox/blob/master/LICENSE

[release-image]: https://img.shields.io/github/v/release/aaaAlexanderaaa/chatGPTBox?display_name=tag
[release-url]: https://github.com/aaaAlexanderaaa/chatGPTBox/releases/latest

[verify-image]: https://github.com/aaaAlexanderaaa/chatGPTBox/actions/workflows/verify-configs.yml/badge.svg
[verify-url]: https://github.com/aaaAlexanderaaa/chatGPTBox/actions/workflows/verify-configs.yml

[Chrome-image]: https://img.shields.io/badge/-Chrome-brightgreen?logo=google-chrome&logoColor=white
[Chrome-url]: https://chrome.google.com/webstore/detail/chatgptbox/eobbhoofkanlmddnplfhnmkfbnlhpbbo

[Edge-image]: https://img.shields.io/badge/-Edge-blue?logo=microsoft-edge&logoColor=white
[Edge-url]: https://microsoftedge.microsoft.com/addons/detail/fission-chatbox-best/enjmfilpkbbabhgeoadmdpjjpnahkogf

[Firefox-image]: https://img.shields.io/badge/-Firefox-orange?logo=firefox-browser&logoColor=white
[Firefox-url]: https://addons.mozilla.org/firefox/addon/chatgptbox/

[Safari-image]: https://img.shields.io/badge/-Safari-blue?logo=safari&logoColor=white
[Safari-url]: https://apps.apple.com/app/fission-chatbox/id6446611121
