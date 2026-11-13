---
doc_type: architecture
status: current
authority: normative
last_reconciled: 2026-11-13
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

Gemini Web uses the same provider registry and conversation Port. Its
[background owner](src/background/gemini-web-service.mjs) coordinates dedicated
tabs and a durable uncertain-submission hold. The
[native operation](src/services/clients/gemini-web/native-runtime.mjs) runs in a
pinned top-level MAIN document, verifies an inspected runtime and the existing
input/service instances, then invokes the website's input submission handler.
Native model selection, request preparation, attestation and transport remain
with Gemini. Native turn IDs and terminal actions govern result acceptance;
the extension does not reconstruct Google HTTP requests. The
[Gemini contract](docs/gemini-web.md) owns limits and manual recovery. Its runtime
is in the core, without a separate optional-module manifest or background probe.

For DeepSeek Harness, the full-page UI talks to the module's background gateway.
RPCs call the configured loopback harness `/api` endpoints. The two downstream
event streams run from a harness-origin content script and return through the
module's carrier-tab bridge. The harness owns tool execution and authoritative
sessions; the extension owns its client presentation and user responses.

## Unified engine runtime

The [engine contract](docs/engine-contract.md) owns generation, explicit append,
history and run semantics. [contract](src/engines/contract.mjs),
[catalog](src/engines/catalog.mjs), [schema](src/engines/schema.mjs) and
[policy](src/engines/policy.mjs) are pure data/validation boundaries. The
[runtime](src/engines/runtime.mjs) owns admission, run identity, observation,
resource effects and terminal reduction; the serialized
[store](src/engines/store.mjs) owns durable claims, bindings and leases.
[Native adapters](src/engines/adapters.mjs) retain provider protocols and evidence.

[browser-runtime](src/engines/browser-runtime.mjs) authenticates extension senders
and projects the existing UI Port. [Legacy controls](src/engines/legacy-controls.mjs)
and [completion compatibility](src/engines/compat-completions.mjs) translate old
interfaces into those operations. The registry selects registered web engines
before its retained API/DSH providers. Native proxy response Ports are excluded
from generic UI dispatch. Existing exported native-service helpers are retained
for internal compatibility; production public controls use the common owner.

HTTP clients enter [the gateway](scripts/api-server.mjs), then
[ApiServer.html](src/pages/ApiServer/App.jsx), then the same background runtime.
[Versioned envelopes](scripts/lib/engine-bridge.mjs) pin the authenticated role,
operation ID and installation epoch across WebSocket and HTTP polling. The bridge
only forwards methods and observes common runs. MCP uses the
[generic gateway/waiter](scripts/lib/engine-gateway.mjs) with the existing gateway
API credential, principal and external engine grants. It has no separate gateway
token or per-engine MCP authorization switch.

Run protection is separate from its bounded, volatile result cache. An orphaned
possibly submitted run remains unknown and protected; metadata eviction cannot
permit replay. Native conversation leases follow the actual conversation ID,
including alternative opaque references. Active runs use bounded extension API
activity for MV3 lifetime; termination still relies on the journal and exact
readonly recovery. See the [execution evidence](docs/evidence/2026-11-12-engine-runtime-review.md)
for what was actually tested, installed and observed.

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

### Material, execution and binding ownership

The page assistant freezes the prepared request before Run; template-derived extra
page material is disclosed by that same object. Reading snapshots retain DOM
anchors locally; saved functions contain methods, never the captured page.
The GitHub discussion reader is shared by the legacy summary and page functions.

The DSH client preserves the native request `rpcId` into the user-message fold
and turn association; same-text prompts are not identities.

The conversation Port carries display `answer`, optional `finalContent`, terminal
`outcome` (`completed`, `stopped`, `incomplete`, `failed`), and `done` (input may
resume). A transport ack alone cannot replace an earlier non-success outcome.
Only an explicit new send/retry resets that state; a late terminal frame carrying
answer text must not reopen the result gate.
Each Card send/retry creates a local `preparing` transition before waiting, so
pre-start failure can end that attempt and show its actual cause. It carries a
`requestToken`; the wrapper echoes that token on the run's messages and emits
`started: true` only after explicit provider acceptance or usable answer output.
Entering the provider does not clear the draft, and lack of output does not
prove that its request was unsent. Explicit Stop targets the current token;
synchronous provider finalization precedes the fallback acknowledgement and
invalidation of late output. A stale Stop cannot cancel a newer token, and
untagged acknowledgements cannot finish its attempt. Other Port clients can
still omit the optional token.
Persisted-panel requests additionally carry `localSession: true`; the background
validates stored binding/existence before execution. The input clears only after
the matching `started`, never merely because local preparation began.
Conversation items, session and readiness transition in one reducer state, so
batched Stop/start packets cannot reuse stale readiness. A UI retry prepares its
local history separately from the provider's retry flag before appending a new
local record. Retry identifies its completed target by both question and stored
answer (confirmed final content or the provider's persisted display form) without
removing durable history. API request context can omit that target; only a
successful producer replaces it through `pushRecord`. Failed, incomplete,
stopped or unadmitted retries retain the original completed record. A new
ordinary question or connection choice clears the old replacement intent.
Result consumers use final content only after successful completion. DSH owns
its progress projection separately from its final text and cancellation request.
Its `dshStatus` notice may accompany a terminal result; consumers must process
both fields. After submission, its explicit Stop agent session action requests
session-wide cancellation. Closing the surface only detaches observation.

Local conversation records remain separate from remote continuation fields.
Cross-provider switches advance a stored binding generation and clear remote
fields; provider snapshots may restore only matching generations and providers.
ChatGPT index mutations from proxy pages route to the background's serialized
owner; a page-local Promise queue cannot serialize different JS contexts.
Local Box session mutations likewise use a named background owner and compare
binding-parent generations before replacement. A stale window keeps its view
and draft but blocks further input until the saved conversation is reopened;
an active request can still be explicitly stopped. Same-binding concurrent
transcripts are not automatically merged.
After a Port reconnect, explicit retry and automatic regeneration after a model
choice use the current connection; reconnecting alone never resends a question.
Input drafts retain edit versions and serialize writes per storage key within a
live extension context. Explicit navigation waits for their flush; late loads
cannot replace a newer edit. Separate windows do not merge drafts, and a process
lost before storage acknowledgement has no durability guarantee.

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

<a id="browser-experience-proposal"></a>

## Native ChatGPT input, 2026-10-30

The accepted [input scope](docs/product/browser-assistant.md#experience-design-2026-10-30)
adds local paste checking and a nearby draft-rewrite entry. These are page
features, independent of provider/API/MCP activation. Native message labels,
answer restoration, quota estimates and synchronization remain separate work.
[Delivery evidence](docs/plans/2026-10-30-chatgpt-native-input.md) distinguishes
implemented code, controlled browser checks, current-site acceptance and installation.

### Entries and request paths

| Action | Origin, forwarding and destination |
| --- | --- |
| Check an ordinary paste | Chromium's standalone [early entry](src/native-chatgpt/early.mjs) listens at `document_start`; the [controller](src/native-chatgpt/paste-controller.mjs) captures the supported event and runs [local rules](src/native-chatgpt/redaction.mjs). No provider or HTTP API receives this material |
| Review a match | The controller sends an operation ID to [background addressing](src/background/native-paste-review.mjs). The authenticated [extension review page](src/pages/PasteReview/App.jsx) receives text directly from the source document over a private Port; the background receives metadata only |
| Rewrite a draft | The [site entry](src/native-chatgpt/draft-entry.mjs) opens the existing browser assistant. Explicit Run uses the conversation Port, provider registry and chosen provider's HTTP API or site proxy; guarded input effects apply the result |
| Send on the website | The user operates ChatGPT's native frontend and its HTTP API. The enhancement does not create another Box request or relay this through the gateway |

[Activation](src/background/native-paste-activation.mjs) registers the standalone
early script using the existing scripting permission after opt-in. Default-off
has no early entry. Enabling/disabling verifies registration/removal before
publishing success; imports and startup reconcile the same record. Unreadable
registration state remains visibly unconfirmed. Already injected documents get
policy changes, but enabling protection requires a source-page reload. During
policy loading, only an already opted-in, verified main editor fails closed;
a document that confirmed off remains native. Unknown inputs remain native
with an unsupported status.

### Responsibility and dependencies

| Responsibility | Owner |
| --- | --- |
| Local computation | Fixed detectors and pinned RE2JS in [redaction](src/native-chatgpt/redaction.mjs); rules contain no selectors, credentials or remote transport. Matching, overlap, template grammar and resource limits live there and in the [feature contract](docs/product/browser-assistant.md#experience-design-2026-10-30) |
| Input capture and effects | Existing browser-assistant snapshots, preview, replacement and undo; [shared editable text](src/utils/editable-text.mjs) preserves paragraphs/BRs. The separate [paste target](src/native-chatgpt/paste-target.mjs) also protects the native insertion caret |
| Site interpretation | [Editor adapter](src/native-chatgpt/editor.mjs): exact HTTPS host, main `/` or `/c/...` URL, top document and unique enabled editor. GPTs, authentication and proxy pages are excluded; selectors do not enter shared provider transport |
| Settings and persistence | `Sites` contains independent default-off controls; `Functions` owns reusable instructions and `Engines` connections. [Native config](src/config/native-chatgpt.mjs) uses the existing config owner, successful-read/write state and dirty-editor conflict handling |
| Model/agent execution | Existing runtime, provider services and external harness. The enhancement creates no new tool loop, conversation database or engine; external invocation continues through existing authenticated API/MCP interfaces |

Rules use the existing storage key and support legacy literal-policy reads;
reading does not rewrite storage. Saving validates and atomically publishes the
normalized policy. Malformed imports remain invalid until repaired. Loading or
failed config reads cannot authorize an overwrite. Full config backups include
saved rules, never transient pasted originals. Older literal-only releases cannot
consume rule objects; rollback uses a compatible backup or disables checking.

### Privacy and operation lifecycle

The website owns its DOM; an isolated world or Shadow DOM is not a confidential
viewer. Status/cancellation may appear on the host, while originals, match values
and candidates stay in source memory and the extension-origin review. They are
not put into page events, postMessage, storage, generic provider Ports, logs or
exports. The generic listener excludes the private review protocol before logging.
This boundary does not sandbox other privileged software.

Protection covers a trusted, cancelable intercepted paste, not independent
website clipboard reads, typing, existing drafts, attachments, drag/drop, voice,
script input or API/MCP material. No clipboard/content-settings permission is
added. Firefox has no early paste entry or paste toggle. Image-only paste carries
an unchecked notice; mixed file/text is rejected.

One source document owns one pending operation; a second paste is blocked without
reading or queuing it. Complete unmatched text may insert automatically. Matches,
formatting or original-once sharing require the corresponding review/acknowledgement.
Invalid rules, overflow, failure or stale identity never authorize raw fallback.
Known credentials stay masked in redacted candidates; candidate auditing cannot be bypassed by overlapping
rules or by a candidate that happens to equal the original. Precise rule semantics
and limits remain at the owners linked above.

The handshake binds extension ID, the exact background-created review tab/URL,
frame zero and document ID. Runtime authentication returns the same random,
one-use proof privately to source and review. The private Port targets the original
tab/document; missing sender fields cannot replace the proof, and present fields
must match. Wrong proofs, copied URLs, duplicate readers and stale editors cannot
release text. Background capability records and source buffers have bounded
capacity/lifetimes; closure, navigation, disconnect, timeout and worker restart
invalidate the handshake rather than recover retained text.

Application rechecks source URL/document, editor instance, content/HTML and saved
range endpoints. Edits, caret changes, composition, navigation or policy changes
invalidate pending effects. Native insertion is attempted once, with no fallback
after failure or a partial effect. Pagehide cancels and releases pending work;
BFCache restoration reinstalls current settings without reviving a review or
model request. Disabling removes UI/observers and cancels the operation; an already
injected early listener stays inert. Disabled provider startup likewise performs
no token capture or first-run probe for that provider.

The initial acceptance target is desktop Chromium's ChatGPT main editor.
Controlled fixtures do not prove current-site framework acceptance or account
transitions that leave the document/editor intact. Those limits and installation
state remain in the delivery evidence, rather than becoming implied guarantees.
