---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-31
---

# ChatGPT native input: implementation and verification

## Outcome and current limit

The user approved ordinary-paste local redaction, a nearby native draft-rewrite
entry, and independent Sites settings. These are implemented and production
bundles were built. Completion review found necessary corrections, which passed
fresh checks and the actual guest-editor workflow on headed Chrome 156.
**Review findings are addressed; logged-in editor acceptance remains open.** This is not an
installed release or a claim that the entire product direction is complete.

[Product](../product/browser-assistant.md#experience-design-2026-10-30),
[architecture](../../ARCHITECTURE.md#browser-experience-proposal), and
[usage](../browser-assistant.md#chatgpt-官网输入增强) own behavior and boundaries.
The [plan](../plans/2026-10-30-chatgpt-native-input.md) keeps remaining acceptance
boundaries visible. The earlier [design comparison](2026-10-30-browser-experience-review.md)
is dated design evidence, not these runtime results.

## Artifact and environment

Source baseline was `be8d913163bc5bbbbdef7f320c2535cc0be34d2d` plus the user's
six pre-existing discipline edits. Their six SHA-256 values were compared with
the saved pre-task baseline and remained unchanged. New runtime code lives under
`src/native-chatgpt/`, `src/pages/PasteReview/`, and
`src/background/native-paste-review.mjs`; existing config, messaging, build,
settings and content entrypoints connect it. No dependencies or permissions were
added. Gateway/provider wire behavior and Drafts were not changed.

Checks used Node 22.18.0. Initial browser observations used an isolated persistent profile
with cached desktop Chromium 130 (`HeadlessChrome/130.0.0.0`, macOS). The tested
extension was a copy of the production Chromium directory, with the final
production scripts unchanged. A local `https://chatgpt.com/` response was supplied
through Playwright routing; it contained a unique contenteditable
`#prompt-textarea` and the first MAIN script registered window/document capture
listeners for `paste` and `beforeinput`. This supplied browser events and editing,
not the real ChatGPT frontend/framework or an authenticated session.

Initial candidate's tested production files (superseded hashes below):

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `native-chatgpt-early.js` | 47125 | `201dbbdc5273209d1021abd0c85674fc75acebd2e4e22eb592d1a80c2267cabe` |
| `PasteReview.js` | 7664 | `9e6699ebf27a6a4d83bba21cc7c587b88787ea43a174d3a1cc858bc36a94b299` |
| `PasteReview.css` | 1364 | `017457c7d2fc61aecfd18349ea4692920188ed8abfbb7968a40c7befc3a8c24a` |

Normal and reduced Chromium/Firefox archives were emitted. Their existence is
build evidence; no installed browser extension was replaced and no release was
published. The Firefox manifest contains no automatic-paste entry or paste toggle.

## Reviews and corrections

The implementation-design review used the configured `ask_chatgpt` account,
with relevant project context authorized by the user. Its first findings were:

- Scope the privacy claim to an early, trusted, cancelable intercepted event;
  a website with separate clipboard-read permission can independently read it.
- Use an extension-origin viewer, exact document targeting, authenticated private
  communication, one-use operations and freshness guards. Shadow DOM is not an
  origin boundary.
- Verify native insertion/undo in a browser; guard asynchronous policy races,
  partial effects, input/finding limits and teardown. `getData` itself materializes
  clipboard text before the rule-size guard.

These findings were adopted. The retained task context reports 210 seconds of
model thinking for that review. Its complete original tool payload was not
recovered from the in-memory store at closure, so this paragraph is a retained
finding summary rather than a verbatim review artifact.

A second, narrowly triggered identity review followed actual Chromium evidence:
`tabs.connect` did not provide source `sender.tab`, `sender.documentId` or
`sender.url`. The first strict validator safely rejected the connection. The
review distinguished destination document addressing from sender authentication
and found version-dependent source URL metadata. Its final recommendation was
background-witnessed authentication with a separate one-use proof, while keeping
original text on the direct content/review Port. Reported model thinking was
244 seconds. Its complete input/first result are retained outside the repository.

The implemented variant privately returns the proof to the original content
caller's `open` response and, separately, to the exact authenticated review page.
The review's runtime-message sender tab/URL/frame/document fields were observed
in Chromium 130. The Port must present that proof before text is released;
optional source tab/URL fields are checked if present. Wrong identity/proof,
replayed readers, expiry and fresh-worker replay have regression tests.

The temporary browser initially kept the old background after files were replaced
at the same unpacked path: `open` returned addressing fields without the new proof,
while the disk copy contained the new code. Explicit extension reload followed by
source-page refresh corrected the mismatch; the final complete workflow trial
ran afterward. This is a deployment-observation lesson, not a reason to weaken
authentication. The developer entrypoint now explains the reload requirement.

A third completion review was initially prepared with the original accepted scope,
final source files/hashes, observed browser results and all live limits. Its
input SHA-256 is
`1500ef27e468ea471b95cd2db72317b2d60a649eafaa5c83b00bdf8ae6323946`.
**Automatic approval review failed because the workspace was out of credits;
the tool explicitly reported that the action was not executed.** It was not a
safety denial. No alternate route was used. At that point account use was two
successful calls and one unsent attempt; the later authorized retry is below.

These are fresh-context peer inputs through the same configured provider, with
shared supplied sources. They are not independent live-site evidence. The
[development requirement](../contracts/development.md#choose-execution-depth-by-consequences)
for fresh completion evaluation was still unsatisfied at that point; its resumed
review and corrections are below.

## Initial controlled browser observations

Only synthetic text and a synthetic local OpenAI-compatible provider were used.
No native ChatGPT message was sent. The local provider recorded request count,
model and synthetic messages; no real credentials were used. The ChatGPT Web
provider and API server were disabled in the temporary profile.

| Scenario and observed boundary | Result |
| --- | --- |
| Actual system Cmd+V with email, custom term, mainland-phone candidate, known key and Chinese multiline text | Before confirmation the original was absent from host DOM and the earliest window/document paste/beforeinput listeners; extension-origin review displayed it and generated candidates |
| Apply selected candidates | Only masked results entered the captured editor; known key checkbox was locked; Chinese multiline text survived; native Cmd+Z restored the original draft |
| Second paste during review | No second review opened; the original operation remained; a finish-or-cancel prompt appeared. Unit test also verifies that the second event's clipboard data is not read |
| Complete unmatched text | Automatically inserted locally without a review; the fixture's paragraph rendering produced paragraph breaks, not lost lines |
| Cancel or close review | Pending state cleared, no original text was inserted |
| Continue editing while review is open | Review became unavailable and subsequent editing remained |
| Rich text with no rule matches | Required explicit plain-text confirmation; inserted text contained no `<b>` formatting |
| Paste-phase provider effects | Zero local-provider requests throughout these paste scenarios |
| Native rewrite entry | Opening/previewing made zero requests; explicit Run made exactly one selected synthetic-provider request; comparison, Apply and Undo succeeded |
| Review geometry/theme | Desktop and 390px dark mode rendered without horizontal overflow; controls and original/candidate text were inspected |

Initial clipboard checks saved/restored plaintext in local test memory. The
consolidated final trial improved this to an AppKit process that copied all
pasteboard items/types into memory, launched the browser trial, and restored them
on both success and failure; successful restoration was reported. Original
clipboard contents were never printed, recorded in artifacts or sent to a model.
Browser clipboard permissions were cleared after the trial and before live access.

Synthetic scripts/screenshots, the temporary profile and peer payloads are outside
version control. Reproduce the relevant boundary by loading the production
Chromium package into a disposable profile, explicitly reloading it, routing the
supported source URL to the described earliest-listener fixture, enabling the two
independent settings, and running real native paste and review/application actions.
For writing, use a local deterministic SSE response and inspect request count
before and after Run. This reproduces fixture claims, not live acceptance.

## Initial candidate repository checks

- Full `npm test`: **120 files, 1482 tests passed**, 8.34 seconds. Loopback fixture
  servers required the approved unsandboxed execution environment. The initial
  sandbox run's listen-EPERM failures were environment failures; a stale manifest
  index assumption and eager router reference were corrected before the final run.
- `npm run lint`: passed on the final runtime source.
- `npm run build`: passed for normal/reduced Chromium and Firefox. Existing stale
  Browserslist data advisory remained; dependencies were not updated incidentally.
- `npm run docs:check` and `git diff --check`: rerun after the final document edits;
  exact final results are in the plan. The documentation checker was not modified.

Unit/integration coverage includes URL/editor scope, rule bounds/overlap/aliases,
locked keys, policy races, source/range freshness, wrong proof and replay, TTL,
background review identity/closure, independent settings, no-auto-run entry and
private-Port exclusion from generic logging/model execution. It does not turn a
fixture editor or passing test count into live compatibility.

## Initial candidate's live-access failure and cleanup

One explicit navigation in the isolated browser loaded the real
`https://chatgpt.com/` and returned HTTP 403 with title `Just a moment...`.
The browser was not closed immediately. A later audit requested by the user
found six rounds of 403 console entries over about 13 minutes: the homepage,
`/api/auth/session` and `/favicon.ico` each appeared six times (18 recorded 403
failures, not a count of all network requests). Cloudflare/Turnstile scripts
continued running. No further manual navigation/retry command or native chat
submission was issued; the exact initiator of later reloads was not captured.
The browser should have been closed at the first failed access rather than
left on the active challenge page while documentation work continued.

The then-existing content script called `overwriteAccessToken()` on ChatGPT pages,
which fetched `/api/auth/session` even with the ChatGPT Web engine disabled.
This explains an additional read path; no network initiator trace was retained
to attribute every recorded request. See
[`content-script/index.jsx`](../../src/content-script/index.jsx).
The isolated profile was not populated with the user's normal browser profile
or login cookies. A read-only cookie-name audit found only Cloudflare-related
names for ChatGPT/OpenAI domains, without reading cookie values. That isolates
browser session state, not necessarily the network egress IP.

The available evidence supports a failure in this temporary headless Chromium
130 environment's website-access/verification path. It does not establish an
account ban, global ChatGPT failure, unaffected shared egress, or whether the
browser version, automation, network or loaded extension caused the failure.
No response-header/Ray-ID/complete network trace or with/without-extension
control was retained. The subsequent MCP completion-review failure happened
before execution due to workspace review credits and is a separate event.
The current real editor's framework state, account switching and OS IME
composition remain unverified. Clipboard-read bypass is an explicit product
limit, not a claim that website access was blocked globally. Other paths/browsers
outside the declared scope remain unsupported.

The synthetic provider process was stopped and the isolated test browser was
closed successfully. User-installed extension, gateway process/bridge and Drafts copies
were not updated. Resume requires available completion-review capacity and a
permitted current-site browser acceptance run; it does not authorize resending
an ambiguous model request or installing/publishing a release.

## Completion review resumed after the user's availability report

The previously unexecuted call was retried once after the user reported
`ask_chatgpt` available. It completed with 294 seconds reported thinking. The
new input corrected the 403 facts and rechecked the ten supplied source hashes;
its SHA-256 is `76229940120c5dcfbb4f037d942e8eed2aabd524704e779c44c167696e589636`.
The input and first result remain outside version control. Actual review volume
became three completed calls plus the earlier rejected, unexecuted attempt.

The review accepted the overall first-delivery direction and the value of
controlled browser evidence, while requiring corrections before acceptance:

| Finding | Local disposition and current verification |
| --- | --- |
| Disabled ChatGPT Web engine still triggers auth reads | Confirmed in local content-script code; gated both content token capture and background first-run detection on engine activation. Enabled-engine and Kimi behavior are preserved; fetch-count regressions added |
| Default-off bootstrap and `main`-wide unknown-input interception | Move opt-in to authenticated background dynamic registration using existing scripting/host permissions, before persisting enabled. Default-off documents get no early entry. Already opted-in documents retain fail-closed loading on the verified main editor. Other inputs are untouched and unknown editors visibly unsupported |
| BFCache teardown without restoration | Recreate paste and draft controllers with current settings on persisted pageshow; invalidate old reads, pending review and draft contexts |
| Live caret, composition and paragraph boundaries | Check live caret when the source is focused; track composition and cancel/pause pending effects; capture native paragraph/BR material without flattening it |
| Key wording overstates the explicit original bypass | Scope the locked-key wording to the replacement result; the separately acknowledged original-once action still shares original text |
| Actual editor framework acceptance | Still requires a normal, currently accessible real browser/editor. Loading or DOM-only success is insufficient |

The review's external upstream `index.jsx` link is not the local source baseline;
the auth finding was independently confirmed in this checkout before changing it.
The fixes above invalidate relevant initial source/bundle hashes and require
fresh checks, below/at the plan. No claim of fixed live ChatGPT behavior follows
from this review alone.

## Revised candidate: Chrome 156 observations

After the review corrections, full checks passed: Node 22.18, 122 test files and
1497 tests, lint, normal/reduced Chromium and Firefox production bundles. A later
observed guest-editor selector correction requires the final rerun below.

A separate headed Chrome 156.0.8078.76 profile loaded the unpacked build through
its developer interface. Developer mode was initially off, so Chrome disabled
the unpacked extension; normal activation through `chrome://extensions` enabled
it. The daily profile/install was not changed. The final background settings
command returned disabled and registered scripts empty, confirming the revised
protocol rather than merely seeing new files on disk.

Controlled Chrome 156 trials then passed dynamic document-start capture against
earliest MAIN listeners, default-off native paste, background proof review,
masked insertion/native undo, pending-edit/close invalidation, multiline rewrite
material parsed from the actual synthetic-provider request, one explicit Run
request, Apply/Undo, and disable/unregister behavior. No `/api/auth/session`
request was observed during these fixture page entries with ChatGPT Web off.
CDP generated trusted browser composition and committed Chinese successfully;
this is not an OS input-method candidate-window trial. Back navigation restored
controls but reported `pageshow.persisted === false`; real BFCache cache-hit
acceptance remains unproved, while the persisted restore hooks have unit tests.
All clipboard formats were restored by the local memory guard.

Two explicitly bounded real-site visits followed with clipboard permissions
cleared. Both returned HTTP 200, without recorded 403. The first did not find
`#prompt-textarea` within its limit and closed. One follow-up read-only shape
inspection found the logged-out website's textarea:
`textarea#mobile-composer-prompt`, labelled “Chat with ChatGPT”. It closed after
capturing non-private UI shape. This is a desktop guest-editor variant, not proof
that every logged-in editor changed. The exact variant was added to the site
adapter and its scope test; unrelated fields remain excluded. A failed 403 or
verification page immediately closes a test page; no challenge-loop retry is
part of this later method. Final real editing observations follow below.

## Guest-editor candidate before the focused state corrections

After the exact guest-selector correction, full `npm test` passed **122 files,
1498 tests, 10.07 seconds**. Lint and normal/reduced Chromium/Firefox production
builds passed. The following production files were byte-equal to the copy loaded
by the isolated Chrome 156 trial:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `native-chatgpt-early.js` | 50380 | `b27211c4fb65c47dd911b514a0cf6375df639f9a11dd227fe5c826a1c6b02f5e` |
| `background.js` | 948453 | `53552a42e84170d1269eddf8dc17bed5ba0fa5afe319875d8a9e37ec6def4817` |
| `content-script.js` | 2013695 | `6cf2413b114f1b6c8790f29e8905e28d738abd40ad5fca05cfbda38189a0d1df` |
| `PasteReview.js` | 7672 | `3672063915f1c4c9f06ddacf5bb9d1a3f8b935ec0ebee0e1416c1b9379f25535` |
| `manifest.json` | 2512 | `4a9ff979146a995a5db5852fe1a14a06cb11814b43003f38159d0cff9d19e69d` |

The third bounded headed real-site visit returned **HTTP 200**, recorded no 403,
and completed against the actual logged-out `textarea#mobile-composer-prompt`:

- System Cmd+V with synthetic email, exact custom term, phone and known key opened
  the extension-origin review. Before confirmation the textarea was empty and
  the page's synthetic paste observer saw zero events. The earlier fixture's
  MAIN listeners, unlike this later observer, were installed before all page code.
- Confirmation inserted only masked aliases and `[SECRET REMOVED]`; the screenshot
  showed the draft and enabled send arrow. Native Cmd+Z restored the empty draft.
- CDP trusted browser composition paused Rewrite draft and committed Chinese text.
  This does not establish physical OS candidate-window behavior.
- A two-line draft opened preview with zero local-provider calls. Explicit Run made
  one synthetic local-provider call; Apply inserted its fixed result and Undo
  restored both original lines.
- No native send action occurred. The conversation/response write guard recorded
  **zero attempted writes**. No real credential, account session or private
  conversation was used. Website clipboard permissions remained cleared.

React props on this textarea had no controlled string value:
`{controlled:false,matches:null}`. A conditional equality assertion therefore
did not establish framework-state agreement. The raw test's checks named “React
state” too broadly; the supported conclusion is real DOM, native undo and visible
UI behavior. Native request payload/framework state and the current logged-in
rich editor remain unverified. No native message was sent to prove them.

The site and review pages closed in the trial's `finally` before the AppKit parent
restored saved pasteboard items/types from local process memory. That parent has
exited; its final stdout was lost to tool-output truncation, so the last run's
restoration return value is not separately retained. Earlier complete trials
retained successful restoration output. Original clipboard content was never
printed, written to artifacts or sent. The settings page retained synthetic result
metadata, which was saved outside version control before navigation.

The user's six existing discipline files remained SHA-equal to their saved
baseline. A final focused peer review was submitted once against nine current
source files and the above limits; its input SHA-256 is
`0ce248f77c47e90a7ad6061e98459b64fe014af038a74f84e0e38f59adf5c402`.
The first result reported 454 seconds thinking and retained two P1 findings and
one P2 below; it did not approve full delivery. Four review calls had completed
at that point, plus the earlier unsent approval-credit failure.

## Focused state review, corrections and final runtime checks

The first focused result found two definite state-machine defects: an already
disabled injected document became unknown/intercepting again when unrelated
settings refreshed; startup registration failure retained a true flag, and
disable published false before removal was confirmed. It also found that a
website could programmatically click the draft entry. The latter did not prove
an automatic provider request, but violated the intended user-action boundary.

Current corrections and observed regressions:

- `suspend()` preserves a confirmed false policy; the early lifecycle also carries
  confirmed-off knowledge across a persisted restore. Configuration epochs still
  reject stale responses. Refreshing terms/language/rewrite no longer converts
  off into fail-closed loading.
- Registration/removal is read back and matched before success is published.
  Startup or mutation failure attempts verified cleanup, then revokes enabled if
  off is confirmed. If even readback/cleanup fails, the saved flag is not presented
  as verified protection: settings retain the explicit alert “Local paste checking
  is unconfirmed. Do not rely on it; reload the extension and try again.” Such an
  API failure does not report successful enablement/disablement. The alert remains
  through a subsequent disabled reconciliation.
- Draft entry ignores untrusted `.click()`. A real trusted click still opens
  preview, with no automatic provider request.

Full `npm test` passed **122 files, 1504 tests, 8.80 seconds**; lint and all four
production bundles passed. The existing Browserslist age advisory remained.
The relevant final production files were hash-equal to the isolated loaded copy.
New failure regressions include persisted true/startup registration failure,
unregister rejection, resolving registration/removal without actual effect, and
unreadable registry state. These are controlled API-failure observations, not
claims that Chrome production registration failed during the trial.

After explicit extension Reload, headed Chrome 156 reran the controlled workflow,
including an existing already-injected document disabled and then changed in
terms/language/rewrite settings: real native paste still reached the page.
Scripted draft click did not open the assistant; real click/Run/apply/undo passed.
Earliest MAIN observers, review proof, masked insertion, native undo, edit/close
invalidation and no engine-off auth fetch again passed. Back navigation again
reported `persisted === false`, not a proven BFCache cache hit.

One bounded real-site visit was justified by the changed early/click paths.
This fourth headed visit returned **200**, no 403, and passed the actual guest
textarea paste/review/masking/native undo and multiline preview/explicit local
Run/apply/undo workflow. It recorded zero native conversation-write attempts.
Controlled React state was again absent, so no internal-state or send-payload
claim is added. The website/review pages closed in `finally`; successful full
pasteboard-format restoration stdout is retained for both final trials.

A fifth and final planned peer call was submitted once to check these concrete
corrections against current source/tests. The original accepted scope, first
findings, unknown-browser-API state and live limits were included. No model
override, alternate provider or blind retry was used. It completed, reporting
345 seconds thinking, and accepted the specified known-off, activation-failure
and trusted-click corrections.
Its input SHA-256 is
`f412f428b32d7243c346789a2ca3b479cf90b6325da7aece3d296e4b780a2356`.
Logged-in editor acceptance is separate: a local `about:blank` instruction page
was prepared in the isolated window and the user was asked to log in manually.
No credentials or daily-browser cookies were copied, and no login UI is inspected
while awaiting the user's confirmation.

Production identities tested before the final deleted-key correction:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `native-chatgpt-early.js` | 50700 | `2e41a305c138184a536f43e149eff7109478036ce83b07712cd288bacdd2f5a6` |
| `background.js` | 949078 | `97d7cb83af07356df4659501db1628aaf4edb33a9cb7d543b4c63a3a40e5b021` |
| `content-script.js` | 2013763 | `3c5217b08f2884bde40da50be706fda98e2ad120877c2150489a59e7e8b2710a` |
| `PasteReview.js` | 7672 | `3672063915f1c4c9f06ddacf5bb9d1a3f8b935ec0ebee0e1416c1b9379f25535` |
| `manifest.json` | 2512 | `4a9ff979146a995a5db5852fe1a14a06cb11814b43003f38159d0cff9d19e69d` |

The last review identified one conditional boundary: removing the opt-in key,
rather than writing false, entered asynchronous loading despite default-off
semantics. The early change listener now treats every non-true change of that
key, including deletion, as immediate off and invalidates pending reads. Its
regression starts enabled, leaves a policy read in flight, deletes the key and
confirms the old true response cannot re-enable. The two affected test files
passed **45 tests**, lint and all four production packages passed afterward.
This small requested branch correction was not sent for another peer call;
the prior review is not described as inspecting its final source.

The review's possible stale-settings-parent finding was an external upstream
lead, not a local defect: local `SettingsCenter.jsx` uses `useSettingsConfig`,
which subscribes to `Browser.storage.local.onChanged`, merges known changes and
restores deleted keys from defaults. This was verified in local source, without
using the absent upstream `Popup.jsx` as the current owner.

Only the early bundle changed in the last build: **50693 bytes**, SHA-256
`945db9407b8d89201f8883269570563c58220b0b7a5645a2b9f817b3df44d4e0`.
Background/content/review identities above are unchanged. This last early file
has not been copied/reloaded into the temporary browser while manual login is
pending; the next actual editor trial must do that first. Existing guest evidence
covers the enabled path before this deleted-key branch correction. The last
branch has focused regression/build evidence, not an additional real-site trial.

Actual review use is five completed same-provider calls (reported thinking
210/244/294/454/345 seconds) and the earlier unsent credit rejection. Complete
first payloads are retained outside version control except the original design
review limitation described above. These share supplied project sources and are
not five independent live browser observations. The local synthetic provider
was stopped; the isolated window remains available for manual login. User
installation, gateway and Drafts remain unchanged.

## Regex replacement amendment: preparation

The user subsequently requested regex matching/replacement entries because exact
terms miss variants. The accepted product owner and active plan now record that
amendment. At the preparation checkpoint the production scanner/settings were
still literal-only; those observations did not validate the later regex code.

A disposable Node 22 probe installed exact `re2js` 2.9.1 in a temporary directory
with install scripts disabled. npm reported MIT licensing, no runtime dependencies,
and 912222 unpacked bytes across distributed builds. Its
[public API](https://github.com/le0pard/re2js) documents browser-compatible linear
matching, captures and compiled program size. Native RegExp plus a terminated
worker is a feasible alternative, but changes the current clipboard-data worker/
origin/CSP lifecycle; keeping this engine in the isolated content context preserves
the existing direct review data path. This was proposed before the review below.

With 20000 synthetic characters, `(a+)+$` and `(?:a|aa)+$` negative cases completed
in about 13ms and 5ms. A 1003-instruction counted-repeat negative case took about
323ms, showing why pattern length alone is insufficient; the implementation
needs compiled-size and aggregate/time/output bounds. Nested million-count
expansion was rejected. `😀甲公司😀` matched `甲公司` at UTF-16 offsets 2–5,
consistent with native editor coordinates. These are single local observations,
not a browser latency guarantee or detector recall benchmark.

A disposable browser-target Webpack production probe emitted 148483 minified
bytes for the engine entry, with no project source/dependency changes. A text
search for `eval` matched the engine's own prefilter method; a bounded AST check
found no direct global `eval` calls or `Function` construction. That static check
does not substitute for extension CSP and document-start behavior tests after
integration. The added bundle cost must be retained in the engine trade-off.

A self-contained design-review input supplied the user request, complete current
scanner, data flow, proposed schema/migration/capture/overlap/resource rules and
verification limits. `ask_chatgpt` returned `CHATGPT_WEB_RUNTIME_UNSUPPORTED`,
HTTP 503, explicitly stating that no new question was sent. The local gateway
health read returned healthy, WebSocket bridge connected and zero pending requests.
Available computer-use browsers did not expose the actual dedicated proxy tab,
so no proxy refresh or retry was attempted. No model fallback, browser submission,
installed-extension update or provider-protocol modification was made. The user
was asked whether to authorize independent fresh-context subagent reviews or
restore the configured MCP first. No implementation review had yet been supplied.

## Regex design review and implementation

The user reported that another session restored `ask_chatgpt`. One complete,
self-contained retry succeeded through the configured MCP, with **444 seconds**
reported thinking. The live tool metadata also exposed the deployed stateless
context description. The original input, first result and reported metadata were
retained outside version control. This was one completed design review plus one
unsent compatibility failure, not a browser fallback or a subagent review.

The reviewer supported pinned `re2js@2.9.1` while identifying these corrections:

- Ordinary global iteration does not find all overlapping occurrences. The
  implemented contract explicitly uses standard leftmost, non-overlapping
  occurrences within each rule, including the `aba`/`ababa` example. This preserves
  familiar replacement/capture semantics; it is not a promise to enumerate every
  starting position or a claim of complete recall.
- Replacement templates need an independent strict parser. The implementation
  rejects unknown/ambiguous dollar syntax and whole-input prefix/suffix references;
  it expands current-match captures once, with optional unmatched groups empty.
- A broad rule must not override another rule's protection. Competing custom
  findings now mask the entire connected range, even if a third rule covers it.
  One custom finding may replace a fully covered non-secret built-in finding.
- Source-secret locking alone misses keys created by replacement or concatenation.
  The actual selected candidate is now audited before confirmation and again at
  source application. Detected keys block insertion; custom rules do not cascade.
- Limits count raw findings before merge, cap single/total compiled programs at
  512/16384 and captures at 16, and bound expanded and worst-subset output. The
  500ms check is explicitly soft. A separate handwritten repetition parser was
  not added: RE2JS rejects counted/nested expansion above its built-in limit,
  and pattern/program/time limits apply; no hard compile-time/heap bound is claimed.
- Legacy literal matching is retained by escaping, but fixed `[REDACTED]` loses
  the former custom identity aliases. The guide and settings name that change.

The UI now edits pattern/flags/replacement entries, supports deletion/captures,
shows per-rule validation errors and preserves malformed imports until an explicit
repair/save. Null imports remain invalid through configuration normalization.
New strings are translated in Simplified and Traditional Chinese. No pasted
original, matcher, or reverse map is persisted; permissions and transport paths
are unchanged. The dependency is exact-pinned with registry integrity in the
lockfile; unrelated npm peer/optional lock churn was excluded.

Fresh focused checks first passed **5 files / 108 tests** and lint. The production
settings trial then exposed disappearing save acknowledgement: the owner publishes
optimistic values and a separate Chrome storage event whose dictionary key order
differs. A first value-comparison correction covered only one publication and did
not fix the real two-step behavior. The final correction canonicalizes serialized
rule values and tests the actual shared settings hook through both publications.
The same hook's null-to-default path was narrowed so malformed null paste policies
stay visible; key deletion still restores defaults. Two integration regressions
and the real browser save/null/deletion flows passed. Earlier failed UI attempts
are not described as passes.

Before the first completion review, checks passed **124 files / 1562 tests (8.50 seconds)**, lint and
all four normal/reduced Chromium/Firefox production packages. Documentation check
currently reports 49 files, zero errors and four existing historical advisories;
diff whitespace checks pass. No checker was changed.

In a new **headed Chrome 156.0.8078.76** profile, the production directory was
copied to a disposable extension path. Explicit management-page Reload, background
protocol verification and source-page refresh preceded checks. At that first
completion checkpoint, these files equaled the loaded copy byte-for-byte:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| native-chatgpt-early.js | 220095 | `387dfc42101fded78655bbda8b81c8e7b1d1fa52c13b8cce410c7bd70a7a833a` |
| background.js | 961546 | `188ef0fd0cc7beeb61fe4689c3051bb8404df944197b8d43b80630d8c88e4d31` |
| content-script.js | 2013763 | `384feb621939a02d7777c6c92bd872f63022c3e713772cfaa759c8c8a9eef03a` |
| PasteReview.js | 161013 | `812207bfe7a54f29176809099cfaa2dbd1ff7b6a2a8c58df843dbd807c36fef1` |
| shared.js | 2231904 | `523cff3e9f1faa687e1751f4dff2892f8741d6e41acc5b0ffe922c8ef59e3506` |
| options.js | 635355 | `689924e1583be46f858ee7a85faaea42b94100ac66efea7ad15adc1ba44f42b9` |

The early file is about 169KB larger than the old loaded literal trial copy
(50700 bytes). The final early AST has zero direct global eval calls and one
Function constructor, the same Webpack global fallback present in that old copy;
the engine-only probe had neither. Production Chromium execution observed no
page JS/CSP error. This does not assert that the entire bundle lacks Function
syntax or establish a hard startup latency bound.

Real system Cmd+V against a controlled ChatGPT-origin fixture with earliest MAIN
head listeners proved the new production early capture, no pre-confirmation raw
editor insertion, isolated review and native undo. Cases passed for Chinese
variants/emoji, built-in masks/locked keys, numeric+named captures, transitive
conflicts even with a broad `$&` rule, replacement-created secret rejection,
input-dependent zero-length failure, null policy failure and escaped legacy
`a+b`. No disabled-provider auth/session request occurred. These are synthetic
interaction observations, not a website fixture passed off as the real editor.

Per-document first-scan 20000-unit negative observations were:

| Case | Meta+V keydown → approved input | Total automated paste operation |
| --- | ---: | ---: |
| 100 legacy rules, each 120 units | 17.4ms | 66ms |
| 16 captures, nested-quantifier negative | 22ms | 69ms |
| Counted-repeat program size 503 | 158.8ms | 198ms |

These are single local samples; browser/JIT work may already be warm. The first
attempt observed beforeinput, which native execCommand did not emit, and therefore
had missing timing values. Its results were retained; the table uses the corrected
input-event observation. Neither method measures worst-case heap/compile peaks or
establishes an interruptible 500ms deadline.

Production settings saved object rules, rejected invalid edits without changing
saved policy, retained successful feedback and showed null-import errors until
repair/deletion. At viewport widths 1100/560, the rules section measured 716/476px
with no horizontal overflow. Screenshots of both widths and review were inspected.

One additional bounded real `https://chatgpt.com/` guest visit returned **HTTP 200**,
with **zero observed 403s and zero native chat write attempts**. The actual
`textarea#mobile-composer-prompt` passed system paste, no raw before confirmation,
regex company variants plus built-in masks, private review, insertion and native
undo. No native send action was used; a write guard was also installed. The
textarea exposed no controlled React value (`controlled: false, matches: null`),
so this proves DOM/native undo rather than a logged-in framework or send payload.
Logged-in rich editor, account switches, physical OS IME and actual BFCache hits
remain the original plan's open acceptance items. This successful visit does not
erase or establish the cause of the earlier Chromium130 challenge incident.

All trials used synthetic values. Swift guards preserved all original clipboard
formats only in process memory and restored them on exit; website/fixture source
pages closed and temporary clipboard permissions were cleared before restoration.
Restoration was confirmed in retained output. The new isolated browser was then
closed. The existing manual-login profile, daily installation, gateway and Drafts
were untouched. The completion-review call now includes the original request,
accepted semantics, first findings/dispositions, final source/tests and the actual
observations/limits above. Its first result and subsequent corrections follow.

### Completion findings and corrections

The first completion review completed through `ask_chatgpt` with **402 seconds**
reported thinking. It confirmed the core regex feature, but identified these
remaining paths. The full first result is retained outside version control.

- Rule writes used optimistic settings state and did not restore it on persistence
  failure. The native-rule key now publishes active configuration only through
  authoritative storage events; failed writes preserve an unsaved, retryable draft
  and a specific error. Other settings retain their prior update behavior.
- Another settings window could silently replace dirty edits. The rules editor
  now retains its draft and blocks an unresolved save, offering explicit
  use-saved/keep-draft choices. Late own-save receipts do not replace newer local
  edits, and an external policy arriving before save completion is not labelled
  as this window's active draft. Shared-hook tests cover both extra orderings.
- An initial read could overwrite newer policy events. The hook subscribes first,
  buffers changes during its read and merges them into the initial result. A
  deferred-read regression reproduces this timing.
- Unchecking all non-secret findings or using identity `$&` could insert original
  text via the selected-result button without the separate acknowledgement. The
  accepted contract is now explicit: whenever findings exist and the actual
  candidate equals original, both review and source require `allowOriginal: true`.
  Explicit original-once also requires this value. Candidate keys remain blocked
  in the normal result. Source regressions exercise refusal/approval for both
  actions and identity replacement; production Cmd+V exercises the real checkbox.

Browser fault injection was confined to the disposable extension settings page:
a synthetic rule-write exception occurred before the native storage call. The
real hook/editor preserved the previously stored policy and draft, displayed
failure, then succeeded on retry with the injection disabled. This is a controlled
failure, not an observed browser quota or outage. Two actual settings windows
also passed draft preservation, blocked save and both explicit conflict choices.

Fresh production paste checks passed the original cases plus all-unchecked and
identity-replacement acknowledgement, insertion and undo. A temporary test-script
generation mistake interpreted literal `$&` as a JavaScript replacement marker;
that invocation failed syntax checking before execution and still restored the
clipboard. The disposable script was corrected and syntax-checked before the
successful run. No production code was changed for that script issue.
The corrected per-document first-scan samples were 13.2/16.3/163.6ms (automated
operation totals 58/70/212ms) for the same three negative cases, with the same
non-guarantee limits. A second bounded real guest visit on the confirmation-guard
revision returned HTTP200, no403 and zero native writes; paste/masks/native undo
passed again. React controlled-value and logged-in evidence remain unavailable.

The review budget is extended by one focused post-correction completion call,
because the two successful reviews found concrete defects requiring source
changes. This is three successful calls when that review completes, plus the one
unsent compatibility failure. No model override, fallback sender or subagent was
used. Its self-contained question will include the original request, corrected
contracts, first findings, final code/tests and fresh observations.

Before focused review, checks passed **124 files / 1571 tests (8.24 seconds)**,
lint and all four production packages. The last change touched only the rules
editor's late-receipt handling and its tests: first-scan/paste/live-trial core files
stayed hash-identical; the rebuilt options page was explicitly reloaded and passed
the failure/retry and two-window workflows again. The final copied/loaded identity
is:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| native-chatgpt-early.js | 222795 | `927715e037eb69117327e9039079235299c1c11ea42ac605f1b3288da419c810` |
| background.js | 964034 | `8ef9b45d48533b1a1151ae58feb18bfe9b51cfe8632ccd334bda683a4e2854d6` |
| content-script.js | 2013763 | `384feb621939a02d7777c6c92bd872f63022c3e713772cfaa759c8c8a9eef03a` |
| PasteReview.js | 161341 | `45e1b80cdb82dddbedf65441ac5e182abe56074b47a14a6c264395f2baea70d8` |
| shared.js | 2234394 | `efba5569b10acf7c2702118449af529cede9dd171a92c0a1fc1ab7b9850f0342` |
| options.js | 636644 | `ac1dd43742b58b9fccf3c8b16269c5e6de17b75ea2e2f1c16a248fb93b971b72` |

The new dirty-conflict state was visually inspected at 560px viewport width,
with a 476px rules region and no horizontal overflow. The last test browser was
closed and its fault injection existed only in the discarded page. The focused
completion call has been submitted with the corrected source and evidence;
its result and final dispositions follow. No daily installation or release was performed.

### Focused review and final UI dispositions, 2026-10-31

The third successful same-provider call returned after **433 seconds** reported
thinking. It accepted persistence-failure handling, successful-initial-read event
buffering and both UI/source original-confirmation guards. It did not execute
the tests or approve the later source below; its first result is retained outside
version control.

It supplied a combined state counterexample: save N, receive foreign F, complete
the save promise, explicitly use F, then receive late N. The parent would show N
while a clean editor retained F. The correction clears obsolete own-save intent
when choosing saved rules, and a clean editor always adopts an authoritative
own receipt. A regression runs that full ordering and verifies both displayed
and parent policy N. Existing dirty-new-edit late-receipt tests still pass.

The other deterministic finding concerned an invalid unsaved draft reporting an
invalid active policy. The editor now memoizes the saved-policy validation
separately: saved errors persist while repairing, and draft-validation errors
say that the draft was not saved and the saved rules still apply. A regression
checks a valid active policy plus invalid draft, with no storage write.

The reviewer also noted the conditional rejection of the initial configuration
read. The hook now exposes a non-persisted loading/ready/error state and catches
rejection; the real SettingsCenter → FeaturesTab → native-settings path forwards
it. Native controls are unavailable until a successful read, with reload on error;
rule writes enforce the same state. The hook/actual native component regression
rejects the read and verifies no editable default-policy controls or writes.
The rules editor also skips reconciling its unchanged initial snapshot so its
first passive effect cannot reset a newly added row after async mounting.

These final UI corrections passed 20 focused tests. They follow the review's
specific counterexamples; no fourth call or review waiver was used. The final
post-correction repository/build/browser observations follow. The review is not
represented as fresh independent approval of patches
made after it returned.

### Closure verification, 2026-10-31

Final `npm test` passed **124 files / 1574 tests (8.63 seconds)**; lint and all four
normal/reduced production Chromium/Firefox builds passed. The final production
package was copied, explicitly reloaded and tested in the owned Chrome156 profile.

Real production settings passed controlled write rejection/retry, two-window
dirty-draft handling and invalid-draft wording without changing the valid saved
policy. A separate disposable extension page injected rejection before the native
full-config read: the real settings path displayed read failure, offered reload
and exposed no default-rule editing controls. This was controlled failure
injection, not an observed storage outage. The page was closed afterward.

The final bundle passed the full synthetic Cmd+V/private-review/native-undo flow,
including both unchanged-original consent cases. Its three first-scan negative
samples were **10.5/21.9/185.2ms** (automated operation totals **52/66/239ms**),
with the same sample-only and soft-budget limits described above. No page JS/CSP
error or disabled-provider auth/session call occurred in the normal fixture flow.

One final bounded real guest visit on this exact package returned **HTTP 200**, no
observed 403 and zero native chat write attempts. The actual guest textarea again
passed regex variants, built-in masks, private confirmation, insertion and native
undo. Across the regex revisions there were three such bounded guest visits,
all HTTP 200; the historical Chromium 130 403 incident remains a separate record. React
controlled-value, logged-in rich-editor and other parent-plan gaps are unchanged.

All six final production files equaled the reloaded test copy:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| native-chatgpt-early.js | 224623 | `b3c110b45db0f3595d6df3131f400eef1bd4df9d1b582141ccf6b5f0467f9a35` |
| background.js | 965862 | `b4b93080edd6b133cc72d835015f81ed7a73288b297ce486130e7024b3f16b2c` |
| content-script.js | 2013763 | `384feb621939a02d7777c6c92bd872f63022c3e713772cfaa759c8c8a9eef03a` |
| PasteReview.js | 161341 | `45e1b80cdb82dddbedf65441ac5e182abe56074b47a14a6c264395f2baea70d8` |
| shared.js | 2236222 | `1a99eddeb54e0b62bfe60038062fd0bd7ab64d260ddaae0f6e11ced43f3fe8d6` |
| options.js | 637892 | `7fdc2bd648ae50a0416b0d071ecc9ee6ef23e03fb95a0aefb257e3e129bd217d` |

The clipboard guards confirmed restoration of all original formats after final
source-page closure and permission cleanup. The owned test browser closed; fault
injection was page-local and discarded. The other manual-login window, daily
installation, gateway and Drafts were untouched. No commit or release was made.
The regex amendment's implementation/review/verification tasks are complete; the
parent plan remains active for its explicitly unobserved logged-in acceptance.
