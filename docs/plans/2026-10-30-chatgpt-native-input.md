---
doc_type: plan
status: active
authority: planning
last_reconciled: 2026-11-14
---

# ChatGPT native input: first delivery

## Outcome and authorization

On 2026-10-30 the user approved the clarified
[product scope](../product/browser-assistant.md#experience-design-2026-10-30)
and instructed implementation. Deliver ordinary-paste local checking/redaction
and a draft-rewrite entry in the native ChatGPT main editor, with independent
Sites settings. Native send remains the user's action. The accepted first
automatic-paste scope is desktop Chromium; current Firefox features remain.
[Architecture](../../ARCHITECTURE.md#browser-experience-proposal) owns the paths,
privacy boundary and transient state.

## Baseline and gap

Existing page functions already preview material, select an engine, compare
rewrites, apply and undo with freshness checks. There is no native paste
protection or dedicated ChatGPT draft entry. The generic content-script bundle
runs without an early paste contract. Native enhancement must work independently
of ChatGPT Web provider/gateway activation. The uncommitted documentation and
user discipline files predate implementation and must be preserved.

## Execution and completion evidence

- [x] Complete the privacy design review and follow up the actual sender-metadata
  finding. The declared two-call budget increased to three for that discovery;
  the first completion attempt was rejected before execution due to review credits.
  After the user reported availability, one explicit retry succeeded (294 seconds
  reported thinking). A fourth focused completion review found two further state
  defects (454 seconds). A fifth focused review accepted the specified corrections
  (345 seconds). Five calls executed, plus the unsent attempt; no model override.
- [x] In a disposable Chromium profile, verify document-start capture against
  earliest MAIN listeners using real system paste without native website sends.
- [x] Add independent Sites settings, supported-editor detection and nearby
  draft entry reusing existing Functions/preview/replacement/undo.
- [x] Implement bounded local rules, one transient operation, extension-origin
  review, background-witnessed one-use proof and document/range freshness checks.
- [x] Verify relevant adversarial/failure/cancellation cases, private data flow,
  no provider request for local paste and no automatic native message send.
- [x] Run full tests, lint, production builds and the controlled browser workflow.
- [x] Address the fresh completion evaluation's findings. The successful review found
  engine-off auth side effects, default-off/unknown-input interception, BFCache/IME
  gaps and multiline material loss. Its follow-up found known-off refresh and
  registration failure-state defects plus untrusted draft click. All were corrected
  and passed fresh checks below. The final review accepted those corrections and
  identified a missing-key default-off edge. That explicit branch was corrected;
  45 focused tests, lint and rebuilt production packages passed afterward. No sixth
  peer call was made. Original 1482-test/Chromium130 results do not approve this revision.
- [ ] Complete current logged-in rewrite/application/undo acceptance:
  headed Chrome 156 real guest-editor paste/rewrite/application/undo succeeded
  with HTTP 200 and zero native chat writes. Its textarea has no controlled React
  value to compare. November 14 installed Brave verified the logged-in native
  ProseMirror editor's paste review, masked insertion and native undo. Rewrite
  reached the provider but failed with `400 Invalid conversation body`; the user
  deferred further rewrite/video AI acceptance. Physical OS IME and an actual
  BFCache hit remain unverified. The user clarified that account switching was
  not their requirement; it is not a blocker for the current assignment. The
  earlier headless Chromium 130 challenge/403 incident remains dated evidence.
- [x] Reconcile product, architecture and guide with actual behavior and limitations;
  retain this plan as active rather than claim live acceptance/release completion.

[Implementation evidence](../evidence/2026-10-30-chatgpt-native-input.md) records
artifacts, first findings/dispositions, exact methods and limits. The literal
delivery passed 122 files/1504 tests; the subsequent regex revision passed
**124 files/1574 tests (8.63 seconds)**, lint and all four normal/reduced production
Chromium/Firefox packages. The final regex package was explicitly reloaded in a
fresh isolated Chrome 156.0.8078.76 profile, with six relevant files hash-equal.
Settings, controlled paste and the final real guest-editor trial passed. The earlier
manual-login profile was left unchanged. Final docs/diff results are recorded below.

First-delivery acceptance still requires the declared supported logged-in editor.
Peer review and fixture success cannot close that live gap.
No real-account message, installed extension replacement, gateway restart or
Drafts update was part of that original October verification. The November 14
follow-up below records its separate authorization, installed state and limits.

## Failure and recovery

Default both features off. Pending/failed/incomplete operations cannot silently
insert raw text. A stale editor, navigation, review close or extension disconnect
cancels the operation and releases buffers. Disable/remove the owned listeners
and UI on rollback; never replay native submissions or retained originals.
Unsupported automatic paths remain visibly unavailable. Native labels, answer
restoration, quota dashboards, sync and a general writing platform are excluded.

## Current progress

The following regex work records the October 30–31 scope. It does not replace
the November 14 installed-page observations at the end of this record.

The user amended the custom-policy scope on 2026-10-30: replace the exact-term
list with regex matching/replacement entries to cover variants. This amendment
is complete within the declared regex/guest-editor scope; the parent plan's
logged-in acceptance remains open. Earlier literal-only scans do not prove the
new engine or replacement behavior. The initial review budget was one
self-contained design call and one completion call. The completion review
(402 seconds reported thinking) confirmed the regex feature and found policy-write
failure, dirty-window replacement and original-confirmation consistency issues.
Those paths were corrected and freshly verified; one focused post-correction
review completed (433 seconds reported thinking), for three successful calls.
It accepted write-failure handling, initial-event buffering and original consent,
and identified one combined late-receipt/use-saved state defect plus misleading
draft-validation wording. These exact counterexamples were corrected and added
to regression tests. Its conditional initial-read failure gap now has explicit
read-state/error UI and a write guard for the native policy. The first
compatibility failure sent no question.
The first design call returned `CHATGPT_WEB_RUNTIME_UNSUPPORTED`/503 before
sending a question. Gateway health/bridge were healthy with zero pending requests;
the actual proxy tab was not exposed by the available browser controls. No
alternate sending channel or installed-extension change was attempted. The user
then reported that another session restored `ask_chatgpt`; one self-contained
design retry completed through that MCP (444 seconds reported thinking). Its live
tool metadata includes the stateless-context description. Review accepted RE2JS
with corrections: strict template parsing, explicit standard non-overlapping
iteration, conservative multi-rule conflicts, final-selection secret audit, and
512/16384 compiled-size bounds. Per-document first-scan browser measurements are
recorded; 500 ms is only a soft budget, and hard compile/heap bounds remain unproved.

- [x] Implement regex entries, migration, bounded matching and explicit replacement
  semantics, including captures, conflicts and locked credentials.
- [x] Verify settings editing, invalid/imported policy and production browser
  paste/review/replacement/undo for the revised rule format.
- [x] Reconcile the guide/evidence and evaluate the revised artifact with the
  original user goal and observed limits.

Fresh production UI verification found a two-phase settings acknowledgement issue:
optimistic state and Chrome's field-reordered storage event cleared save feedback.
Canonical rule serialization and actual shared-hook regressions corrected it.
That hook also preserves null policy imports as invalid while key deletion restores
defaults. Browser settings save/error, null/deletion and 1100/560px layout passed.
The final document-start bundle passed genuine Cmd+V, private review, captures,
conflicts, secret/output failures and native undo. Per-document first-scan 20k
negative samples measured 10.5/21.9/185.2ms from keydown to approved input; these
are samples, not hard bounds. The final bounded real guest visit returned HTTP 200,
no 403 and zero native chat writes; regex variants and native undo passed. Its
textarea has no controlled framework value, so logged-in rich-editor acceptance
remains open. All original clipboard formats were restored; the new temporary
browser was closed. The first completion evaluation found the storage/confirmation
issues described above. Their corrections passed fresh full checks, controlled
failure injection, two settings windows and real Cmd+V acknowledgement; the core
packages also passed the bounded guest-site workflow. A final self-contained
focused review inspected that corrected source and evidence. Its last UI findings
were addressed with focused regressions; the last patches were not sent for a
fourth peer call and are not described as independently re-approved.

The completion review's concrete code corrections passed fresh repository and
controlled browser checks. The real website's logged-out
`textarea#mobile-composer-prompt` variant was observed, added to the exact adapter,
and passed native paste/review/masked insertion/undo and explicit rewrite/apply/undo,
including a rerun after the final state/click corrections. The website pages closed
at the end of each trial. No 403 occurred in the four
bounded headed visits; this does not erase or establish the cause of the older
challenge failure. Review findings have dispositions; logged-in acceptance remains.
The user authorized review handoffs and clipboard testing. The final consolidated
trial preserved all system clipboard formats in local process memory and restored
them; no original clipboard content was output or shared.

The synthetic provider has stopped. The earlier isolated Chrome 156 window was left on
a local `about:blank` login instruction page, with manual login requested; no
automated website/challenge page was left open. No login UI is inspected until
the user confirms completion. The last deleted-key correction rebuilt early paste
code but has not replaced/reloaded the temporary copy while the user may be logging
in. That profile remains untouched by the new regex-profile checks above. Before
resumed logged-in acceptance, copy the current build, reload only its test extension
and refresh the source page; restart the synthetic provider only for rewrite tests.
Current `docs:check` passed with 49 files, zero errors and four existing advisories;
`git diff --check` passed. At the earlier literal-delivery checkpoint, the user's six
pre-existing discipline files were verified unchanged from the saved baseline.
This regex amendment updates its existing owners; the other session's runtime
repair evidence remains preserved. All implementation files remain reviewable in
the workspace; no commit, installed
extension replacement or release was made. No review was waived. Further real
logged-in validation requires a legitimately signed-in browser context; cookies,
credentials and private conversations are not copied into the test profile.

## Release authorization, 2026-10-31

After the regex implementation handoff, the user explicitly requested commit,
push, build, install and release. That instruction authorizes the v4.3.0 release
and replacement/reload of the daily Brave installation at the existing supported
path. It supersedes the earlier verification-only no-install scope for this
release task. The site enhancements retain their independent default-off state;
release publication does not close the logged-in editor/account/IME/BFCache
acceptance gaps above. Keep this plan active for those gaps. The existing implementation evidence now records the actual 4.3.0 installation:
Brave Reload, the new regex settings with both switches still off, byte-equal
installed files and the reconnected healthy bridge. The tagged GitHub workflow
records release publication separately; the private account-project smoke read
was rejected before execution. The logged-in/transition acceptance task stays open.

## November 13 acceptance attempt

The user requested closing this acceptance gap as part of the
[current delivery](2026-11-13-gap-closure.md). CUA could not restore its browser
documentation because automatic approval review reported exhausted workspace
credits. The action was not executed; this was an approval-service failure, not
a supplier challenge or a finding that the action was unsafe. No new logged-in
editor, OS IME, account-transition or BFCache result follows from this attempt.
Keep this plan active; the existing synthetic/guest evidence remains dated.

## November 14 installed follow-up

Browser access returned during the [gap delivery](2026-11-13-gap-closure.md).
Brave's current logged-in editor uses the observed native form/composer ancestry
with `div.ProseMirror[data-composer-markdown][role=textbox][aria-multiline=true]`.
The exact adapter was extended for that shape; unsupported/ambiguous and proxy
editors remain excluded. After build/install/Reload, genuine Cmd+V opened local
review before native insertion, confirmed masked text entered the rich editor,
and native Cmd+Z restored its empty draft. This establishes the logged-in paste
path, not complete rewrite or every framework synchronization case.

The genuine Rewrite draft entry opened a 62-character material preview using
the configured ChatGPT connection. Run reached the website, which rejected the
request with `400 Invalid conversation body`. Its common run remains
settled/unknown, possibly submitted, with no native conversation reference;
there was no retry. The user selected delivering Gemini/Drafts this round and
deferring ChatGPT rewrite/video AI acceptance. Applying a verified AI rewrite
and its extension undo remain unobserved on this logged-in editor.

Physical key input produced five trusted input events and zero composition
events, so it does not prove OS IME behavior. Real navigation away and Back
returned via `back_forward` but created a new document. The browser reported
`response-cache-control-no-store`,
`response-cache-control-no-store-with-js-network-request` and
`websocket-used-with-ccns` as not-restored reasons. Actual BFCache behavior remains
unverified; website protections were not weakened to force a hit. Test listeners
and the session-storage marker were removed. No account switch was attempted;
the user clarified that it was not their requirement for this task.

Both native switches were restored to their original off state, confirmed in
running storage, with zero registered early native scripts. The own unsent trial
draft was cleared and its page reloaded; no original private draft was removed.
Keep this parent plan active for its remaining declared live acceptance rather
than infer success from the completed bounded Gemini/Drafts delivery.
