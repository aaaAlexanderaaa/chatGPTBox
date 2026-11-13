---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-12
---

# Gemini Web adapter

The user requested a separate worktree with a Gemini engine, using the existing
ChatGPT adapter as a reference, on 2026-11-12. The requested default is **4 Argon,
Thinking level High**. Account safety takes priority over making the integration
work; an unsupported or challenged path must stop.

## Baseline and intended delivery

The baseline is commit `99a4995`. ChatGPT Web and Grok Web already have provider
adapters and independent settings. Gemini Web is absent. Uncommitted MCP changes
in the source checkout are outside this worktree and assignment.

Implement a default-off Gemini Web adapter using the existing native Gemini
input component and its submission handler in dedicated tabs. Confirm the exact
model and High setting before submission, invoke that handler at most once,
reject concurrent requests, and retain a durable hold when a write or its
completion is uncertain. Login challenges, quotas, unknown controls and changed
documents fail closed. Credentials and native request checks remain with the
website. The website owns its transport fallback and same-turn recovery; one
extension invocation does not promise one upstream HTTP request.

The engine must appear in existing settings and conversation pickers. The
OpenAI-compatible gateway must route an explicit Gemini model to the same
adapter without invoking ChatGPT uploads or history. Existing ChatGPT defaults,
MCP tools, Drafts and Grok behavior remain outside the change.

History import, private Google HTTP endpoints, model fallback, unattended
background probes, account rotation, CAPTCHA bypass and automatic resubmission
are excluded. Normal website operation also cannot guarantee zero account risk.

## Sequence and recovery

1. Inspect current owners, code, the named open-source reference, and the real
   browser model controls. Obtain an independent design review before runtime
   implementation.
2. Reconcile the [product boundary](../product/contracts.md),
   [architecture](../../ARCHITECTURE.md) and [gateway](../api-server.md), then
   implement the provider, native-page operations, settings and gateway mapping.
3. Exercise meaningful synthetic tests for single sends, identity, completion,
   failure/stop/restart holds and consumer routing. Lint, check documents and
   build the production bundles.
4. Obtain a fresh completion review with the original request and actual code
   evidence. Correct findings and record the final checks and limitations here.

The revised budget is at most three ChatGPT review calls (initial DOM design,
native design, completion) and one natural Gemini task. The extra design review
follows the user's native-runtime clarification; the DOM candidate is discarded.
A real Gemini task is contingent on a ready adapter and an
unchallenged page. Stop account-bound tests immediately on a challenge or limit;
do not switch tools to retry it. Keep raw browser/account material outside Git.

Rollback is disabling Gemini Web and retaining its uncertain-write hold until
the user checks the website. No remote chat deletion is required. A worktree
build is not an installed-extension or running-gateway update.

## Evidence and limits

- The Brave model picker exposed `4 Argon` and `Thinking level` → `High`.
  Its closed control displayed `Argon High` after selection. No Gemini question
  was sent during inspection. This proves the visible selection, not a server
  model identifier or the safety of later automation.
- The named [browser-ai-bridge reference](https://github.com/jeffrey-nz/browser-ai-bridge)
  uses native-page controls. Its fallback/retry and overlay-dismissal policies
  are not adopted. Its Grok implementation was also inspected; no Grok change
  is selected by this task.
- Runtime implementation, settings, canonical selection and gateway routing are
  present in branch `codex/gemini-web-adapter`. The source checkout's three MCP
  edits remain outside this worktree. Installation, gateway deployment and live
  adapter acceptance are separate from this bounded source delivery.

### Independent design review and the safety decision

One isolated `ask_chatgpt` review received the original request, the verified
extension/provider/config boundaries, the observed model menu, and the proposed
DOM-only single-send design. It did not receive account identifiers, credentials
or private chats, and it could not inspect the worktree. Its first findings were:

- normal frontend use does not itself establish account safety;
- persist the possibly-sent boundary and the single-request lock across worker
  restarts;
- bind the dedicated document, account and model to the request, rather than
  reusing a check of another tab;
- identify the exact new user/assistant turn and require positive completion
  evidence before publishing `finalContent`.

The proposed extension route used `HTMLElement.click()`. The
[HTML Standard](https://html.spec.whatwg.org/multipage/interaction.html#dom-click)
specifies that its synthetic click has the not-trusted flag. This establishes
that the website can distinguish this event; it **does not** establish that
Google penalizes it. Neither the reference project's implementation nor the
review supplies an account-risk measurement or a supported automation guarantee.

[Google's terms](https://policies.google.com/terms) restrict automated access
that violates machine-readable instructions. They do not establish a blanket
ban on all browser assistance. The public `robots.txt` could not be obtained
through the web reader in this investigation. Gemini's
[usage-limit guide](https://support.google.com/gemini/answer/16275805?hl=en)
describes variable compute-based limits; these are not a proven safe automation
rate or evidence of an account penalty.

The initial investigation stopped the DOM-click implementation, but that was
premature as an overall feasibility conclusion. On 2026-11-12 the user clarified
the intended alternative: reuse the website's native JavaScript request path,
as the ChatGPT adapter does. Investigate that path before deciding whether the
requested adapter is feasible. Script-event distinguishability alone neither
rules out native-runtime adaptation nor establishes an account restriction.
The original account-safety constraint remains; this clarification does not
authorize bypassing native checks or accepting a new account risk.

### Native-runtime design review

Read-only public-source inspection identified the real native input component,
its `kNa(false)` submission entry, the actual conversation service (excluding a
mock), native model/High observables, content-bound request preparation and
attestation, and matching turn/terminal actions. The direct root-service shortcut
was rejected because it skips upstream UI gates. The input component preserves
that full pipeline, including website-owned recovery. It is the native entry
also used by event-free website voice flows, not a synthetic click.

A second isolated ChatGPT design review received those synthesized findings and
the proposed native flow. It supported that direction, while identifying model
selection timing, durable ownership, exact native identities and MAIN trust as
remaining concerns. The implementation uses the background as sole state owner,
acknowledged storage before native preparation, Chrome document IDs, a salted
account pin, one invocation and a persistent uncertainty hold. It checks native
model/High before invocation and verifies actual dispatch values afterward; an
async preparation interval cannot atomically lock the website's UI selection.
This limit is explicit in the contract rather than described as prevented.

In live Brave, all four public native function fingerprints matched the pinned
English runtime. The unique editor, real input/service, required methods,
FormControl, native state/action shapes, signed-in flag, 4 Argon and observed
High value were confirmed read-only. Native helpers and hash values are recorded
in `src/config/gemini-web.mjs`; raw account labels, tokens, chats and DevTools
logs were not added to Git. This observation did not execute the new extension
adapter against Gemini or establish an account-policy guarantee.

### Fresh completion review and corrections

The third isolated ChatGPT call received the original request and clarification,
the accepted native boundary, actual preparation/observation and background
submission/recovery code, consumer behavior, controlled-test results available
then, and the zero-live-send limit. It could not inspect the checkout. Its first
assessment retained the candidate but blocked acceptance on four concrete gaps:

1. Recreated historical same-text DOM could be combined with the new native
   turn's completion, and DOM content could lag native final state.
2. Stop during awaited journal cleanup could race a completed terminal message.
3. The pre-invocation action listener ignored an unexpected native Send during
   preparation.
4. Recovery could remain pinned to a gone document, or silently clear a hold
   when the original tab was missing.

The final candidate reads answer content and completion from the same native
row, with no answer DOM lookup. It renders inspected native text/code/list/table
blocks as inert HTML and refuses unknown interactive output. Streaming actions
also reset terminal evidence for a continuing native stream. Completion is
published synchronously before asynchronous journal cleanup, and one terminal
owner plus the existing port guard arbitrate Stop. The action listener now runs
from preparation onward and blocks an extra adapter invocation on an unexpected
Send. Recovery reads the current document without retargeting a writer, keeps
the hold on lost ownership, and requires a separate explicit acknowledgement of
an unconfirmed old outcome before permitting new work and retiring the binding.

New regressions cover all four findings, including the actual shared port-run
guard, old DOM reconstruction, a fast independent native submission, and
reload/closed/navigated-tab recovery. These corrections have local test evidence;
they were not sent for a fourth independent review. The review's acceptable
scope is source implementation plus controlled verification, with live service
compatibility and account safety unproven.

### Verification and closure of the initial source delivery

After the review corrections, Node 22.18.0 completed:

- `npm test`: **143 files, 1,949 tests passed**, including the new race and
  recovery cases. These are synthetic/local integration tests, not account tests.
- `npm run lint`: passed.
- `npm run docs:check`: **61 files, zero errors**, four pre-existing historical
  link advisories; no documentation checker implementation changed.
- `npm run build`: passed both production passes and produced all four normal
  and reduced Chromium/Firefox ZIPs. The existing Browserslist age warning
  remains; no dependency refresh was introduced.
- The serialized native function extracted from both final background outputs
  was parsed for free references and executed in Node against an unsupported-
  origin fixture. It has no external Babel/webpack helper dependency. This
  packaging check does not claim execution inside either live browser.
- `git diff --check`: passed. The source checkout still has only its three
  pre-existing MCP edits; this worktree preserves them outside its changes.

The earlier 1,939-test run predates the review corrections and is not reused as
final-candidate evidence. This plan closes the requested worktree implementation
and local verification. Live provider compatibility, installed-extension use
and future account behavior remain unverified, with no claim of release or
account acceptance.

### User-authorized Brave installation and one live trial

After the source delivery, the user explicitly requested installing/enabling
this worktree build in Brave and sending one real request with 4 Argon / High.
The trial budget is one new Gemini invocation, zero automatic resubmissions and
no additional ChatGPT review calls. The user required stopping on verification,
rate limiting or other anomalies, with no automatic retry. The first operator
attempt incorrectly included a local runtime mismatch in that stop category;
the user's subsequent clarification and continued trial are recorded below.

Update the existing unpacked installation with the already checked production
archive, retain a file backup, reload the extension, enable/check Gemini and use
the actual adapter UI for one non-sensitive natural question. Do not use a raw
console submission or bypass an adapter guard. Preserve any uncertain hold and
report installed state, actual invocation count and observed result separately.
The bounded trial ended at its first readiness refusal:

- Updated the existing Brave unpacked installation with the normal production
  `chromium.zip` from the completed local checks. Archive SHA-256:
  `b56f5811d6d146f12986e6d33ceeb9fd24c7925f819b16101fec0266d604ea55`.
  The prior files were retained in an adjacent rollback backup. The manifest's
  permissions, host permissions and optional permissions were identical.
- Brave's extensions page visibly confirmed `Reloaded`; the fresh options page
  exposed the Gemini engine and settings. Enabled its engine toggle. The global
  ChatGPT default and unrelated provider settings were not changed.
- Refreshed the existing Gemini page. It displayed 4 Argon; its thinking submenu
  showed Low after the reload, so selected the user-requested High. The closed
  control then displayed `Argon High`.
- Clicked `Check Gemini page` once. The installed adapter returned:
  `This Gemini website version has not been verified. No submission was attempted.`
  This is a readiness refusal, not observed evidence of an account penalty.
  No further browser/runtime investigation or account test was attempted; the
  exact version-marker/namespace mismatch remains undiagnosed.
- **Gemini native submissions: zero; automatic retries: zero.** No prompt was
  entered or sent, no challenge was solved and no uncertain hold was released.
  The engine toggle remains enabled, but readiness is false and the Gemini model
  is not advertised as ready. No gateway process was restarted.

That first follow-up was ended as **installed, live trial stopped before
submission**. The user's later clarification established that treating the
adapter's own compatibility error as the provider anomaly they meant was an
operator mistake. This was premature closure, not live acceptance.

Initial full checks inside the restricted sandbox could not start local fixture
servers and exposed one missing VM-fixture import for the new Gemini routing
predicate. The fixture dependency was added; the complete local suite was rerun
with loopback-server access. No account-bound test traffic was involved.

At that first installation ending, account use was three ChatGPT review calls
and zero Gemini messages.
The Brave installation was updated as recorded above; no real adapter
send/completion was accepted. Source/build delivery and installation do
not establish live compatibility, future account safety or Google permission
for this pattern. Unsupported runtimes and account challenges continue to stop
the adapter.

### Correction after the user's runtime-check clarification

The user correctly identified that the readiness message was generated by the
adapter. It was not a Gemini response, and their authorization did not depend
on a previous successful test. The prior early stop was an operator error. The
one-submission trial remained authorized. At the start of this correction,
actual Gemini submissions were still zero, so no generation retry was involved.

Read-only inspection found the refreshed page running the public compilation
`qGl2D_iBXPk.2018.O`, while the adapter only mapped `VxAhX7iBM_A.2018.O`. The
Angular view map, input/service classes, state and event fields had changed.
Both public JS modules were read without cookies or credentials; five actual
live function fingerprints (submit, service send, preparation, attestation and
native thinking selection) matched the inspected public source. The page still
showed 4 Argon / High with an empty editor and idle native state.

Added a separate runtime profile, semantic field mappings and a precise local
compatibility diagnostic. A fresh owned document is identified read-only before
the native menu setter applies available High; this handles the observed reset
to Low on a new document without overriding Gemini's checks or request payload.
Regression fixtures exercise both compiled layouts, current terminal events,
native High selection and refusal to change manual tabs, other models or an
unavailable level. The single-invocation journal and provider stop conditions
are unchanged.

The corrected trial completed successfully:

- Fresh full local checks passed **143 files / 1,951 tests**, lint, documentation
  checks and both production build passes. The native operation extracted from
  the final bundle has no external Babel/webpack helper references. This
  supersedes the earlier test counts for this corrected candidate.
- Updated the same Brave unpacked installation, retaining a rollback backup.
  The installed normal Chromium archive's SHA-256 is
  `63dc37489eff9a52ba404310aa13ae8dd589bf8b11712f7e7b6734c682af4da3`.
  Browser permissions remained identical. Brave visibly confirmed `Reloaded`.
- `Check Gemini page` then displayed `Gemini is ready: 4 Argon / High.` Created
  a separate local chat in Preview chat and selected
  `geminiweb/gemini-4-argon-high`; the global ChatGPT default was preserved.
- Submitted **one** non-sensitive natural Chinese question about avoiding
  duplicate AI submissions and handling an unknown timeout result. The native
  dedicated Gemini tab showed that exact question, `Argon High` and generation.
  No console submission or raw HTTP request was used.
- The native website reached its completed response with a Copy action and no
  Stop action. ChatGPTBox then displayed the full response, persisted one
  question/answer record and restored its empty input and Send button. The
  installed adapter's native request-ID/terminal-action/final-state checks had
  accepted that result; stable-text polling was not used for completion.
- **Total Gemini submissions: one; extension resubmissions: zero.** No CAPTCHA,
  rate-limit refusal or account error was observed. The site displayed general
  Argon usage advice after the completed answer; it was not a cooldown or a
  blocking quota error. No second prompt was sent and no hold was manually
  released. No gateway process was restarted and no further ChatGPT review
  calls were made (three reviews total across the task).

The worktree implementation, Brave installation and authorized single-response
trial are complete. This proves one live 4 Argon / High round trip through the
installed adapter. Continuations, gateway live Gemini traffic, future runtime
versions and future account behavior were not tested by this single submission.
