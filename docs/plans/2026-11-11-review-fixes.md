---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-11
---

# Review follow-through: conversation and page workflows

The user approved fixing the defects confirmed in a review of `7f5d87d` on
2026-11-11. The checkout was clean. This assignment repairs conversation state,
gateway continuation, and page-input/material workflows; it does not adopt the
external review's proposed discipline migration or publish/install a release.

## Outcome and owners

- Retry replaces the intended successful exchange, including cards whose first
  question is not rendered; failed retries retain the original durable record.
- Clear keeps the local conversation identity, advances its remote binding,
  clears all provider snapshots, and rejects stale-window writes. Import retains
  generation-specific keys. See [product behavior](../product/contracts.md) and
  [cache lifecycle](../cache-lifecycle.md).
- Authentication and native preparation failures proven to precede a prompt
  write report `dispatched: false`. Lost messages, timeouts and attempted writes
  remain uncertain. Follow-ups require a fresh usable parent; ordinary operation
  status distinguishes active work from ambiguity. See [gateway](../api-server.md).
- Provider rejection preserves the input draft. Stop delivers synchronous
  provider finalization before invalidating old output and clears stale DSH
  decisions. See [conversation boundary](../../ARCHITECTURE.md#material-execution-and-binding-ownership).
- Editable-input capture preserves paragraph boundaries. Native editing and
  guarded undo replace direct rich-editor DOM mutation; another rewrite can
  explicitly prepare current input without silently changing a preview.
- Page-structure variables exclude extension UI. Extra-material consent follows
  the actual material, rather than resetting on unrelated instruction edits.
  See [page functions](../browser-assistant.md).

## Work and verification

1. Record failing regression cases against actual modules and connected
   consumers. Compare supported variants and failure/Stop cases.
2. Obtain one fresh-context design review of dispatch, Port lifecycle and input
   effects before changing those boundaries. At most one further completion
   review is planned; preserve findings and state its actual coverage.
3. Repair the existing owners and their consumers; update operative contracts
   and guides in place, without copying implementation logs into them.
4. Run focused regressions, the full suite, lint, documentation checks and the
   four production bundles. Exercise changed UI flows in controlled Chromium,
   including input preservation, first-card retry and rich-input apply/undo.
5. Reconcile this record and the plan index with actual evidence and limits.

Runtime verification uses synthetic account/message IDs and local fixtures.
No real-provider feature test or installed-extension/gateway/Drafts update is included;
the separately declared review requests use the authorized configured account. A
controlled rich editor does not prove current ChatGPT ProseMirror compatibility.

## Risks and recovery

False unsent classification can permit duplicate upstream writes, so only
positive evidence from the request owner can release that boundary. A failed
fresh read cannot authorize a follow-up using stale cache. Binding transitions
must preserve conflict checks instead of weakening them to make Clear pass.
Input effects must reject stale snapshots and unsupported/partial native edits
without a second fallback write. Existing data remains in its current schema;
there is no destructive migration. Reverting the code retains the previous
behavior and its known defects.

## Current evidence

Before implementation, focused existing tests passed (5 files, 116 tests) and
`docs:check` passed (55 files, 4 historical advisories). Separate synthetic
witnesses reproduced first-card retry duplication, Clear binding conflict,
composite-key import/deletion, paragraph concatenation, stale second rewrite,
assistant self-capture, premature start/Stop finalization loss, and ordinary
operation misclassification. These are local observations, not live acceptance.

The fresh design review supported the repair direction and identified four
important refinements: provider entry without output must remain an unknown
dispatch; a plain session binding cannot establish acceptance; Stop must target
its run and finish once; native Undo must not consume another editor's history.
The implementation separates provider entry from admission, uses explicit
acceptance/nonempty answer evidence, filters Stop by token and guards native
undo with document input events and content checks. Local Chromium confirmed
that unguarded native Undo can otherwise undo a different textarea. This review
was static and received supplied source; it did not access the checkout or run
tests independently.

## Verification and remaining limit

- Final local suite: **139 files, 1899 tests passed** on Node 22. The first
  sandboxed full run was stopped after loopback listeners failed with `EPERM`;
  the full suite passed with permission for synthetic local HTTP/WebSocket tests.
- `npm run lint`, `git diff --check`, all four production ZIPs and
  `npm run docs:check` passed. Documentation now checks 59 files with four
  unchanged historical-link advisories; `docs:test` passed all 28 fixtures after
  adding the adaptation skill/reference entrypoints to policy.
- The actual serialized MAIN function was extracted from each production
  background bundle and executed with synthetic native modules. All eight
  cases passed: finalization rejection called native fetch zero times and
  preserved unsent proof; attempted native fetch called it once and remained
  uncertain. This is bundle execution evidence, not Firefox or live-account acceptance.
- Controlled Chromium used real components, the wrapper and local-session
  owner with a synthetic provider. First-card retry kept one record and omitted
  its target from context; switched-session Clear retained identity and advanced
  the generation. Provider rejection preserved the input with zero writes.
- Native rich-input application retained paragraphs and Undo restored them.
  An input in another editor made Undo refuse without changing either draft.
  Two plain-input rewrite/apply/prepare cycles succeeded without reopening.
  Template instruction edits retained consent and the frozen page variables,
  excluding assistant UI. At 390px the assistant stayed within x=13..377 with
  document width 390. Screenshots were visually inspected.
- A final browser pass exposed a Stop loading placeholder and a missing panel
  recovery notification after Clear rejection. Owned placeholders now end with
  the request, and direct Clear failures use the panel's existing read-only/reopen
  recovery. Browser verification kept the old answer/draft, rejected the stale
  Clear, reopened the current binding, and made zero provider writes. Stop
  before output left zero loading nodes and restored Send.
- Older imported bare-key snapshots were also checked: matching generation
  reads remain available; import normalizes aliases before freshness merging,
  and save cannot let an older alias overwrite a new continuation. Both new
  regressions failed before correction and passed afterward.
- Starting a new Port run cannot reset an older run's cancellation. A regression
  first demonstrated the old run becoming eligible again, then verified that
  its delayed proxy request makes zero dispatch calls after the correction.
- Clear also retires the old UI request token once its binding commits. A queued
  terminal packet first reproduced restoration of the old binding/history after
  Clear, and is now ignored by the connected card regression.
- Completion-review regressions reproduced field sanitization, incomplete rich
  Undo verification, tokenless Stop on a token-bearing run, premature control-API
  acknowledgement, invalid-key downgrade, and cross-conversation snapshot IDs.
  The corrected paths and explicit-acceptance success cases pass. The synthetic
  HTTP gateway rejects invalid string/type keys with 400 and zero bridge writes;
  absent keys remain supported for standard clients.
- A final Chromium pass confirmed rejection of a multiline single-line-input
  replacement without modifying the draft, exact rich-markup restoration on
  native Undo, and safe refusal of an ambiguous paragraph-node selection. The
  real independent-panel consumer switched away from a running request with one
  token-bearing Stop and one provider Stop callback, without a save error.
- The subsequent uncommitted-change review reproduced two regressions: rich
  editors skipped cancellable `beforeinput`, and cached refresh failures could
  prevent a working proxy read before a follow-up. Four cases failed before
  correction. Rich edits now honor cancellation and synchronous host edits;
  forced reads use the existing proxy fallback for background network failures,
  while ordinary cached reads remain available and unverified parents still
  block sending. Six additional regressions pass. Controlled Chromium confirmed
  zero insertion on cancellation/host edits and successful paragraph-preserving
  insertion with exact native Undo on acceptance. The full suite, lint,
  documentation checks/fixtures and all four production bundles passed again
  before commit. No real-provider requests or installation updates were made.

Architecture now summarizes responsibilities and trust/lifecycle boundaries;
the Drafts guide is organized around five actions, setup, use, recovery and
preview. Current matching/resource details remain at their code/feature owners.
No external discipline was installed. Local validation files and bundle/source
hashes are under the ignored `output/playwright/review-fixes/` directory; they
are machine-local observations. The temporary browser and HTTP server are closed.

Two authorized collaboration requests were submitted: one design review and one
completion review. The completion MCP call timed out after 45 minutes. Two
successful read-only recovery requests inspected that exact acknowledged turn;
no replacement prompt was submitted. A fresh network snapshot supplied a
`finished_successfully`, final-channel static review, while the conversation's
pending flag remained true. Its text is usable review input; the MCP terminal
state is unconfirmed and is not recorded as a normal tool completion or a pass.

The recovered review's findings were reconciled as follows:

| Finding                                                              | Disposition                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Field sanitization and rich Undo markup                              | Fixed; preflight field compatibility, verify the actual write, and check original HTML after native Undo                                       |
| Tokenless Stop could affect a token-bearing run                      | Fixed; exact token matching, with the independent panel using the card's cancellation callback; tokenless legacy runs retain their own Stop    |
| Same-generation windows can overwrite each other                     | Existing storage limitation retained and made explicit; this assignment protects binding transitions, not concurrent transcript merging        |
| Plain session could acknowledge a control API write                  | Fixed in both create and follow-up; they share the UI admission predicate                                                                      |
| Invalid explicit idempotency key could become unkeyed                | Fixed at the HTTP and ledger boundaries; omitted keys retain standard-client compatibility                                                     |
| Failed Retry does not retain the old answer in the attempt's display | Accepted scope is durable-record retention, verified by the retry tests and reopening behavior; the guide and product wording state that limit |
| Cleanup could fail silently; imported IDs could cross conversations  | Fixed with visible retryable cleanup feedback and coherent continuation IDs                                                                    |
| Some paragraph-node ranges are rejected                              | Safely rejected without a write, confirmed in Chromium and documented with the Copy recovery route                                             |

The 10-second override reaches the native-page AbortController in
`conversation-api.mjs`; it bounds a page fetch, not all preceding configuration
or authentication work. The peer did not independently execute this chain.
Its supplied source snapshot also predates the final loading-placeholder,
Clear-recovery/queued-message, legacy-alias, cancellation and review-follow-through
corrections. Those deltas have local regression/browser evidence; there was no
second independent review of their final bytes. This closes the bounded source,
documentation and local-build assignment without claiming live acceptance,
whole-repository independent review, or a final no-findings endorsement.

Installed extension files/reload, gateway processes/bridge, installed Drafts
copies, live-account rich-editor compatibility, native Drafts/device sync and
native Firefox remain unverified or unchanged by this assignment. Source/build
completion does not update those running copies or publish a release.
