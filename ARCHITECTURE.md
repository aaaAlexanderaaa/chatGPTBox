---
doc_type: architecture
status: current
authority: normative
last_reconciled: 2026-10-31
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

<a id="browser-experience-proposal"></a>

## Native ChatGPT input, 2026-10-30

The user approved the [first-delivery scope](docs/product/browser-assistant.md#experience-design-2026-10-30):
local checking during ordinary paste and a nearby draft-rewrite entry. Code is
implemented; [delivery evidence](docs/plans/2026-10-30-chatgpt-native-input.md)
separates controlled browser observations, current-site compatibility and installation.
These features belong to the page boundary, independently of ChatGPT Web provider,
API gateway and MCP activation. Native message labels, answer restoration, quota
estimates and synchronization are outside this delivery.

### Entries and request paths

| Action | Origin, forwarding and destination |
| --- | --- |
| Ordinary text paste with checking enabled | The Chromium-only standalone [early entry](src/native-chatgpt/early.mjs) registers a synchronous window capture listener at `document_start`, before configuration I/O. The [controller](src/native-chatgpt/paste-controller.mjs) stops the supported event, captures its target, and runs [local rules](src/native-chatgpt/redaction.mjs). Complete unmatched plain text is inserted; matches or formatting require an extension-origin review. No provider, HTTP API, gateway or MCP participates |
| Open paste review | The controller sends only an operation ID to [background review addressing](src/background/native-paste-review.mjs). It opens `PasteReview.html`, authenticates that exact review document and issues a random one-use capability. The [review page](src/pages/PasteReview/App.jsx) uses a private, original-document-targeted Port to receive text directly from the controller. The background never receives original or candidate text |
| Click “Rewrite draft” | The [site entry](src/native-chatgpt/draft-entry.mjs) captures the draft/selection and opens the existing browser assistant without running it. After material preview and explicit Run, the runtime Port and background provider registry forward to the chosen provider's HTTP API or existing web-provider service/proxy. Existing comparison, guarded replacement and undo apply the result |
| Send on the website | The user operates the native ChatGPT frontend, which sends its own request to ChatGPT's HTTP API. The enhancement does not relay this through the local gateway or create another Box conversation |

[Activation](src/background/native-paste-activation.mjs) uses the existing
`scripting` permission to register the standalone early file only after opt-in.
The default-off profile has no early paste entry. Settings authenticate to the
background; enabling and disabling verify the browser's registration/removal
before publishing success. Storage imports/startup reconcile the same record.
Failure attempts verified cleanup and revokes enabled only when off is confirmed;
an API state that cannot be read or changed retains an explicit unconfirmed-state
warning rather than claiming protection or successful disablement.
Already injected documents receive policy changes; enabling requires source-page
reload. Until policy is readable, only an already opted-in entry's verified main
editor is fail-closed. A document that has confirmed off stays native during
later settings refresh, including a persisted page restore. Other/unknown inputs remain native with an unsupported
status; the controller never captures every editable element under `main`.

[Settings](src/popup/components/NativeChatgptSettings.jsx) live in `Sites` with
independent default-off controls. `Functions` owns reusable instructions;
`Engines` owns connections. Config defaults belong to
[src/config/native-chatgpt.mjs](src/config/native-chatgpt.mjs), merged by the
existing storage owner. All runtime message types remain in
[src/protocol/messages.mjs](src/protocol/messages.mjs).

### Responsibility and dependencies

| Responsibility | Owner |
| --- | --- |
| Explicit text computation | Fixed local detectors plus pinned RE2JS for user regex rules, or the already selected external engine for explicit rewrites. Local rules have no selectors, credentials or remote transport |
| Browser context and effects | Existing browser-assistant snapshots, material preview, replacement and undo. The new [paste target](src/native-chatgpt/paste-target.mjs) separately preserves the insertion caret and native editing/undo path |
| Site interpretation | [Native editor adapter](src/native-chatgpt/editor.mjs): exact HTTPS host, main `/` or `/c/...` URL, top document and unique enabled `#prompt-textarea` or observed guest `textarea#mobile-composer-prompt`. GPTs, authentication and proxy pages are excluded. Site selectors do not enter shared provider transport |
| Model/agent execution | Existing conversation runtime, provider services and external harness. Native enhancement creates no new tool loop, conversation database or engine |
| External invocation | Existing authenticated API/MCP interfaces. Native user activity does not automatically pass through them |

### Privacy and operation lifecycle

The website owns its DOM. An isolated JS world or Shadow DOM is not a confidential
viewer. The host receives status and cancellation controls; review originals,
match values and candidates appear only on the extension origin. No raw value is
rebroadcast through page events, `window.postMessage`, storage, generic provider
Ports, diagnostics or exports. The generic Port listener excludes this private
protocol before logging. These boundaries do not sandbox privileged code or
other high-permission software inside/outside the extension.

Protection covers the intercepted, trusted, cancelable paste event. It does not
block independent `navigator.clipboard` reads by a website with clipboard-read
permission. No clipboard permission or content-settings permission is added.
Manual typing, existing drafts, script input, attachments, drag/drop, voice and
external API/MCP inputs are outside this local check. Firefox has no early-paste
entry or paste toggle. Reload the source page after extension installation/update;
an old content-script document is not silently promoted to protected.

One source document holds at most one operation. While pending, a second paste
is blocked without reading/queuing its text. Checking, review, insertion, failure,
cancellation and stale-target states have visible next actions. Complete no-match
plain text may insert automatically; selected redaction or an explicit one-time
original choice requires review. Invalid rules, overflow, failure and stale
identity never authorize raw fallback. Image-only paste passes with an unchecked
notice; mixed file/text is rejected. Other website inputs are left untouched.

The review handshake binds browser extension ID, exact background-created review
tab/URL, frame zero and review document ID. The background authenticates the
review via runtime messaging, whose sender metadata is present in the tested
Chromium version. It returns the same independent random proof privately to the
original caller and authenticated review. Only the first correct proof on the
private Port can release text. `tabs.connect` still targets the original tab and
`documentId`; missing source tab/URL/document fields on that Port cannot substitute
for the proof. Present source tab/URL fields must match. A copied URL, wrong proof,
second reader, closed connection or stale editor cannot acquire the buffer.

The background keeps metadata/capabilities only, with at most 32 concurrent
review records and a five-minute TTL. It removes records on source completion,
review closure/navigation or expiry. Review closure also sends a proof-bound,
document-targeted cancellation; the content operation independently expires in
five minutes. Worker restart loses authentication records, so pending handshakes
fail closed. A source document reload/close tears down its operation. BFCache pagehide also
cancels and releases it; persisted pageshow recreates the controller and draft
entry using current settings. No pending review or model invocation is revived.
Composition start cancels pending paste and pauses paste/rewrite until composition
ends; native paragraph/BR material capture preserves line boundaries. The live
caret is checked while the source is focused, without treating review-window
focus as permission to move it. There is no
persistent review recovery.

Custom rules use RE2-compatible syntax and `{pattern, flags, replacement}`.
Each rule scans the original text globally, left to right with non-overlapping
matches, as ordinary regex replacement does; this does not enumerate every
overlapping occurrence (`aba` in `ababa` matches only the first occurrence).
Rules never rescan another rule's output. Overlapping findings across detectors
form one review unit. Any secret locks the entire union. A single custom finding
covering that union may provide its replacement; competing custom findings or a
partial custom/built-in overlap use a conservative CUSTOM alias and show the
conflict. Adding a broad rule cannot override an existing conflict.

Templates are parsed once: fixed text, deletion, `$$`, `$&`, `$1`–`$99` and
`$<name>` are supported only for declared groups (at most 16 groups per rule).
Ambiguous/unknown dollar syntax and whole-input prefix/suffix references are
rejected. Captures can preserve non-secret text, which is shown in the candidate.
After each actual selection, the final candidate is audited for known secret
formats before it can be confirmed or written back; this blocks rather than
cascades another replacement pass. Explicit original-once remains separately
acknowledged.
When matches exist but the selected candidate equals the original, it requires
the same explicit original-sharing acknowledgement at both review and source.

Local limits are 20000 UTF-16 input units, 200 raw findings before merging,
100 rules, 512 pattern units, 256 template units, 16 captures per rule,
512 compiled instructions per rule and 16384 in total. Expanded replacements
are capped at 20000 units and every possible review-selection output at 40000.
A 500 ms soft budget is checked between compile/find steps; it cannot interrupt
one engine call or establish a hard latency/heap bound. RE2JS also rejects
oversized/nested counted repetitions; production-browser probes must supplement
these structural guards. These limits apply after clipboard materialization;
`ClipboardEvent.getData` itself materializes browser-provided text. Exceeding a
limit is incomplete, never clean. Aliases are stable within one operation and
namespaced across operations. Known credentials are irreversibly masked;
no reversible credential map is created. Ending review clears source/review
buffers. The existing `chatgptNativePasteTerms` storage key now holds rule objects;
legacy strings are trimmed/validated under their old limits and escaped as
literal RE2 patterns with fixed `[REDACTED]` replacement. Their match meaning is
retained, but the old custom identity aliases become one fixed replacement.
Reading does not rewrite storage; the rules editor saves the normalized schema
atomically through the existing config owner. Malformed imports stay invalid
until explicitly repaired/saved. Rule configuration is included in full backups;
transient pasted originals are not. No matcher carrying pasted input is cached.
Rule writes publish configuration through authoritative storage events after
persistence, not an optimistic active policy. Failed writes retain the unsaved
draft and an actionable error. Incoming saved-policy changes preserve a dirty
editor and require explicit conflict resolution. Initial configuration loading
merges events received during its read rather than overwrite newer policy.
The hook exposes a separate, non-persisted read state. `SettingsCenter` forwards
it through `FeaturesTab` to the native settings section; loading/failure hides
editable enhancement controls and offers reload. Native rule writes also reject
before a successful read. Saved-policy validation and unsaved-draft errors have
distinct messages; an invalid draft does not imply the active policy is invalid.
Older literal-only releases cannot consume rule objects and fail their validation;
rollback can disable local paste checking or restore a literal-policy backup,
rather than reinterpret objects as strings. Legacy reads remain supported for
existing backups; there is no second active storage key or dual-write phase.

Application rechecks source URL/document, exact editor instance, content/HTML and
saved range endpoints. User edits, target interaction, navigation, changed policy,
close/disconnect and timeout invalidate pending work. Native `insertText` is
used once with no fallback after a partial/failed effect. This requires browser
and current-editor evidence beyond unit tests. The declared initial target is
desktop Chromium's ChatGPT main editor; controlled tests cannot by themselves
prove the website framework accepted the result. Account transitions that do
not replace/navigate the document or editor remain unverified.

Disabling a feature removes its UI/observers and cancels its operation; the early
paste listener remains inert while disabled. Rollback inserts no retained raw
text and replays no submission. The content-script token capture and first-run probe now honor a disabled
ChatGPT Web engine; independent site features do not bootstrap that engine.
Enabled-engine behavior is preserved. Existing module seams, provider wire
behavior, history/cache, gateway and Drafts interfaces are unchanged.
