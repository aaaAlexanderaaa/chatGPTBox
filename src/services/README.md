# services/

Provider integrations and shared session state for chatGPTBox.

## Layout

```
services/
├── apis/         # adapters: convert a port message into a provider stream
├── clients/      # vendored/handwritten SDKs for providers that need one
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
client-side logic (auth, websocket lifecycle, request signing):

| Client                    | Used by                     |
|---------------------------|-----------------------------|
| `clients/chatgpt-web/`    | `apis/chatgpt-web.mjs`      |

The rule of thumb: if it can be expressed as plain HTTP/SSE, put it in `apis/`.
If it needs websockets, complex state, or a hand-rolled protocol, extract a
client and have the apis/ file consume it. `apis/chatgpt-web.mjs` follows this
pattern: it is a thin re-export adapter, while the websocket transport,
conversation state, caching, and history-transfer logic lives in
`clients/chatgpt-web/` (`client.mjs`, `conversation-api.mjs`,
`conversation-cache.mjs`, `conversation-state.mjs`, `websocket-state.mjs`,
`thread-state.mjs`, `history-transfer.mjs`, `thinking.mjs`).

## `wrappers.mjs`

Higher-level helpers that span providers — access-token fetching, port routing
between background and content-script, model-name to api-mode translation. Code
that touches multiple providers (or doesn't belong to any single one) lives here
rather than under `apis/` or `clients/`.

## Session helpers

The standalone `*.mjs` files at the root of `services/` (`init-session.mjs`,
`local-session.mjs`, `model-lists.mjs`) hold cross-cutting state and are
imported from both the background service worker and content scripts. Keep these
stateless or storage-backed — module-scope state does **not** survive an MV3
service-worker restart.

## Removed providers

The web-scraper providers (Poe, Bing/Sydney, Bard, Claude web) were removed —
their upstream endpoints have been dead for years. Stored model selections for
those providers are migrated back to the default model at config load
(`config/migrations.mjs`).
