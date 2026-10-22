---
doc_type: architecture
status: current
authority: normative
last_reconciled: 2026-10-23
---

# ChatGPTBox architecture

## System and runtime

ChatGPTBox is a Preact browser extension with Chromium Manifest V3 and Firefox
Manifest V2 builds. It provides page functions, floating conversations, a quick
popup, full settings, an independent panel, and a DeepSeek Harness client.
It has no hosted project backend or project database. Optional local Node.js
processes expose HTTP API and MCP interfaces; external providers and the user's
local harness remain separate systems.

| Boundary | Source owner | Responsibility |
| --- | --- | --- |
| Page entry and context | [Content script](src/content-script/index.jsx), [browser assistant](src/browser-assistant/) | Page/selection/input capture, function invocation, annotations and guarded input replacement |
| Shared conversation UI | [Components](src/components/), [conversation runtime](src/hooks/useConversationRuntime.mjs) | Conversation presentation and connection to extension messaging |
| Browser background | [Background entry](src/background/index.mjs), [message router](src/background/message-router.mjs), [providers](src/background/providers/registry.mjs) | Lifecycle wiring, runtime messages, provider routing, proxy-tab services |
| Provider transport | [Services](src/services/README.md) | API request adaptation and web-provider protocol/state handling |
| Configuration | [Config storage](src/config/storage.mjs), [engine resolution](src/config/engine-selection.mjs) | Defaults, migrations, stored settings, engine selection |
| Browser functions | [Function catalog](src/browser-assistant/catalog.mjs), [functions](src/browser-assistant/functions.mjs) | Shared function identity, presets, legacy-tool projection, validation, portable import/export |
| Optional engine modules | [Module registry](src/modules/index.mjs), [public module API](src/modules/api.mjs) | ChatGPT Web, Grok Web, and DeepSeek Harness manifests and module boundaries |
| Settings and popup | [Settings center](src/options/SettingsCenter.jsx), [popup](src/popup/) | Full configuration and quick controls |
| Local API gateway | [Server](scripts/api-server.mjs), [bridge page](src/pages/ApiServer/App.jsx) | Authenticated local HTTP clients connected to the extension over WebSocket or HTTP polling |
| Local MCP server | [Server](scripts/mcp-server.mjs) | Authenticated MCP `ask_chatgpt`, using the local API gateway |

## Request flows

For a page function, the content script opens the browser assistant with the
selected material. The assistant uses the existing conversation transport and
extension runtime Port. The background provider registry selects an adapter.
An API adapter calls the configured provider endpoint; a web adapter delegates
to its service and site proxy page. The answer streams back through extension
messaging to the page UI. Source matching and stale-input checks happen before
annotations or text replacement. See the [usage guide](docs/browser-assistant.md).

For an external HTTP client, `scripts/api-server.mjs` accepts an authenticated
request. `ApiServer.html` receives it over the local bridge and asks the extension
background to run the web-provider request. ChatGPT Web traffic reaches the
site's HTTP APIs through the ChatGPT proxy page, using the logged-in browser
session. The gateway streams or acknowledges the result according to its
[interface contract](docs/api-server.md); an uncertain write is not silently
replayed. The [MCP server](docs/mcp-server.md) is an additional client of this
gateway, not an extension-internal agent runtime.

For DeepSeek Harness, the full-page UI talks to the module's background gateway.
RPCs call the configured loopback harness `/api` endpoints. The two downstream
event streams run from a harness-origin content script and return through the
module's carrier-tab bridge. The harness owns tool execution and authoritative
sessions; the extension owns its client presentation and user responses.

## Dependency and state boundaries

The core reaches optional modules through the top-level aggregation files:
`src/modules/api.mjs`, `index.mjs`, `background-services.mjs`, and
`settings-cards.mjs`. Module implementations receive dependencies through
injection and the published API; they do not import arbitrary core internals.
The concrete restrictions live in [ESLint](.eslintrc.json) and the
[module boundary test](tests/module-boundary.test.mjs). Changing this boundary
requires updating this owner and both guards together.

Shared runtime messages are defined in [the protocol](src/protocol/messages.mjs).
Update senders and receivers through that owner. Provider-specific request,
response, and recovery semantics stay in their provider/service code and
interface contract, rather than being independently inferred by UI surfaces.

Persisted settings and migrations belong to config storage. The browser function
catalog projects existing selection tools alongside saved functions; this is
not the removed assistant/ZIP-skill/HTTP-MCP runtime. DeepSeek Harness skills
belong to that external engine. ChatGPT Web history/cache and acknowledged turn
recovery have separate state owners under `src/services/clients/chatgpt-web/`;
see [cache lifecycle](docs/cache-lifecycle.md) and
[gateway recovery](docs/api-server.md#at-most-once-writes-and-bounded-recovery).
The [September stream study](docs/chatgpt-web-stream-resume.md) records its
protocol sources. UI visibility does not
determine whether an acknowledged remote turn has finished.

MV3 service workers can restart. Durable state must use the existing storage or
recovery owner; module-local memory alone cannot promise restart persistence.
Page context is sent according to the chosen function scope. Config export and
function export have different contents; do not infer one from the other.

## Build and verification boundaries

[Webpack build entrypoints](build.mjs) produce Chromium, Firefox, and reduced
bundles. [Package scripts](package.json) and [CI](.github/workflows/pr-tests.yml)
declare the supported development runtime. Safari packaging and the former
extension-internal agent runtime are retired; old documents referring to them
are historical evidence.

Structural guards and unit tests verify specific boundaries. They do not prove
live provider compatibility, full DSH Web parity, or visual/interaction quality.
The [development contract](docs/contracts/development.md#verify-promises-and-effects)
defines claim-appropriate evidence. Product scope belongs to
[product contracts](docs/product/contracts.md), not this architecture inventory.
