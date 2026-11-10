---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-11-07
---

# ChatGPTBox project review

The second review finds a concrete gap between the accepted product promise
and the abstractions used to deliver it. Users are meant to change a way of
working and reuse it, while much of the connected implementation still treats
the task as a question, an answer string and a completion flag. Material,
result form, process information and remote identity do not consistently keep
their separate meanings across that path.

The webpage-first direction and major execution boundaries already have
explicit decisions. Controlled component trials also demonstrate useful
reading, writing and reuse behavior. The evidence supports improving the
contracts between these responsibilities; it does not establish that every
product role is confused or that the modules should be rebuilt uniformly.

This second pass followed the owner's correction that the original defect
list mixed product, design, architecture, modules and implementation. The
original twelve defects remain below as bounded implementation evidence.

This review covers source revision
7400b54b7a7c64890c1f1c762204bffc8edbfaf1, version 4.3.3. It was requested as an
assessment, not a product implementation. Product code, settings, installed
extensions, gateway processes and personal memory were not changed. The added
files preserve the review and synthetic reproduction evidence.

## Assessment by level

The review follows each important promise into its workflow, owning capability,
interface and consumer. Severity and explanatory level remain separate: a
local defect can be urgent even when its product meaning is settled, while a
missing workflow decision can require design before the right repair is known.
A shared symptom does not establish a shared root cause.

| Level | Supported assessment | Important limit |
| --- | --- | --- |
| Product direction | The current webpage, chosen AI and reusable ways of working form an explicit accepted direction | This review does not measure the value or maintenance cost of the whole portfolio |
| Product design | Material choice, source checks, comparison, confirmation and undo are implemented; changing the kind of result through normal use is incomplete | Manual controls work; automatic interpretation of every request is not required |
| Architecture | Execution and trust boundaries are explicit; material, final output, lifecycle and remote identity lose meaning in some shared interfaces | The remedy need not be one runtime or one state machine for every engine |
| Modules | Import restrictions and the DSH client boundary have a concrete purpose | Settings-only modules are not complete engine packages; that intentional asymmetry alone proves no defect |
| Implementation and verification | Concrete defects and new connected-boundary witnesses exist despite a passing baseline suite | Mocks and source inspection do not establish live account or installed-browser acceptance |

### Existing product roles have different consumers and effect owners

| Role | User result | Actual boundary |
| --- | --- | --- |
| Page functions | Read, annotate, rewrite and retain a useful method | Browser material/effects plus the selected provider; [page assistant](../../src/browser-assistant/Assistant.jsx) |
| Native ChatGPT input | Check a paste locally or rewrite a draft near its editor | Local paste review is independent of model invocation; rewriting reuses page functions; [native contract](../product/browser-assistant.md#experience-design-2026-10-30) |
| API and MCP access with Drafts | Use web-provider access from another client | External client to local gateway, extension bridge and web provider; [API](../api-server.md), [MCP](../mcp-server.md) |
| Full DSH client | Operate the external harness, including its own workspaces and sessions | The harness owns execution and permissions; the extension owns client presentation; [DSH target](../product/2026-08-18-dsh-full-client-design.md) |

These are not four interchangeable engines. Native paste is local processing;
MCP and Drafts are clients of a gateway; a full DSH client is a specialist
surface for an external execution system. They can serve a coherent product
without sharing every workflow or lifecycle. Whether their combined benefit
justifies long-term maintenance remains a product question requiring actual
usage and cost evidence, not a conclusion from directory count or bug count.

## Findings about product and architecture

### S1 Changing a method does not reliably change how its result can be used

The [accepted product example](../product/browser-assistant.md), around line
68, moves from an article overview to marking worthwhile original passages
and saving that changed method. [The current refinement helper](../../src/browser-assistant/functions.mjs),
lines 141–148, only appends question text to the prompt. Scope and output stay
unchanged. [Result rendering](../../src/browser-assistant/Assistant.jsx), lines
258–267, continues to use the original output mode.

A pure-function probe retained output=chat after adding a source-marking
request, with no structured annotation instruction. A separate first-reader
trial of the actual BrowserAssistant showed the same disconnect before Run:
writing a request to mark weak evidence left the summary at page text to
Answer. Explicitly selecting the annotation preset made source actions work,
but replaced the custom instruction, which the reader then entered again.
The existing result-format control also allows manual adjustment.

The causal gap is in the interaction design between a changed intention and
a changed usable result. A good model answer alone cannot activate source
locators when the application still treats it as ordinary chat. Saving the
extended prompt preserves the same limitation for subsequent use.

This is incomplete delivery of an accepted experience, not evidence that the
product has no direction. Explicit modes are a reasonable protection against
unintended page effects. A small design can expose a mode change while retaining
the instruction, offer a visible proposed conversion, or clearly limit the
current delivery to refinements within a mode. Product ownership decides that
interaction; it does not require a general agent that silently edits schemas.

### S2 Site material and reusable instructions are still coupled differently

The existing [YouTube adapter](../../src/content-script/site-adapters/youtube/index.mjs),
lines 75–80, embeds subtitles in a fixed summarization prompt. The
[GitHub adapter](../../src/content-script/site-adapters/github/index.mjs)
similarly joins discussion or patch material to a task-specific instruction.
[The content entry](../../src/content-script/index.jsx), lines 115–117 and
178–184, sends that prepared question through the ordinary conversation path.

Page functions use a different material path: [Assistant](../../src/browser-assistant/Assistant.jsx),
lines 68–75, calls [captureReadingSnapshot](../../src/browser-assistant/context.mjs),
which scans a DOM article/main subtree. That path does not consume the adapters'
subtitle, discussion or patch acquisition. Changing a site's built-in summary
into a saved evidence-checking method can therefore change the underlying
material instead of reusing it.

A local DOM probe with a teaser article followed by the main discussion
captured only the teaser. Its truncated=false flag described length trimming,
not complete coverage of the intended discussion. This demonstrates the
selection mechanism on that input; it is not a live-site failure-rate estimate.
R1 and R5 provide related evidence of a second split: final template expansion
can add or shorten material after the UI has prepared its material preview.

The architectural problem is that the processing object is not consistently
preserved independently of extraction, instruction and presentation. The
strongest reason to keep the DOM snapshot path is its source ranges and stale
checks: a subtitle string cannot automatically provide those capabilities.
Do not replace one with the other indiscriminately.

A bounded improvement can separate one useful adapter's acquired material
from its fixed instruction and let page functions consume it. Keep material
identity, coverage and optional source-location capability explicit. Final
expansion and any truncation must be reflected in the request preview. This
supports reuse without first building a universal resource framework.

### S3 The shared conversation stream is not a sufficient result contract

The [common Stop helper](../../src/services/apis/shared.mjs), lines 18–26,
sends done=true before aborting; [the wrapper](../../src/services/wrappers.mjs)
has the same acknowledgement pattern. [The reducer](../../src/hooks/conversation-runtime-reducers.mjs),
lines 95–98, marks the last answer done. [The assistant](../../src/browser-assistant/Assistant.jsx),
lines 261–268, then renders its result component; [replacement](../../src/browser-assistant/Result.jsx),
lines 18–19 and 67–90, accepts nonempty normalized text.

The retained terminal probe uses the actual Stop helper, passes its
acknowledgement into the actual reducer after partial output, and observes an
answer marked done and ready for result rendering. The pure-function boundary
establishes eligibility, not a real-browser click. The normal controlled
component trial separately verifies how the real result component applies a
supplied candidate. Stopping a stream does not by itself establish that its
partial result is a complete rewrite.

The DSH projection illustrates another loss of meaning. [renderLedgerMarkdown](../../src/background/providers/dsh-bridge.mjs),
lines 46–73, combines text, tools and turn-end notes into answer. Passing its
actual output through the actual answer normalizer and fence remover retains
both tool lines and the end note in the replacement candidate. Even a
text-only turn becomes “Rewritten draft.” followed by a completed note.
This is a source-boundary composition test, not a live DSH task; R7 currently
blocks creating an unbound DSH session and can mask this downstream problem.

For ordinary chat, displaying process information and freeing the input after
Stop are reasonable behaviors. A page effect needs a different assertion:
what final content is usable, whether it is complete, and what is known about
the remote operation. Chat presentation text and the input-ready flag cannot
supply all those facts.

Give the existing interface separate meanings for final content, process
information and terminal reason. Providers retain authority over execution
facts; consumers decide whether to offer normal adoption, an explicit partial
result action or recovery. Preserve DSH's ability to continue after detachment
and the gateway's conservative handling of uncertain writes. These distinct
lifecycles do not require a common internal engine state machine.

### S4 A visible conversation is being reused as a remote binding across engines

[Session](../../src/services/init-session.mjs) carries local records and UI
identity alongside provider-specific remote IDs. [The model picker](../../src/components/ConversationCard/index.jsx),
lines 433–446, spreads the current session and changes modelName, apiMode and
aiName. It keeps conversationId, parentMessageId, previousResponseID and any
DSH binding. The six-second [memory note](../../src/components/ConversationCard/index.jsx),
lines 391–401, explains storage location rather than the actual transition.

A probe extracted the current picker callback unchanged from the JSX AST and
invoked it with a synthetic ChatGPT session. Switching to Grok retained the
ChatGPT conversation ID. The actual [Grok writer](../../src/services/clients/grok-web/chat.mjs)
then rejected continuation because previousResponseID was absent. Its injected
fetch was called zero times. This is a picker-to-writer observation, not an
observation of the full authenticated Grok proxy path.

The same probe changed models within ChatGPT and retained its remote ID, a
useful countercase. Clearing every remote field on every model change would
break valid continuity. The missing distinction is the lifetime of the visible
thread versus the namespace and lifetime of each provider's remote binding.

Product design must specify what crosses an engine change: visible transcript,
selected history, a new remote conversation, or a binding that can later be
resumed. Engineering can prevent one provider's ID from entering another
provider's continuation request without waiting for a portfolio redesign.
Keep remote bindings scoped to their provider and any applicable account
identity; account-switch behavior was not exercised in these probes.

## First reader observations

A fresh reader selected an article evidence-checking task and a selected-draft
rewrite from the normal README and usage-guide entry. Three controlled cases
rendered the real BrowserAssistant and AssistantResult, with storage,
ConversationCard transport and model answers replaced by local fixtures.

Useful behavior was observed: article material excluded navigation and the
input draft; a verified quote selected the exact source; unsupported CSS
highlighting in jsdom produced an explicit fallback. A saved function retained
its instruction and output mode while reopening over a different article's
material. Selected-input rewrite changed only the captured range after Apply;
Undo restored it, and later edits prevented an old undo from overwriting them.
These results show real implemented workflow, not only a collection of controls.

Two lower-level adoption problems remain. [The guide](../browser-assistant.md),
lines 40–44, describes opening as not sending and Run as the trigger. Specific
named actions use autoRun=true, as seen in [the caller](../../src/content-script/index.jsx),
lines 234–240, and [automatic start](../../src/browser-assistant/Assistant.jsx),
lines 171–176. The controlled trial observed that entry bypassing preview.
A named action can itself be deliberate run authorization; this does not prove
an unauthorized request. The guide should distinguish direct actions from
Functions… without adding an unnecessary confirmation to every action.

[README_CN](../../README_CN.md), line 117, still describes old popup tabs,
while [PopupNew](../../src/popup/PopupNew.jsx) provides Chat and Settings.
This is a concrete entrypoint-description defect. The source confirms the
mismatch; the trial did not measure discoverability in an installed toolbar
or establish that a new user would inevitably fail to find page functions.

## Module judgment

The module manifests show an intentional asymmetry: [ChatGPT Web](../../src/modules/chatgptweb/module.mjs)
and [Grok Web](../../src/modules/grokweb/module.mjs) group settings while their
runtime remains in core; [DSH](../../src/modules/dsh/module.mjs) owns a gateway
and full client. Import guards enforce the permitted access path. None of
these observations alone demonstrates that moving all vendor code under one
uniform tree would improve the product.

S2 identifies a more consequential responsibility boundary, material acquisition
versus instructions. S3 and S4 identify result and binding responsibilities
that currently leak into shared chat consumers. Repair those public meanings
at their existing owners first. Revisit packaging when a real change still
forces coordinated edits in unrelated responsibilities or makes isolation and
replacement impractical. Change history and maintenance effort were not
measured sufficiently to justify a wholesale module migration.

The separation between browser effects, native local checking, external model
invocation and harness execution remains useful. A full DSH client need not
be squeezed into the page assistant, and local paste checking should not
be routed through a provider or the gateway.

The tasks expose the following concrete responsibilities for assessing those
boundaries. This is a map of the work being reviewed, not an adopted class
hierarchy or a requirement to add one module per row.

| Responsibility | Meaning that must survive the interface | Current implementation |
| --- | --- | --- |
| Reusable method | Instruction, chosen material, result use and optional engine | [function definition and catalog](../../src/browser-assistant/functions.mjs) |
| Material preparation | The identified, authorized and actually transmitted input, with coverage and source-location information where available | [context capture](../../src/browser-assistant/context.mjs), [template expansion](../../src/utils/prompt-template-context.mjs) and Assistant |
| Conversation presentation | Visible transcript and the user's ongoing interaction | [ConversationCard](../../src/components/ConversationCard/index.jsx) and [runtime reducer](../../src/hooks/conversation-runtime-reducers.mjs) |
| Execution result | Final content, process information, terminal reason and known recovery state | [provider boundary](../../src/background/providers/adapter-contract.mjs) and provider-specific implementations |
| Remote continuation | A provider's own conversation identity and lifetime | Provider clients and thread-state helpers, currently also carried through Session and UI |
| Page effects | Explicit adoption, source checks, stale-target rejection and undo | [effects](../../src/browser-assistant/effects.mjs) |

## Implementation defects from the first pass

P1 means a defect should be addressed promptly because its trigger can expose
unapproved material, cause an unintended external write, or lose saved data.
P2 means a bounded feature or recovery path is incorrect. These are this
reviewer's priorities, not measured incident frequencies. Optional integrations
are affected only when their corresponding path is used.

### R1 P1 Templates can send material outside the displayed scope

The assistant passes the general template resolver to every function scope.
Setting allowFullHtml to false disables only the two HTML variables. It does
not disable domTree, interactiveElements, headings or links. These providers
can read the live page independently of the chosen material. The assistant
still previews only the URL and displays “Only the link is sent.”

A function using scope=url, template=true and a domTree placeholder passed
the actual create, export, import and validation functions. Its material was
only https://example.org/, but its prepared request contained text from a
hidden aside. Replacing the placeholder with interactiveElements included a
password input's value attribute. This does not establish access to a password
held only in the live value property; the reproduced leak requires the secret
to be present in the HTML attribute.

Owners: [assistant preparation and preview](../../src/browser-assistant/Assistant.jsx)
at lines 68–88, 113–125 and 411–425;
[template providers](../../src/utils/prompt-template-context.mjs) at lines
157–193, 438–443 and 475–478. This conflicts with the
[material scope contract](../product/contracts.md#所选能力与材料范围).

Prepare one approved material snapshot and resolve function variables from it.
If a function needs more page context, expose that expansion before Run and
include it in the actual request preview. Merely disabling full HTML leaves
the demonstrated sibling paths open.

### R2 P1 Drafts can interpret answer content as a send instruction

Get and Send search the entire transcript for the first waiting-reply marker.
Assistant messages are inserted into that same transcript without isolating
those marker strings from control metadata. A harmless code example can
therefore supply a different conversationId and question.

The probe loaded real-thread with an assistant answer containing a fenced
example waiting block for unintended-thread. After a genuine next question
was entered into Get's actual waiting block, Send posted the example question
to unintended-thread. The genuine question remained in the transcript.
The actual Drafts JavaScript ran with a synthetic HTTP implementation; no
remote message was sent. Ordinary answers without marker strings do not
trigger this case.

Owners: [Send parser and transcript rendering](../drafts/action-3-send-waiting-reply.js)
at lines 171–192 and 338, and
[Get parser](../drafts/action-2-open-checked-conversation.js) at lines 56–75.
Keep control metadata separate from transcript text, or use an unambiguous
envelope with reliable escaping and uniqueness validation. Choosing the last
match alone does not resolve every control-marker collision.

### R3 P1 Ledger capacity eviction permits another write with the same key

The operation ledger defaults to a seven-day TTL and 2,000 records. Its
capacity pruning removes the oldest records without distinguishing an
unacknowledged write from a completed operation. A removed record no longer
blocks dispatch.

The probe created an ambiguous operation, then 2,000 additional records while
the first was still within its TTL. Retrying the first key and fingerprint
returned kind=new with a different operation ID. The HTTP route treats that
result as permission to dispatch again. Below the capacity limit, this
particular eviction does not occur.

Owner: [OperationLedger](../../scripts/lib/operation-ledger.mjs), lines 6–7,
108–109 and 147–159. This contradicts the
[same-key write contract](../api-server.md#at-most-once-writes-and-bounded-recovery).
The API's explicit seven-day text at lines 243–249 concerns staged photos;
the [Drafts guide](../drafts/README.md) at lines 185–192 separately describes
its seven-day send recovery window. These scopes should remain distinct.

Retain protected records or compact non-replayable tombstones; reject new
writes when safe retention is impossible. Do not trade away protection of an
uncertain write to make space silently.

### R4 P1 Saving Functions before a successful settings read loses saved functions

The settings hook initially supplies default configuration, including an empty
function list. It exposes loading/error read state, but its function-storage
branch accepts writes in both states. Functions receives no read-state guard
and disables controls only during an active save. Saving a newly created
function constructs a complete list from the default empty list and replaces
the saved collection.

Two focused UI probes exercised the actual hook and FunctionLibrary: the
initial read was either left pending or rejected, then New function and Save
were used. Both wrote a one-item list that omitted the pre-existing function.
The two passing probe cases establish the defect, not successful
product behavior. A read completed before interaction avoids this trigger.

Owners: [settings hook](../../src/hooks/use-settings-config.mjs), lines 12–13
and 65–71; [FunctionLibrary](../../src/browser-assistant/FunctionLibrary.jsx),
lines 127–129 and 319–321; [ToolsTab](../../src/popup/components/ToolsTab.jsx),
line 19. Apply the existing read-success requirement used for native paste
rules to saved function collections and provide a visible reload path.

### R5 P1 Template limits shorten a draft without updating its preview or replacement range

Function preparation accepts material up to 50,000 UTF-16 units. The shared
resolver independently clips selection at 12,000 and content at 18,000,
then applies token budgets. Because a material placeholder is present, the
complete material is not appended again. The UI previews the original material,
while replacement still targets the original captured input range.

For a 19,024-unit synthetic draft, the selection template produced a
12,147-unit request and the content template an 18,147-unit request. Both
omitted the final conclusion. The request included a truncation marker, but
the pre-run material preview did not. This establishes loss from the request;
actual user data loss additionally requires accepting a replacement produced
from that incomplete input.

Owners: [function preparation](../../src/browser-assistant/functions.mjs),
lines 179–180 and 203–215;
[resolver limits and budgets](../../src/utils/prompt-template-context.mjs),
lines 6–7 and 544–567;
[preview](../../src/browser-assistant/Assistant.jsx), lines 411–430.
Preserve the selected material or reject the operation before sending. If
shortening is an accepted option, display the actual shortened material and
align the application range with it.

### R6 P1 Grok success does not enter the local transcript

The Grok proxy handler streams an answer and returns a successful session,
but updates only continuation IDs. It does not append the question and answer
to conversationRecords. The downstream proxy, reducer and persistence path
do not add the missing pair either.

A synthetic complete Grok response returned “hello back” and valid
continuation IDs, but the returned session still had zero records.
IndependentPanel saves this session; remounting the conversation rebuilds
content from those records. Switching conversations or reloading therefore
loses the visible local transcript, and exports omit it. This does not delete
the conversation on Grok's servers.

Owners: [Grok handler](../../src/content-script/grok-proxy-handlers.mjs),
lines 199–210; [panel persistence](../../src/pages/IndependentPanel/App.jsx),
line 383; [conversation reconstruction](../../src/components/ConversationCard/index.jsx),
line 100. Append the accepted turn at the authoritative completion boundary,
then verify two turns through remount and export.

### R7 P2 A new DSH floating conversation cannot create its session

The DSH provider calls session.create without arguments. Its real gateway
handler requires workspaceId and throws before contacting the external
harness. The module aggregator returns that same gateway without filling in
a default workspace.

The probe connected the provider to the real gateway handler with the module
enabled and reported online. A session without dshSessionId returned
“workspaceId is required for session.create” and done=true. Existing bound
sessions and full-page creation do not use this missing-argument path.

Owners: [provider](../../src/background/providers/dsh-bridge.mjs), line 207;
[gateway](../../src/modules/dsh/background/gateway.mjs), lines 796–799;
[aggregation](../../src/modules/background-services.mjs), line 149.
Make workspace selection or an explicit binding available to the lightweight
entry, and test the provider against the actual gateway contract.

### R8 P2 Several API paths report failure or partial output as success

Three independent source-shaped inputs reached normal completion:

| Consumer | Synthetic input | Observed result | Responsible source |
| --- | --- | --- | --- |
| Custom Chat Completions | One text delta with finish_reason=null, then EOF without a terminator | Partial answer saved as a normal record and done=true | [custom-api.mjs](../../src/services/apis/custom-api.mjs), line 164 |
| Anthropic | HTTP 200, then an error event containing overloaded_error | Only done=true; the error was dropped | [claude-api.mjs](../../src/services/apis/claude-api.mjs), lines 78–90 |
| Responses | HTTP 200, status=failed, an explicit error and empty output | Empty answer saved with normal completion | [shared transport](../../src/services/apis/openai-responses-shared.mjs), line 86, and [consumer](../../src/services/apis/custom-api.mjs), line 110 |

These paths differ from ordinary non-2xx handling. The Responses consumer also
does not distinguish incomplete from completed output. This violates the
[failure boundary](../product/contracts.md#应答失败与恢复).

Interpret terminal status at each provider's protocol owner. Preserve partial
text and expose failure or unknown completion without automatically replaying
the write. An EOF-as-success compatibility option requires an explicit backend
contract; it cannot be the silent default for unrelated protocols.

### R9 P2 Concurrent index updates overwrite one another

Created-conversation upsert reads the complete stored index, changes one entry,
and writes the complete index without sharing the turn-index writer queue.
Two normal concurrent calls can read the same baseline and overwrite each
other. Both then remove their in-memory create acknowledgements.

Promise.all over upsert(new-a) and upsert(new-b) retained only new-b. Sequential
creates preserved both new entries. The real create path calls this method,
and the external interfaces support concurrent operations. Snapshot writes
also perform a separate read/modify/write; a full sync captures a baseline
and publishes whole pages from it, exposing sibling lost-update paths.

Owners: [cache updates](../../src/services/clients/chatgpt-web/conversation-cache.mjs),
lines 500–510 and 559–587;
[sync](../../src/services/clients/chatgpt-web/conversation-api.mjs), lines 625
and 701–709; [create consumer](../../src/background/chatgpt-proxy-service.mjs),
line 780. Unify all index mutations behind one serial update owner and merge
against current state at commit time.

The confirmed loss is a local index entry or status. Remote conversations and
independently stored body records were not deleted; a later full sync can
rediscover the conversation.

### R10 P2 DSH live events can prevent history recovery

The gateway opens its live streams before pulling history. The shared fold
rejects every event whose sequence is no greater than the largest sequence
already seen. If a new live event arrives first, missing older history is
discarded as though it were a duplicate.

Starting at seq=1, the probe delayed a history read, delivered live seq=5,
then returned history seq=2 through 5. Only the old answer and live-tail
survived. The intervening tool call, tool result and text prefix disappeared.
Repeating the history read cannot pass the same sequence gate. A quiet
session without overtaking events avoids the reconnect race; loading older
history has the same ordering incompatibility.

Owners: [stream opening and history ingestion](../../src/modules/dsh/background/gateway.mjs),
lines 638–648 and 674–675;
[sequence gate](../../src/modules/dsh/turn-fold.mjs), lines 76–80.
Buffer live events while rebuilding the baseline, or merge an ordered event
set and rebuild before publishing. A high-water mark alone cannot establish
that all lower sequences were received.

### R11 P2 A failed follow-up preflight is classified as an uncertain write

Follow-up sending reads the conversation, checks currentNode and reads
configuration before executeApiRef. Failures in those steps lack the explicit
not-dispatched flag that the message router recognizes. The asynchronous send
manager has already marked the operation as sending, so it retains the error
as ambiguous and prevents retry with that key.

A conversation GET returning 401 produced zero message-write calls, but the
operation reported phase=ambiguous, dispatched=true and retryable=false.
This can strand the user's operation after a login or read problem. A failure
after the actual write boundary must still retain uncertain-write protection.

Owners: [preflight](../../src/background/chatgpt-proxy-service.mjs), lines
570–580; [router](../../src/background/message-router.mjs), lines 62–69;
[operation manager](../../scripts/lib/image-send-operations.mjs), lines 68
and 101–107. Let the code that owns the actual dispatch boundary distinguish
preflight rejection from an unknown result after submission.

### R12 P2 Ollama issues another generation request after Stop

Ollama chains an unconditional generate request after its shared chat
transport returns. The shared SSE helper treats a user abort as a normal
return, so Stop also enters that continuation. The second request has no
abort signal and contains prompt=t and num_predict=1.

The probe observed chat POST, Stop, then a new POST to api/generate. The same
extra generation happens after normal success. It may keep or reload a model
after the user stopped the operation; it does not prove every server performs
significant work for that request.

Owners: [Ollama adapter](../../src/services/apis/ollama-api.mjs), line 25;
[SSE abort behavior](../../src/utils/fetch-sse.mjs), line 14.
Carry keep-alive configuration on the original operation or use an explicit
non-generating control path. Stop must also suppress pending follow-up effects.

## Conditional observation

Native paste and rewrite setup return empty implementations when the document
initially has an excluded ChatGPT path. A synthetic same-document navigation
from /g/review-fixture to / produced zero paste listeners and no rewrite or
protection-status entry; starting directly at / produced all three.

The mechanism is in [paste setup](../../src/native-chatgpt/paste-controller.mjs),
line 16, [draft setup](../../src/native-chatgpt/draft-entry.mjs), line 6, and
[content entry](../../src/content-script/index.jsx), line 640. Whether the
current website actually uses that same-document transition remains unverified.
Treat it as a required real-site navigation check, not an observed account
failure. A document-level lifecycle that reevaluates the current route would
cover this case without enabling checking on excluded inputs.

## Dependency maintenance and verification gaps

A fresh production-dependency audit reported eight affected packages: two high,
two moderate and four low. The direct high packages were
@modelcontextprotocol/server 2.1.0 and zod 4.2.0. Package counts are not counts
of exploitable project vulnerabilities.

The MCP implementation creates a new McpServer in its handler factory, so the
current wiring does not meet the shared-server condition in the
[SDK routing advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-jm63-cq47-j5jp).
Its authentication also precedes the SDK and uses the project's fixed-token
check. The [validation resource advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453)
needs both a patched SDK and explicit collection/body limits; upgrading alone
does not enable the new element bound. The
[Zod fix](https://github.com/colinhacks/zod/pull/6652) moves collection bounds
before element validation. Current tools accept a string query; this review
did not establish an exploitable OOM payload against this project.

The [PR audit job](../../.github/workflows/pr-tests.yml) is advisory through
continue-on-error and follows the main test job. This leaves dependency
findings without an enforced disposition. Use a narrow owner and review date
for accepted exceptions, update compatible pinned SDK packages together, and
test the actual HTTP entry before declaring the notices resolved. This is
preferable to blindly applying npm audit fix or treating every transitive
advisory as a release blocker.

The baseline suite substitutes browser APIs, and PR CI does not run a packaged
browser workflow. Existing controlled-browser evidence is valuable but dated
and limited to its scenarios. Add reproducible installed-package workflows for
material preview to request, saved Functions through reload, streaming failure
and Stop, and reconnect/restart. Keep real-account checks separately bounded.

Real logged-in rich-editor paste, account transitions, OS input composition,
BFCache, Firefox interaction, complete DSH parity and native Drafts/WebKit/iCloud
acceptance remain separate gaps. Those gaps do not prove the features fail;
passing the local suite does not close them either.

## Improvement choices and decision ownership

The smallest coherent improvement starts with complete supported tasks, then
assigns the material, result, binding and lifecycle contracts those tasks need.
It does not require replacing the accepted product direction. The following
alternatives address different evidence rather than serving as a generic
preference for more or fewer abstractions:

| Alternative | Benefit | Cost and condition for choosing it |
| --- | --- | --- |
| Repair each symptom locally and keep every existing interface | Fastest containment of an urgent known defect | Appropriate for isolated errors; leaves the demonstrated repeated material/result/binding disagreements in place if used as the entire response |
| Strengthen existing behavioral boundaries and move only the responsibilities that need it | Preserves working flows while making context, output and continuity checkable | Requires coordinated consumers and transition design; preferred for S1–S4 because connected examples already show the missing distinctions |
| Rebuild uniform engine modules or split the product into separate applications | Could give independent ownership, permissions or release lifecycles | Justified by repeated change coupling or distinct user/value/lifecycle evidence, which this review has not established; adds migration and operational cost now |

The second option is the recommended scope. It includes concrete workflow
choices, not just new interface names. Product ownership settles how a changed
requirement changes result form, which site material a function targets, the
DSH workspace binding and what context crosses engine switches. Engineering
ownership preserves approved material, separates usable output from process,
transmits honest terminal state and isolates remote identity. Existing runtime
and state owners implement those meanings with proportionate connected tests.

A first bounded delivery could take the already accepted overview-to-source
marking story through a chosen real site, retain its material when the method
changes, save it and reuse it on another page. In parallel with necessary
containment, exercise an interrupted rewrite and a cross-engine conversation
transition. These tasks discriminate an actual improvement from another round
of schema edits or a passing isolated helper.

Repair urgency remains separate from design dependency. Drafts control-marker
confusion or a destructive settings save can be corrected under clear existing
promises; they need not wait for these workflow decisions. Conversely, choosing
an arbitrary workspace to silence R7 would not close the missing workspace
interaction. Do not place all defects behind a new global design approval gate.

Current and future product breadth needs observation of which tasks create
value, what alternative tools would supply and what ongoing support costs.
This review does not establish a reason to remove an engine, promote the whole
extension to a general AI platform or abandon the webpage-first decision.
Those choices remain open to evidence and explicit owner decisions.

## Existing strengths

The product, architecture and interface documents have named owners and
distinguish implemented code from targets and live acceptance. That makes
sources findable; it does not establish that their decisions form a complete
product or architecture. Module dependency direction has executable guards.
Gateway, bridge and MCP tokens
have different roles; Host/Origin checks and conservative uncertain-write
handling have explicit implementations. Turn recovery checks message identity
instead of blindly submitting a new question.

Native paste uses an extension-origin review, a one-use proof and expiring
buffers; original pasted text does not traverse the generic background/provider
path. Replacement and undo already check stale targets, and annotations verify
source quotes. These positive source observations do not substitute for their
remaining real-browser acceptance.

## Verification and reproduction

### Second pass

Two fresh-context reviewers received the same open assignment to examine the
whole product against the original goal and the owner's correction. Neither
read the first report or its witnesses before returning an initial judgment.
A third fresh reader began with README_CN and the usage guide, chose reading
and writing tasks, then ran a controlled component trial. All three shared the
checkout and environment; their agreement is not independent source acquisition
or evidence of model diversity. Exact assignments and initial returns remain
in the review chat.

The parent checked the cited production paths and reran the retained probes
from their final repository locations on Node 22.18.0:

~~~sh
node docs/evidence/2026-11-07-project-review/structure-material-and-result.mjs
node docs/evidence/2026-11-07-project-review/structure-binding-and-terminal.mjs
./node_modules/.bin/vitest run --config docs/evidence/2026-11-07-project-review/consumer.config.mjs
~~~

Both Node witnesses passed their baseline assertions. The component trial
passed three bounded cases: reading and method reuse, selected-input rewrite
and undo, and the direct auto-run entry. Focused ESLint passed for all four
new evidence files. Documentation remained at 54 files, zero errors and the
four existing historical-link advisories; git diff --check passed.

The material/result probe imports actual context and function helpers and
extracts the unchanged DSH renderer by Acorn AST source ranges. It retains
source hashes. The binding/terminal probe extracts the actual model-picker
callback from the JSX AST and uses the actual Grok writer, Stop helper and
reducer with synthetic state. The direct writer's injected network function
is forbidden and was not called in the rejected cross-provider case. No
claim is made about network traffic earlier in the full authenticated proxy.

The component trial renders real BrowserAssistant and AssistantResult while
substituting storage, conversation transport and model output. Its network
count is a fixture label, not a packet-capture measurement. It does not test
an installed extension, layout, real account, OS input method, durable storage
or a live DSH task. Initial disposable-fixture module/event setup failures
were corrected in the fixture and were not counted as product defects.

One additional configured ChatGPT collaboration call considered the supplied
product text and factual code observations. It independently favored preserving
supported boundaries and strengthening behavioral contracts before a uniform
module rewrite. It saw a summary rather than the repository, so it contributes
judgment and alternative explanations, not another source observation. This
second pass made exactly one such call, with no retry or model test request.

Selected reference methods were the current Grill procedure and source-grounded
comparison rules, plus the engineering-judgment draft's symptom-based complexity,
standpoint and build-versus-reuse questions. The latter is a target draft in the
reference repository, not a new normative rule for ChatGPTBox. No framework,
gate, runtime or product decision was adopted by this review.

### Original pass checks and witnesses

The original-pass baseline checks used Node 22.18.0 and npm 11.6.2 against the revision above. Product code remained unchanged for the second pass; the full suite, build and online checks were not repeated.

| Check | Original pass result |
| --- | --- |
| Full Vitest suite | 129 files and 1,706 tests passed |
| ESLint | Passed |
| Production build | Normal and reduced Chromium/Firefox builds and all four ZIPs passed |
| Documentation | Before this record: 53 files; after it: 54 files. Both runs had zero errors and four historical-link advisories |
| Documentation checker fixtures | 28 tests passed |
| Search configuration | Desktop and mobile Bing, Yahoo Japan and Naver checks passed |
| Production dependency audit | Eight affected packages; exit status 1 |
| Focused Functions failure witnesses | Two cases reproduced the destructive save |

The retained witnesses were rerun from their final repository paths, and their
JavaScript passed focused ESLint. Documentation checks and git diff --check
passed after the report and evidence index were added.

The first full test attempt could not use the required loopback servers and
produced timeout failures; it was interrupted. The complete rerun with local
listening permitted passed. The first search check failed DNS in the restricted
environment; its permitted online rerun passed. The build reported an old
Browserslist database warning. No dependency installation or update was needed.

Run the retained synthetic witnesses from the repository root after installing
the locked dependencies:

~~~sh
node docs/evidence/2026-11-07-project-review/extension.mjs
node docs/evidence/2026-11-07-project-review/gateway.mjs
node docs/evidence/2026-11-07-project-review/preflight.mjs
node --experimental-vm-modules docs/evidence/2026-11-07-project-review/providers.mjs
./node_modules/.bin/vitest run --config docs/evidence/2026-11-07-project-review/functions.config.mjs
~~~

These scripts assert the faulty baseline behavior, so a later correction can
make them fail. They are dated review witnesses, not acceptance tests to keep
green. They use synthetic text, DOM, storage, transport and Drafts HTTP; they
make no account or model requests. The provider witness loads original modules
with VM dependency substitution; the preflight witness extracts the original
function and injects its read dependencies. Those conditions bound the claims.
The parent reviewer reran every retained witness and checked the corresponding
production producer and consumer paths.

Three reviewers used fresh conversation contexts with no inherited parent
history and separate specialist scopes. They shared the same checkout and
tool environment, so their evidence is not independent source acquisition.
Model diversity was not established. Their initial assignments and first
findings remain in the review chat; later coordination did not erase them.
A fourth fresh-context reader assessed the original defect-oriented report
and traced R1, R2 and R3 through their production consumers. That reviewer
reran the extension and gateway witnesses on Node 22.18.0 and found no material
correction needed in those claims. The other nine findings were outside that
reader's spot check. The later structural assessment was not part of that independent reading.

Before the owner's follow-up, one configured ChatGPT collaboration call examined product value and
maintenance trade-offs using a self-contained factual summary. It favored
complete user tasks and honest execution boundaries, and conditionally favored
horizontal reliability work if the candidate defects were confirmed. It did
not inspect the repository and is advisory judgment, not additional defect
evidence. Exactly one call returned; no retries or product test prompts were sent.

The comparison used the current project owners and selected source practices
from reference revision cb9e90a8f59b3535ce43bf250b0a4aad78449030: outcomes,
bidirectional effect verification, causal analysis, bounded delegation, reader
clarity and preservation of ownership. This is a bounded application to the
requested review, not a renewed complete discipline adoption or an update to
the [October 29 comparison](2026-10-29-discipline-refresh.md). No new gates,
standing authorization or product requirements were adopted.
