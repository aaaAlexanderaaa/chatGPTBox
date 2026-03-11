# AGENTS.md

## Cursor Cloud specific instructions

### Overview

ChatGPTBox is a browser extension (Chrome/Firefox/Safari) that integrates AI chat assistants into the browser. It is a single client-side project (not a monorepo) with no backend server or database. All network calls are outbound to user-configured LLM endpoints.

### Node.js version

CI uses **Node.js 20** (`actions/setup-node` in `.github/workflows/pr-tests.yml`). Use `nvm use 20` before running any commands.

### Commands reference

See `package.json` `scripts` for the full list. The key ones:

| Task | Command |
|------|---------|
| Install deps | `npm ci` |
| Lint | `npm run lint` |
| Unit tests | `npm run test:agent` |
| Dev build (watch) | `npm run dev` |
| Production build | `npm run build` |
| Safari build | `npm run build:safari` |
| API gateway | `npm run api-server` |
| Verify config tables | `npm run verify` |
| Format | `npm run pretty` |

### Dev build & testing in browser

- `npm run dev` starts Webpack in watch mode. Output goes to `build/chromium/` and `build/firefox/`.
- To test Chromium builds: open Chrome/Chromium/Edge → extensions page → enable Developer mode → Load unpacked → select `build/chromium/`.
- Firefox builds are emitted to `build/firefox/` and can be loaded as a temporary add-on in Firefox.
- The extension requires an LLM API key or ChatGPT web login to actually chat; without it you'll see an `UNAUTHORIZED` error when sending messages. This is expected and does not indicate a build problem.
- The search/widget integrations and selection tools can still be exercised without a valid API key.

### Current settings structure

The redesigned settings UI is split into five top-level tabs:

- `General`: trigger mode, theme, provider/model selection, runtime mode, and default assistant.
- `Features`: site integrations.
- `Agents`: assistants, ZIP-imported skills, and MCP servers.
- `Modules`: API modes, selection tools, site adapters, and content extractors.
- `Advanced`: token/context knobs, export/import/reset, and other low-level settings.

Important distinction:

- `installedSkills` are agent/runtime skills shown under `Agents -> Skills`.
- `customSelectionTools` still exist and are edited under `Modules -> Selection Tools`.
- These are separate systems; imported skills do not replace the legacy selection toolbar/context-menu tools.

### Pre-commit hooks

The `pre-commit` npm package runs `prettier`, `git add`, and `eslint` before each commit (configured in `package.json` under `"pre-commit"`). If a commit fails lint, run `npm run lint:fix` then retry.

### Agent runtime summary

- Built-in assistants, built-in skills, and built-in MCP servers are shipped in `src/config/index.mjs`.
- Additional skills are imported from `.zip` packages and must contain `SKILL.md`.
- MCP in the current UI supports built-in toolkits and user-configured HTTP/SSE JSON-RPC endpoints.
- In `safe` runtime mode, HTTP MCP endpoints must use HTTPS; `developer` mode allows more permissive tool behavior.
- Assistant / Skills / MCP are intended for API/custom runtimes. ChatGPT Web models do not enable the agent-context flow.

### API Gateway (`npm run api-server`)

The project includes a local OpenAI-compatible API gateway that proxies ChatGPT Web through the extension. Architecture:
- `scripts/api-server.mjs` — Node.js HTTP+WebSocket server on `127.0.0.1:18080` by default
- `src/pages/ApiServer/` — Extension bridge page that connects the server to the ChatGPT backend
- The bridge can be enabled from the `ApiServer.html` page itself, or opened from the service worker console with `chrome.tabs.create({url: chrome.runtime.getURL('ApiServer.html')})`
- Supports `--port`, `--host`, `CHATGPT_GATEWAY_PORT`, and `CHATGPT_GATEWAY_HOST`
- Health endpoint: `http://127.0.0.1:<port>/health`
- Requires the user to be logged into `chatgpt.com`, and the bridge page must stay open while the server is in use

### Gotchas

- The production build (`npm run build`) creates the normal Chromium/Firefox bundles and additional `-without-katex-and-tiktoken` bundles, with a 10-second pause between the production passes.
- Release workflows upload `build/chromium.zip`, `build/firefox.zip`, `build/chromium-without-katex-and-tiktoken.zip`, and `build/firefox-without-katex-and-tiktoken.zip`.
- Safari packaging is separate and runs through `safari/build.sh` on macOS/Xcode.
- ESLint config (`.eslintrc.json`) ignores `build/` and `build.mjs`.
