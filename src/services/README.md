# services/

Provider integrations, agent runtime, MCP support, and shared session state for chatGPTBox.

## Layout

```
services/
├── apis/         # adapters: convert a port message into a provider stream
├── clients/      # vendored/handwritten SDKs for providers that need one
├── agent/        # agent runtime (gated behind CHATGPTBOX_ENABLE_AGENTS)
├── mcp/          # Model Context Protocol transport + tool-loop
├── skills/       # prompt-skill packages (zip importer + registry)
├── wrappers.mjs  # cross-cutting helpers (access tokens, port routing)
└── *.mjs         # session/cache/init helpers used by background + UI
```

## `apis/` vs `clients/`

**`apis/`** — Adapters between the extension's port-message protocol and a single
provider. An apis/ module receives a `session` + `port` and is responsible for:

- Building the request (headers, body, model name mapping).
- Streaming results back through `port.postMessage(...)`.
- Translating provider errors into the shared error shape from `apis/shared.mjs`.

Most apis/ files for REST-only providers (`openai-api.mjs`, `claude-api.mjs`,
`deepseek-api.mjs`, ...) speak HTTP directly via `fetch` / `fetchSSE` and have no
peer in `clients/`.

**`clients/`** — Vendored or custom SDKs for providers that need significant
client-side logic (auth, websocket lifecycle, request signing, GraphQL). One
directory per provider:

| Client       | Used by                          |
|--------------|----------------------------------|
| `clients/bing/`   | `apis/bing-web.mjs`         |
| `clients/claude/` | `apis/claude-web.mjs`       |
| `clients/poe/`    | `apis/poe-web.mjs`          |
| `clients/bard/`   | `apis/bard-web.mjs`         |

The rule of thumb: if it can be expressed as plain HTTP/SSE, put it in `apis/`.
If it needs websockets, complex state, or a hand-rolled protocol, extract a
client and have the apis/ file consume it.

> **Note:** `apis/chatgpt-web.mjs` currently breaks this convention by
> embedding its own websocket-singleton client. It should eventually be split
> into `clients/chatgpt-web/` + a thin apis/ adapter to match the others.

## `wrappers.mjs`

Higher-level helpers that span providers — access-token fetching, port routing
between background and content-script, model-name to api-mode translation. Code
that touches multiple providers (or doesn't belong to any single one) lives here
rather than under `apis/` or `clients/`.

## Agent / MCP / Skills

`agent/`, `mcp/`, and `skills/` are feature-flagged. When the build is produced
without `CHATGPTBOX_ENABLE_AGENTS=true` (or `--agents`), `build.mjs` swaps the
active modules for `*.disabled.mjs` stubs so the agent runtime never lands in
the production bundle. See `build.mjs:22-29` for the replacement plugin and the
`.disabled.mjs` stubs colocated next to each gated module.

## Session helpers

The standalone `*.mjs` files at the root of `services/` (`init-session.mjs`,
`local-session.mjs`, `chatgpt-web-conversation-cache.mjs`,
`chatgpt-web-history-transfer.mjs`, `chatgpt-web-thread-state.mjs`,
`model-lists.mjs`) hold cross-cutting state and are imported from both the
background service worker and content scripts. Keep these stateless or
storage-backed — module-scope state does **not** survive an MV3 service-worker
restart.
