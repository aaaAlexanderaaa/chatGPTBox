---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-11-21
---

# Gemini Web

For native-runtime maintenance, use the repository's
[Gemini adaptation skill](../.agents/skills/gemini-web-adapt/SKILL.md).
This contract owns behavior; the skill routes investigation, regression and
installation checks without extending account-test authorization.

## November 18 model selection

On 2026-11-18, the user selected **4 Neon / High** as the default Gemini Web
model alongside adapting the signed-in `en.rF38EnUYaoQ.2018.O`, public
`en_US.froaSlPXDN0.2018.O`, and subsequent signed-in `en.NcE3BnbhJwQ.2018.O`
and `en.c3ZkJFn_XPs.2018.O` compilations. The local
selector is `gemini-4-neon-high` (`geminiweb/gemini-4-neon-high`), expecting
native model description `4 Neon` and `THINKING_LEVEL_EXTENDED` (High; API/engine
`thinkingEffort: "high"` or omitted). This replaces the November 14 4 Hydrogen /
Medium selection for new work; earlier runs retain their recorded model and
outcomes. Every new request still checks the selected native model and thinking
level, with no automatic fallback.

## November 14 model selection

After two 4 Argon / High continuations ended without an attributable native
response, the user selected **4 Hydrogen / Medium** for the current Gemini
connection and verification. The native UI reports `4 Hydrogen` and
`THINKING_LEVEL_MEDIUM`. This replaces the initial single-model selection for
new work; earlier runs keep their recorded model and unresolved outcomes.
The local selector is `gemini-4-hydrogen-medium`. Every new request still checks
the selected native model and thinking level, with no automatic fallback.

The user also requested checking time fields. Gemini's converted native response
contains a `timestamp` Date from the server response's protobuf timestamp field;
it is an instant, not a duration. Preserve it as `responseTimestamp` in final
result metadata and assistant history messages when valid. Public run
`createdAt`/`updatedAt` remain local lifecycle timestamps. Do not label their
difference, native frontend event timestamps, or an inferred interval as official
thinking time. Timestamp availability never replaces request/turn identity or
terminal-response evidence.

The November 14 Hydrogen trial returned the same native turn and answer through
live completion and a subsequent history read, but their native timestamps
differed by about 3.6 seconds. Preserve each source's value; do not treat this
field as an immutable completion time or use it to correlate a result. No
official thinking-duration field was established; `thoughtDurationSec` remains
null for this trial.

## November 13 history and refresh-recovery delivery

The user requested native conversation lists, conversation detail, continuation
after refresh/reopening, and Gemini support in Drafts. This extends the original
live-document-only scope described below. [The current delivery record](plans/2026-11-13-gap-closure.md)
owns implementation and acceptance progress; this section is the accepted new
boundary, not a claim that every new operation has passed.

History uses the website's verified native read service, with explicit paging,
freshness and incomplete/unsupported content. Reads never submit prompts or
change the model. Pinned and ordinary conversations must both be reachable.
Reopening a writer requires the pinned account, native conversation and completed
head to match in its new dedicated document; it never reconstructs a conversation
by sending its transcript as a new question.

The native client request ID is absent from inspected historical requests.
Precise recovery therefore requires a produced-output identity associating the
current common run and native request with the server turn observed and persisted
after acceptance, plus its response identity when available. The previous head is
only a continuation input and cannot supply this proof. A crash before the new
identity is durable remains unknown, even if similar text exists in history or
the parent turn has a complete answer. Older records without that proof cannot
be upgraded by guessing.
Only the matching verified terminal read may resolve its own submission hold;
neither refreshing nor an unrelated newer completion may clear it. Drafts keeps
the same run/idempotency identity across uncertain acknowledgement and Get.

The 2026-11-12 user request initially added Gemini Web with **4 Argon, Thinking
level High**; the November 14 selection above owns new requests. The user
subsequently clarified that the adapter
should reuse native website JavaScript, like the ChatGPT adapter. Account safety
takes priority; an unverified or challenged path must refuse submission.
The [delivery record](plans/2026-11-12-gemini-web.md) separates implementation,
controlled verification, real-account observations and installation.

## Operation and account boundary

Gemini Web is off by default. Enabling it does not open a site, probe an account
or submit a question. `Engines` enables the engine; `Gemini Web` owns its page
check, account-session instructions and recovery. An explicit page check reads
the current website's readiness without sending a prompt. A ready check is not
a durable guarantee of access; every submission checks again.

The first successful page check binds the current account using a random local
salt and a fingerprint of its native account label. Raw account labels remain
in the website context. A later account mismatch refuses work; this version
does not switch or automatically rebind accounts. Use the originally checked
account in the same browser profile.

The local selector `geminiweb/gemini-4-neon-high` identifies this adapter; it is
not a Google API model ID. The adapter reads the selected native model and
thinking state, verifies `4 Neon` and the observed High (`THINKING_LEVEL_EXTENDED`)
mapping, and lets the website build its actual request. It does not silently
downgrade or choose another account/model when access changes. Set the requested
options on Gemini if the readiness check reports a mismatch.

In a fresh extension-owned blank tab, the adapter applies High through the
inspected native thinking-menu setter when that runtime supports it, then
checks the selected value. This handles the website resetting thinking to Low
on a new document. The setter chooses from the site's available options; an
unavailable High remains a refusal. It does not rewrite request fields or
change another model to a fallback. Existing manual tabs are not configured.

Keep the dedicated tab's model selection unchanged during a request. Native
preparation can be asynchronous: the adapter checks before invoking the handler
and verifies the model/High values in the resulting native request. A selection
changed during that interval can already affect the native request; it is
reported and held, without a retry. This is not an atomic lock on Gemini's UI.

An extension conversation or page function reaches the background provider,
then an extension-owned Gemini tab. In the same pinned MAIN document, the
adapter fills the native input control and invokes its existing submission
handler once. That handler retains the website's input checks, request
construction, content-bound attestation and HTTP/streaming transport. There is
no hand-built Google HTTP request, copied cookie/token, synthetic Send event,
CAPTCHA bypass, fake input event or fabricated attestation.

This is a limited desktop Chromium integration for inspected runtimes and the
strictly equivalent compilations described below. Unconfirmed runtimes, missing
document identity, mock service instances, account
changes, challenges, quota/errors, drafts, attachments and active generation
refuse further submission. Credentials remain in the website's MAIN context;
the extension receives the salted account fingerprint, readiness, turn metadata
and output. MAIN is not a
security sandbox against the website itself.

## Automatic compatibility for identifier changes

The November 14 user request initially authorized automatic compatibility when
only build IDs or internal obfuscated names changed. On 2026-11-21, after daily
signed-in Google rollouts repeatedly changed unrelated code across the 6 MiB
application bundle and loaded dozens of lazy feature chunks, the user authorized
a two-tier automatic compatibility path plus offline adaptation tooling to lower
maintenance cost while keeping core submission, attestation, account and
single-invocation protections in force:

1. **Tier 1 (complete compilation equivalence, Format 4)**: When the loaded
   public compilation has 1–4 total units (`scope` unset) and matches a bundled
   reference in `src/config/gemini-code-references.json`, the adapter derives a
   `mode: 'complete'` proof requiring exact token equivalence across every unit,
   absent deferred exports (`dYc`/`Ywg`/`VAa`, `iZc`/`mzg`/`VAa`,
   `WZc`/`mAg`/`UAa`, `XZc`/`nAg`/`UAa`, `b_c`/`FAg`/`UAa`, `O4c`/`kFg`/`LAa`),
   and inactive `window.wizbind`.
2. **Tier 2 (verified structural core contract, `mode: 'structural-core'`)**:
   When Tier 1 does not match—including signed-in pages that load more than four
   same-version lazy `m=...` feature chunks—`inspectGeminiPublicCompilation`
   validates every observed `gemini.gstatic.com` script URL for single version
   and safe syntax, selects the unique core pair (`m=_b` runtime and `m=vLefie`
   preferentially, falling back to unique `/exm=_b/` root app bundle when
   `m=vLefie` is absent, `scope: 'core'`), and
   `discoverStructuralGeminiContract` statically parses those public bundles
   without executing website code. It dynamically resolves Closure prototype
   aliases (`_.aa`/`_.ba` etc.) and deferred registration helpers (`_.ba`/`_.ca`/`_.da`),
   requires every one of the 31 native contract identifiers and all 20 supported
   `structuredContent` `nodeType` codes (from the native protobuf converter switch)
   to resolve unambiguously without collision, checks all eight core entry ASTs
   (`submit`, `send`, `prepare`, `attestation`, `thinking`, `historyClass`,
   `list`, `read`) plus the submit-to-`sendRequest`, read-converter, and
   `structuredContent` converter helpers for absence of dynamic code (`eval`,
   `Function`, `with`, `import()`), absence of direct `fetch`/`XMLHttpRequest`
   in `submit`, reachability from `submit` to native `service.sendRequest`,
   `bardModeService` model/thinking handling in `prepare`,
   `botguardResponse`/`botguardSalt` in `attestation`, and `routingVariantId`
   menu selection in `thinking`, then computes all eight exact SHA-256
   fingerprints. `renderAnswer` uses the contract's verified `nodeTypes` map
   (defaulting to the legacy `1..21` enum for older static profiles) and still
   refuses any unknown `nodeType` (such as the `nodeType: 16` block added in
   `en_US.t2_00FiRTFM.2018.O`).

**Trade-off boundary**: Tier 2 survives ordinary daily Google UI/feature
rollouts without rebuilding the extension, because changes outside the verified
core invariants do not invalidate it. Unlike Tier 1, Tier 2 does not prove that
unrelated modules or lazy feature chunks outside the verified core anchors are
unchanged. Both tiers remain strictly volatile and document-scoped (never
persisted into trusted profiles), and MAIN still rechecks the single build
version across all observed `gemini.gstatic.com` URLs, the core URL inventory
(tolerating additional same-version lazy chunks that load during hydration while
still failing closed on mixed versions or invalid URLs), document/runtime/nonce
identity, real component/service instances, all eight exact SHA-256 function
fingerprints, `SignOutOptions` account fingerprint, `4 Neon` /
`THINKING_LEVEL_EXTENDED` (High), draft/busy/challenge checks, and
single-invocation holds before every native operation.

The bundled Format-4 reference currently covers the complete public runtime and
application units of the inspected `en.c3ZkJFn_XPs.2018.O` compilation
(alongside explicit profile mappings for `en_US.t2_00FiRTFM.2018.O`,
`en.NcE3BnbhJwQ.2018.O`, `en.rF38EnUYaoQ.2018.O`, `en_US.froaSlPXDN0.2018.O`,
`en_US.sVUVnpt2JHE.2018.O`, `TX_RV411Rb4.2018.O` and earlier historical builds).
Its generator checks all eight native source fingerprints against the existing
profile. The reference contains code digests, token masks and symbol names,
without website sessions, account data or captured conversations.

Public scripts are read only from already observed `gemini.gstatic.com`
`/_/js/...` or `/_/mss/boq-gemini-web-uiserver/_/js/...` URLs without
credentials, redirects, path traversal or hashes, allowing only an empty query
string or the boq `?wli=BardChatUi...` WASM-list parameter. Reads are bounded to
four core units, 8 MiB total and a 12-second network deadline. History
list/read preflight actions (`history.list`, `history.read`) and held-tab
`review` share the same unattempted compatibility discovery trigger before
surfacing `OPERATION_NOT_IMPLEMENTED` or requiring unverified acknowledgement.
When an already-reused background read tab (`state.readTab`) still holds an
older build and refuses with `GEMINI_RUNTIME_UNSUPPORTED` (`dispatched: false`),
`readImpl` retires only that read-only tab once and retries on a fresh
background read tab without touching any writer tab.

When automatic verification still refuses (for example after a structural
refactor to core submission or history anchors), `Settings → Gemini Web` shows
the validated public `Website build` identifier and copy buttons for the two
public core bundle URLs and the offline adaptation command
`npm run gemini:adapt -- "<m=_b URL>" "<m=vLefie URL>" --write` (which runs
`scripts/adapt-gemini-build.mjs`, refuses unknown deferred exports without
manual audit, updates `gemini-web.mjs` and `namespace-receivers.mjs`, rebuilds
and verifies `gemini-code-references.json`, and deletes temporary files). For
local Chromium refreshes, `npm run build:extension:fast` builds and installs
only `build/chromium` without waiting for all four release archives; full
packaging still uses `npm run build` / `npm run build:extension`.

The [automatic-adaptation delivery record](plans/2026-11-14-gemini-auto-adapt.md)
owns the earlier Tier-1 verification evidence and its limits. Reference
maintenance uses `scripts/adapt-gemini-build.mjs` and
`scripts/build-gemini-code-reference.mjs` with explicitly inspected public
files; matching eight root hashes alone is not authorization to add a new
reference.

## Submission, completion and recovery

The user's November 16 correction authorizes three independent concurrent Gemini
writes across extension, API, MCP and Drafts. Active and unresolved requests each
consume one of those slots. A fourth request is refused rather than queued;
another conversation may use a remaining slot while one result is unknown.
Appends to the same native conversation remain exclusive, including alternative
opaque references. The [concurrency delivery record](plans/2026-11-16-gemini-concurrency.md)
tracks implementation and acceptance of this replacement for global single-write
admission.

Each request has its own durable native submission record, acknowledged before
native preparation/submission. One serialized background owner merges state
updates without serializing generation waits. Unreadable or unconfirmed storage
refuses further admission. A worker restart retains each uncertain record and
cannot authorize replay. Native v1's old hold migrates as one occupied slot. V2
keeps `hold: true` as a rollback fence because older owners explicitly reject a
non-object hold. Actual protections live in `holds`, keyed by native request ID;
older owners refuse v2 rather than overlook its multiple protections.
Only the background owns this state; UI and MAIN cannot clear it directly.
Known account changes, website challenges and error/account notices pause new
account writes across all slots. Other already-submitted requests keep their
own observation and recovery identities; no failure triggers another Send.

An observed account notice raises an immediate local submission fence. Pause
publication and not-yet-dispatched Send share a short gate that rechecks after
browser tab lookup and before MAIN dispatch. The gate ends when the browser call
is issued; awaiting that document's reply cannot block the other writers. An
already-dispatched MAIN call retains its original possibly-submitted protection,
including the website's asynchronous preparation/transport. A racing Stop does
not discard an observed account pause. Clearing it requires the existing native
review checks under the same gate.

The common owner counts the union of native reservations and protected common
runs, including records whose lease is missing. Only stable run/request and
original owner/document identity may merge two records into one slot. Unmatched
legacy records stay separately protected. An unresolved native request without
a known conversation ID also refuses continuation whose independence cannot be
established; fresh zero-turn independent writers may still use the other slots.

The extension invokes one native submission handler for a logical request.
Gemini retains its own transport fallback and same-turn recovery. This is not
a promise of one HTTP POST or exactly-once server execution. The extension never
invokes Send again after a timeout, disconnect, missing result or parse failure.

Correlate the newly observed native request ID with its response and terminal
action. A local dispatch or visible user bubble alone is not provider acceptance.
Publish `started` only with matching native response evidence, and `finalContent`
only with the matching successful terminal action and a complete final response.
Read content and final state from the same native row. Do not match website DOM
by question text: Angular can rebuild an older same-text answer or render behind
the native final state. Convert known native text, code, list, table and layout
blocks to inert HTML, flatten inline annotations, and refuse unknown interactive
blocks rather than publishing a substituted answer. Stable text or an ended
transport alone cannot prove completion.

If the matching native success action arrives while Gemini is idle but no
response can be attributed to this request, allow two seconds for native state
delivery, then end observation as unconfirmed. Preserve the submission hold and
original run; do not wait the full generation deadline, use the parent answer,
or invoke Send again. This boundary was added after a November 14 live append
ended its native stream without an attributable response; that append is not
counted as successful continuation acceptance.

Observe native Send actions from preparation onward. An unexpected website/user
submission prevents the adapter from invoking its handler and retains the hold,
even if the draft/busy state subsequently looks unchanged. Stop wins until a
verified final result is synchronously published; after publication, it cannot
replace that result with a second terminal status. Journal cleanup follows the
completed publication; a failed cleanup can retain a hold without invalidating
the already verified result.

Stop ends local observation and attempts the matching native Stop action once.
Its acknowledgement does not promise remote cancellation. A challenge, native
failure, uncertain submission, Stop, lost document or observer failure preserves
a durable hold. Open Gemini to inspect the existing result, then explicitly use
`Allow new requests after checking Gemini`. This permits new work; it never
resubmits or repairs the old request. An uncertain old request remains uncertain.
Keep partial output and the known website tab available for manual inspection.
If an interrupted tab was reloaded, closed or navigated away, inspect the old
result on Gemini. Recovery checks the current account/page without retargeting
a writer. It then requires a separate acknowledgement that the old outcome
remains unconfirmed before allowing new work, records that disposition and
retires the old binding. It cannot restore or replay that request, and the
acknowledgement cannot override an active generation or account challenge.
A check that positively fails before native preparation/submission
does not claim an uncertain write occurred and need not create a hold.

The Gemini settings review goes through the common engine runtime. Only after
the native review succeeds does that owner release the engine's durable write
lease, retire uncertain continuation bindings and record permission for new work.
Clearing the native hold alone is insufficient for API, MCP and Drafts. The old
run retains its submission status and unknown outcome; review never replays it.
Manual review excludes live writes and racing new admissions. It reconciles only
the captured old requests after their native checks succeed. A failed native
check or required acknowledgement still awaiting confirmation leaves the
corresponding write protection in place. Exact readonly recovery can run beside
unrelated writers and releases only its own matched hold and lease.

Text submissions and continuation use a verified native head. A refreshed or
reopened document is checked against the original account, conversation, server
turn and response before its native input handler can run. Earlier bindings that
only recorded a client ID cannot be guessed back after document loss; open their
native history to establish a fresh reference. Regeneration and attachments
remain unsupported. Up to three writer tabs and one separate readonly history
tab are retained. Reads never refresh or navigate a writer; closing a tab does
not delete its website history.

When new work needs a writer and all three retained tabs are present, only a
hidden, verified completed writer may be retired. Recheck the pinned account,
original document, unchanged conversation/server/response head, idle state and absence of
a draft before closing it. Active or held writers, foreground tabs, changed
documents/heads and drafts remain untouched. If no safe candidate exists, ask
the caller to close a finished tab. Reopening a retired conversation uses native
history and verifies its head again. Manual review retires uncertain bindings
while leaving their pages open for inspection.
Missing response identity refuses automatic retirement. Exact recovery may mark
only its own now-completed, unreserved writer as a candidate; the same fresh
document/head checks still apply before it is closed.

Gemini's successful navigation can remove the fragment used to mark a newly
created writer. After refresh, a tracked writer may use its canonical conversation
URL only with a fresh pinned-account/conversation/server-head check. MAIN requires
that same path and native head (plus a known response ID), with no active turn or
draft, before configuration/connection. Blank new conversations still need their
creation marker. A missing marker alone never permits claiming an arbitrary page.

A new independent request may reuse an extension-owned blank writer after fresh
account, zero-turn, no-draft and idle checks. Its local binding is changed durably
before native configuration/preparation; later guards still check the document
and empty native state. Drafts, attachments, active work, existing history and the
separate read tab are not reused this way. No prior question is replayed. This
also prevents a local runtime refusal from consuming another empty tab on every
explicit attempt; an unknown runtime is still refused.

## External clients and verification limits

The authenticated gateway's explicit Gemini model uses the same provider via
`ApiServer.html`; it must never run ChatGPT uploads, projects or history for that
request. Legacy chat-completions requests remain independent, with the same durable
Gemini hold and no automatic replay. Native history and continuation are exposed
through `/engines/geminiweb/conversations*` and common runs, with exact readonly
recovery of recorded server turns. Drafts' separate Gemini actions consume those
interfaces. No provider-specific `ask_gemini` tool is needed. Existing ChatGPT
defaults and `ask_chatgpt` remain at their owners.

The [engine contract](engine-contract.md) exposes verified native-head append
through the common run interface. `ask_engine(engine_id="geminiweb", query=...)`
uses that same engine after enabling external access in
Settings → Engines. Existing configurations migrate only their prior independent
completion grant; they do not gain append automatically. API and MCP share that
external grant. Account/native-head binding, one native invocation and the durable
hold remain required boundaries. History and append require their own explicit
external operation grants; upgrading the adapter does not add those grants.

Synthetic tests establish the stated local guards and event handling, not
Google's account policy or future detection behavior. Reusing native code does
not establish that Google guarantees this calling pattern. A real-account
success, when authorized and observed, establishes only that one execution.
On a challenge or limit, stop account-bound testing rather than trying another
identity, model, transport or prompt. Disable Gemini Web to roll back the adapter;
keep an unresolved submission record until the website has been checked.

The [2026-11-12 installation trial](plans/2026-11-12-gemini-web.md#user-authorized-brave-installation-and-one-live-trial)
initially stopped at a local runtime mismatch. The user clarified that this was
an implementation issue, not a Gemini rejection or withdrawal of test authority.
The current compilation's components, state/event fields and thinking setter
were then mapped separately. The [corrected single-response trial](plans/2026-11-12-gemini-web.md#correction-after-the-users-runtime-check-clarification)
passed in the installed Brave extension: one 4 Argon / High question produced a
complete native response and one saved extension record, without an extension
resubmission. No challenge, rate-limit refusal or account error was observed.
This is one execution's evidence; it does not validate all future account use,
runtime versions, continuations or live gateway traffic.

The [November 14 delivery](plans/2026-11-13-gap-closure.md#real-gemini-and-drafts-evidence)
separately verified common MCP generation, exact native recovery after reload,
and a new Hydrogen / Medium continuation through the generated Drafts script
and real gateway. API, MCP and fresh native history agreed on its completed
answer and turn identity. Native history paging and lost-receipt Get preserved
unsent notes. The earlier two Argon continuations remain unknown; Hydrogen's
success does not establish that the model alone caused their failure.

For maintenance, distinguish local adapter faults from provider responses. A
runtime/profile mismatch before invocation spends no Gemini submission and is
not evidence of a CAPTCHA, quota, account restriction or revoked permission.
Within an authorized trial, inspect the public source and live read-only state,
correct that mapping and continue the permitted test. Keep native prerequisite
checks and the single-invocation journal. After an invocation is uncertain, do
not resubmit; an actual website challenge, rate limit or account anomaly stops
account-bound testing. Local compatibility diagnostics must say they originate
in the adapter rather than implying that Gemini refused a request.
