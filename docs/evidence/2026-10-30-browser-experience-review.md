---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-30
---

# Browser experience redesign: critical review and evidence

## Request and scope

The current conversation requested a review of ChatGPT-Toolkit on October 27,
then corrected the analysis toward direct AI-website use, local paste redaction
and lightweight writing assistance on October 28, and desktop-tool reuse,
classification, MECE and priority on October 29. On October 30 the user requested
a critical self-review and new design under the refreshed project discipline.
These are directly available user instructions in this conversation. They
authorize this design/review assignment, not installation, feature development,
live test submissions or publication. Acceptance of the general understanding
is not approval of every proposed feature.

Product decisions remain at the
[browser-assistant owner](../product/browser-assistant.md#experience-design-2026-10-30);
the [architecture candidate](../../ARCHITECTURE.md#browser-experience-proposal)
owns dependency and trust-boundary details. The pre-existing discipline changes
were already uncommitted at the start and are outside this edit's scope.

## First critical findings

These findings were formed before the new peer comparison. They review the
actual earlier answers, not a reconstructed claim that they already implemented
or promised a release.

| Finding | Evidence, consequence and limit | Design response |
| --- | --- | --- |
| The initial outcome was narrowed to gateway/extension-origin calls | The first answer proposed diagnostics/history hooks and counting only Box calls. The user had to identify native ChatGPT interaction as a separate outcome. Those hooks cannot observe every native input or message | Two independent browser usage surfaces; external invocation stays an interface |
| The second pass discovered needs but did not select justified work | Paste redaction and writing were supplied by the user; the subsequent catalog demonstrated existence, not task frequency, equivalent coverage or measured value for this product | Explicit alternatives and conditional adoption; market presence is not a release priority |
| The classification had not yet established concrete ownership | The later answer already proposed atomic decomposition, but text processing, browser effects and site interpretation still lacked explicit state/dependency owners in the project. Complete products and journeys cannot each occupy only one of those owners | Carry the corrected decomposition into actual ownership; keep surfaces, adoption and priority separate |
| Desktop reuse was considered late and initially too narrowly | Official Raycast material includes in-place changes and browser content; PopClip has selected-text processing and paste actions. “Browser-related” alone does not justify duplication | Compare the existing-tool combination as the strongest feasible alternative |
| The privacy explanation left a host-visible UI ambiguity | The prior answer proposed restoring in an “extension interface” without specifying its origin. A content-script panel shares the host DOM even when its JS world is isolated | Extension-origin review/restoration; no raw-value DOM rebroadcast; automatic paste remains a separate unproved claim |
| Priority and acceptance were easy to conflate | Earlier lists placed redaction among first features without a validated interception contract or language/false-positive evidence. Existing upstream tests were explicitly offline and not integration evidence | Separate correctness obligations, bounded feasibility questions and shippable candidates; no new safety approval claim |

The initial research did inspect upstream code and qualify its 55 offline test
results. This review does not reclassify those results as false or newly run;
their limit is that they do not verify a ChatGPTBox integration or live website.

## Current local observations

The local baseline was `be8d913163bc5bbbbdef7f320c2535cc0be34d2d` at
`aaaAlexanderaaa/chatGPTBox`, plus the user's six uncommitted discipline files.
The later upstream PR reference below is a different repository/branch and is
not assumed to describe this checkout's missing work.

- [`Result.jsx`](../../src/browser-assistant/Result.jsx) displays original and
  suggested rewrite text and applies/undoes the whole replacement. It is not a
  per-change acceptance interface.
- [`effects.mjs`](../../src/browser-assistant/effects.mjs) checks source/target
  freshness and rejects unavailable changes; [`context.mjs`](../../src/browser-assistant/context.mjs)
  captures explicit scopes. This is reusable existing behavior, not an absent
  writing subsystem.
- [`content-script/index.jsx`](../../src/content-script/index.jsx) handles proxy
  requests and ordinary page actions. The current
  [`manifest`](../../src/manifest.json) does not declare a document-start safe-paste
  entry. No current native-paste safety contract was found in those paths.
- [`response-diagnostics.mjs`](../../src/services/clients/chatgpt-web/response-diagnostics.mjs)
  collects facts for the extension's request lifecycle; it cannot establish
  native website message coverage.
- [`SettingsCenter.jsx`](../../src/options/SettingsCenter.jsx) uses `Functions`
  and `Sites`; the `ChatGPT Web` section is gated by engine activation. Native
  site enhancement therefore needs a separately selectable setting if adopted.
- The existing [first-delivery record](../plans/2026-10-21-browser-assistant.md)
  declares deterministic-browser and live-account limits. Its old test count
  and checked items are not fresh evidence.

## Public sources inspected on October 30

| Source | Claim supported and limit |
| --- | --- |
| [Raycast AI Commands](https://manual.raycast.com/ai/ai-commands) | Existing grammar correction, change highlighting and in-place replacement; Quick Fix has its own execution/credit behavior. No local equivalence benchmark was run |
| [Raycast dynamic placeholders](https://manual.raycast.com/dynamic-placeholders) | The focused browser tab can be supplied through its browser extension. This refutes a categorical claim that only this project can obtain web content |
| [PopClip JavaScript actions](https://www.popclip.app/dev/js-actions) | Selected-text transformations and paste-result actions are existing primitives; no claim that they automatically enforce every site's paste policy |
| [DFKI Privacy Guardrail](https://github.com/dfki-dsa/pii-guardrail-browser-extension) | A reusable-design candidate exists; its documented browser-local approach and beta status do not establish current website/Chinese coverage or select a dependency |
| [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) | Isolated JS worlds and shared host DOM are different boundaries; early content-script timing is explicit |
| [MDN paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event) | Default insertion can be cancelled and replaced. That alone does not prove all observation paths are intercepted |
| [Upstream PR #996](https://github.com/ChatGPTBox-dev/chatGPTBox/pull/996) | A separate repository has an open selection-replacement contribution. Its author reports Firefox testing and describes stale-target/undo behavior; neither that report nor PR state proves local absence or current integration |
| [Privacy Guardrail releases](https://github.com/dfki-dsa/pii-guardrail-browser-extension/releases) | The inspected 0.5.0 notes describe missed review when editors changed, misplaced insertions and mapping/long-input fixes. This is concrete maintenance-risk evidence, not a fresh reproduction or proof that current releases still have those defects |

Other plugins in the October 28 research remain leads. No new full market
survey, license audit, local NER benchmark or install/compatibility trial is
claimed. No scoring or usage frequency was manufactured from the catalog.

## Bounded comparison and review limits

The declared account-bound budget was one `ask_chatgpt` request, stopping after
one complete result. The preserved first input described the original goal,
all user corrections, current implementation, constraints, two usage paths,
privacy assumptions, alternatives and proposed priority. The preserved UTF-8
handoff file, including its terminating LF, had SHA-256
`b6e58a9361cfe44a0699a795c9a95d28e7a808c0e697167e0942c7d5449fb410`.

The peer received a new design handoff, not the full chat transcript. It was
asked to assess adoption and the strongest objections as a first-time maintainer.
Its account personalization and public sources may overlap this investigation;
it is a different standpoint, not independent website evidence or a completed
privacy/security audit. The final repository artifact also receives local
source/reader review; no independent live completion evaluation is claimed.

The request completed once; reported thinking duration was 250 seconds. No
second prompt, model override or automatic retry was sent. The first response
was retained before its assertions were reconciled with local facts.

| First peer finding | Disposition and reason |
| --- | --- |
| Include the unmerged upstream replacement PR in the baseline | Reference verified, proposed prerequisite rejected: the local fork already has a different replacement/undo path. Compare the contributions for reusable details, but an upstream merge is not a blocker for this design |
| Existing tools may have lower lifetime cost than new native adapters | Retained as the strongest alternative. Release notes provided concrete failure mechanisms. Local comparative operation cost and user frequency remain unmeasured |
| Raw text should enter an extension-origin review surface first; automatic paste is separate | Adopted in the product proposal as the explicit comparison baseline. It is a proposed workflow, not an installed protection. Added the distinction between irreversible credential removal and reversible identity placeholders |
| Extension origin does not isolate other privileged code in the extension | Adopted as a threat-model limit and data-flow concern. No claim of sandboxing the existing broad extension permissions or provider code is made |
| Decide through gates rather than approve the feature list | Initially used as the main recommendation. After the user's clarity correction below, gates remain validation of a selected proposed outcome, not a substitute for selecting one. Labels/counters/sync remain outside the first delivery |
| Collect user/browser distributions and task frequency before proceeding | Scoped: those are unknown inputs, not a required market-research project. The user's explicit scenarios remain legitimate requirements; equivalence and benefit can first be judged on those tasks |

This is a new-context critique of the first design handoff with shared source
dependencies. It is not a fresh consumer trial of every final paragraph. The
final repository text was reconciled locally; the privacy path's independent
design and live completion evaluations remain outstanding before implementation.
The design assignment does not authorize filling that gap with account writes.

## Correction after feedback on the written design

The user then reported that the design did not explain the current state or
target clearly enough to understand what would be implemented. The criticism
matches the artifact: the proposal led with classification, alternatives and
decision gates, while its first-delivery table mostly proposed more comparison.
This was a communication and selection gap, not evidence that the existing
rewrite implementation was absent or that new features had been approved.

The product owner now leads with a current/target comparison and selects a
concrete proposed first delivery: ordinary native ChatGPT paste triggers local
checking/redaction, and a nearby draft-rewrite entry reuses the existing function,
comparison and guarded replacement flow. It describes the user's complete steps,
the delta from current code and what would count as completion. The automatic
paste goal cannot be marked delivered by completing a manual review window.
The architecture now shows the two exact paths and separates local checking,
explicit provider calls and native website sending.

Desktop Chromium/main-editor acceptance, explainable rules, confirmation of
matched text and deferral of answer restoration are implementer recommendations
within this design proposal, not platform requirements quoted from the user.
Native labels are a later independent item; quota/sync and a general writing
platform are outside the first delivery. Existing-tool reuse and privacy limits
remain the rationale and acceptance boundaries after the explicit outcome.

This correction used local source/reader review, without another account-bound
model request or live website trial. The previous peer did not evaluate the
revised first-delivery artifact; its critique is not independent acceptance of
that artifact. In particular, native paste confidentiality, editor coverage,
detector quality and the benefit over existing tools remain unverified.

## Executed checks and closure

- Before the wording-only clarity correction: Node.js `v22.18.0`;
  `npm test -- tests/browser-assistant.test.mjs tests/module-boundary.test.mjs`:
  2 files and 101 tests passed. These establish the existing scoped function,
  snapshot/replacement and module-seam baseline under controlled conditions;
  they do not validate any proposed native-site feature.
- Public sources and local source paths above were inspected. The current
  usage guide was reconciled against the scope: it still describes implemented
  page functions; it now explicitly distinguishes the new proposal and adds no
  procedure for an unimplemented feature.
- `npm run docs:check`, rerun after the clarity correction: 46 files, 0 errors,
  4 advisories, all retained historical
  missing references. The guide-projection review trigger was reconciled by
  reviewing the guide and distinguishing current steps from proposed behavior.
- `git diff --check`: passed. SHA-256 comparison confirmed all six pre-existing
  user discipline files remained unchanged by this assignment.

No product code, dependency, portable function schema, installed extension,
gateway process or Drafts copy was changed. No user study, live AI-site paste,
Chinese detector benchmark, real-account business test or feature acceptance
was performed. The delivered product and architecture sections are explicitly
proposals; the original accepted browser-assistant direction remains in place.

## Subsequent implementation

The user later approved the clarified first delivery with “同意，开始”. The
[implementation record](2026-10-30-chatgpt-native-input.md) owns the later code,
browser observations, review failures and remaining acceptance. The baseline
observations and design-only limits above describe the earlier comparison;
they are not current claims that the new code is absent.
