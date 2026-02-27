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
| Format | `npm run pretty` |

### Dev build & testing in browser

- `npm run dev` starts Webpack in watch mode. Output goes to `build/chromium/` and `build/firefox/`.
- To test the extension: open Chrome → `chrome://extensions` → enable Developer mode → Load unpacked → select `build/chromium/`.
- The extension requires an LLM API key or ChatGPT web login to actually chat; without it you'll see an `UNAUTHORIZED` error when sending messages. This is expected and does not indicate a build problem.
- The "Ask ChatGPT" search integration widget appears on Google, DuckDuckGo, and other supported search engine result pages even without authentication.

### Pre-commit hooks

The `pre-commit` npm package runs `prettier`, `git add`, and `eslint` before each commit (configured in `package.json` under `"pre-commit"`). If a commit fails lint, run `npm run lint:fix` then retry.

### API Gateway (`npm run api-server`)

The project includes a local OpenAI-compatible API gateway that proxies ChatGPT Web through the extension. Architecture:
- `scripts/api-server.mjs` — Node.js HTTP+WebSocket server on `localhost:18080`
- `src/pages/ApiServer/` — Extension bridge page that connects the server to the ChatGPT backend
- The bridge page must be opened from the service worker console: `chrome.tabs.create({url: chrome.runtime.getURL('ApiServer.html')})` (direct URL navigation is blocked by Chrome MV3)
- Requires the user to be logged into chatgpt.com for the ChatGPT Web API to work

### Gotchas

- The production build (`npm run build`) runs two sequential Webpack compilations with a 10-second sleep between them. It takes ~30 seconds total. The dev build is faster since it only runs one compilation.
- ESLint config (`.eslintrc.json`) ignores `build/` and `build.mjs`.
