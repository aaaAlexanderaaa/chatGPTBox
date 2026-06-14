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
| `clients/bing/`           | `apis/bing-web.mjs`         |
| `clients/claude/`         | `apis/claude-web.mjs`       |
| `clients/poe/`            | `apis/poe-web.mjs`          |
| `clients/bard/`           | `apis/bard-web.mjs`         |
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

## Agent / MCP / Skills

`agent/`, `mcp/`, and `skills/` are feature-flagged. When the build is produced
without `CHATGPTBOX_ENABLE_AGENTS=true` (or `--agents`), `build.mjs` swaps the
active modules for no-op stubs so the agent runtime never lands in the
production bundle.

The stubs live together in `src/stubs/` (not colocated with the real modules)
so that a real module and its stub no longer share a base filename — grepping
for `agent-context` hits the real module only, not both. The mapping is
configured in `build.mjs` (`replaceModuleWhenAgentsDisabled`):

| Real module                         | Stub (production build)               |
|-------------------------------------|---------------------------------------|
| `services/agent-context.mjs`        | `src/stubs/agent-context.stub.mjs`    |
| `services/agent/session-state.mjs`  | `src/stubs/session-state.stub.mjs`    |
| `services/mcp/tool-loop.mjs`        | `src/stubs/mcp-tool-loop.stub.mjs`    |
| `services/skills/importer.mjs`      | `src/stubs/skills-importer.stub.mjs`  |
| `popup/components/AgentsTab.jsx`    | `src/stubs/agents-tab.stub.jsx`       |

Each stub must export the same set of symbol names as its real module. This
contract is enforced by `tests/feature-flag-contract.test.mjs`, which statically
parses both files and fails if the export name sets diverge — so adding an
export to a real module without mirroring it in the stub is caught at `npm test`
time, rather than producing a silent undefined import in the production bundle.
Note that arity/behavior may differ by design: `session-state`'s mutation
helpers are 1-arg no-ops in the stub, and `skills/importer` throws `'disabled'`.

## Session helpers

The standalone `*.mjs` files at the root of `services/` (`init-session.mjs`,
`local-session.mjs`, `model-lists.mjs`) hold cross-cutting state and are
imported from both the background service worker and content scripts. Keep these
stateless or storage-backed — module-scope state does **not** survive an MV3
service-worker restart.
