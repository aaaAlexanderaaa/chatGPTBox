---
doc_type: evidence
status: current
authority: evidence
last_reconciled: 2026-11-24
---

# ChatGPT merged-answer continuation and new model catalog

## Request and observed defect

The user requested compatibility with the current ChatGPT page and new models,
repair of `The native ChatGPT conversation changed. Inspect it before appending.`,
and preservation of the existing default model selection.

A fresh, non-pending network snapshot of the reported conversation contained a
complete GenUI answer whose visible `currentNode` matched its `messageId`, while
its `continuationMessageId` was different. No prompt was submitted to that
conversation during the investigation. Account-associated IDs and raw snapshots
remain outside the repository.

The stream client already retained the native continuation as the next parent.
The common adapter compared it only with the visible node, producing a false
`BINDING_CHANGED`. History imports and the retained direct follow-up transport
also chose the visible node as the parent.

## Repair and model facts

The shared conversation-state helper selects the native continuation only from
the complete final answer at the current visible node. The adapter accepts a
stored visible-node identity or that exact freshly verified continuation, then
sends with the continuation. Older anchored answers, pending/incomplete answers,
and unrelated heads cannot establish that equivalence. Existing freshness,
binding revision, Project and at-most-once protections remain in force. The
[engine contract](../engine-contract.md#身份绑定与持久状态) and
[gateway follow-up guide](../api-server.md#post-chatgptconversationsidmessages)
describe the boundary.

The logged-in account catalog advertised Chat `gpt-6-2`,
`gpt-6-2-instant`, and `gpt-6-2-thinking`, plus Work
`gpt-6.2-astra-wm`, `gpt-6.2-sol-wm`, `gpt-6.1-sol-wm`,
`gpt-6.1-terra-wm`, `gpt-6-sol-wm`, and `gpt-6-luna-wm`.
The static display catalog now includes these and the observed GPT-6 Instant
and Mini variants. Availability still comes from the account; a static label
does not promise access. The existing `gpt-6-thinking` default and configured
`xhigh` effort were not changed, and the installed settings page showed that
default before reloading.

Read-only calls through the website's native `Request.safeGet` confirmed that
Chat `gpt-6-2-thinking` advertises `min / standard / extended / max`.
The Work `/tpp/models/` rows for GPT-6.2 Astra and Sol advertise
`min / standard / extended / xhigh / max`; their embedded Chat catalog rows
advertise only four efforts. Existing effort rules preserve this distinction.
The page's public startup manifest named
`https://chatgpt.com/cdn/assets/633146.192293cdfd.js`; its native request owner
remained `Kwur`. No credential or integrity token was copied into source or
printed by the diagnostic calls. No new runtime mapping was added.

## Verification and installation

- Before the fix, synthetic adapter and retained follow-up cases reproduced
  four failures, including the user's exact error. After the fix, all 128
  focused tests passed. Negative cases cover actual head changes, an older
  answer, pending state, and an incomplete answer.
- The reported conversation's real read-only snapshot selected its native
  continuation with the repaired helper. This establishes the observed identity
  relationship without appending invented text to the user's conversation.
- Full Vitest: 160 files, 2,313 tests passed. The first sandboxed run could not
  use local HTTP/WebSocket sockets and was stopped; the complete run passed
  with local network access. Lint and the documentation checker passed.
- `npm run build:extension` produced Chromium/Firefox normal and reduced
  archives and replaced the existing unpacked installation. The browser's
  details page confirmed the loaded directory. Installed manifest, background,
  content-script and options files matched the build by byte/hash comparison.
- Brave displayed `Reloaded`; the dedicated ChatGPT proxy page was refreshed.
  The reopened bridge page displayed `Connected` over WebSocket on the existing
  port. The gateway process and authentication configuration were unchanged.
- Live verification submitted exactly two natural prompts in one new
  conversation: an algorithm comparison followed by a worked coin-change
  counterexample. Both completed as `accepted / completed` using requested
  `gpt-6-2-thinking`; the follow-up omitted a model and inherited the first
  turn's selection. Fresh server detail reported the same default model and
  exactly two user messages, each with its expected ID and text once. No third
  generation or original-conversation append was sent.
- The first run completed in 53.7 seconds, with an official reported thought
  duration of 16 seconds; the follow-up took 43.3 seconds, with 8 seconds of
  reported thought. These are run elapsed times, not estimates of thinking.
  Both answers had a verified final state and complete text tails. The public
  run record's model is the requested model, and normalized detail reports the
  conversation default; per-message response model metadata was not exposed
  by these observations.
- The answers used the existing native Markdown fallback for unsupported
  `svg` and `math` components. The installed history preview showed all four
  user/assistant messages and their per-turn thought times. This does not
  establish native SVG fidelity or full rendered-chart acceptance.
- The new verification conversation's completed answers did not carry distinct
  continuation aliases. Live follow-up therefore verifies the installed normal
  append path; the distinct-ID defect is covered by the reported conversation's
  real read-only snapshot and synthetic before/after regressions, not by a
  claim that a new answer reproduced that metadata shape.
- After reload and verification, settings still showed default
  `chatgptweb/gpt-6-thinking` and effort `xhigh`. GPT-6.2 Chat and Work entries
  appeared in the account model list; their enabled checkboxes were left as
  configured. Credentials, external grants and unknown older runs were not
  modified or released.

The Drafts request/response contract did not change, so Actions 2/3 and the
installed Drafts copies require no replacement for this repair. No native iOS
Drafts execution has been observed in this task. Controlled fixtures and one
account's observations do not guarantee all future website builds or accounts.

## Remote integration and packaging-test budget

The user subsequently requested merging and pushing the remote changes, and
asked whether the packaging timeout was a test or project defect. The remote
commits `14de130` (offline SVG/Mermaid) and `bcf2673` (escaped math delimiters)
do not overlap the ChatGPT transport changes. Their only overlapping document
change was a reconciliation date; both bodies were retained with November 24.

An isolated combined-tree review passed 2,334 tests and timed out one production
preview packaging check at its fixed 30-second limit. Running that check alone
reproduced the timeout. Independent `sync-drafts-preview.mjs --check` succeeded,
including byte-for-byte template/package freshness. With only that test's
budget raised to 120 seconds, the unchanged production bundler and assertions
passed in 31.87 seconds (32.90 seconds including the test command). This
establishes an insufficient test deadline for the observed build, not a failed
packaging operation. It also reflects a real build-cost increase: the committed
offline template grew from about 933 KiB to 6.1 MiB after embedding Mermaid.
These timings and sizes do not establish a rendering latency or memory budget
for Drafts devices.

The repair gives this full production-rebuild integration check its own
120-second bound. Ordinary test deadlines and template freshness, offline
isolation, CSP and content assertions remain unchanged.

The integrated checkout passed all 161 test files / 2,335 tests in 40.44 seconds,
plus lint and the documentation checker (zero errors, six existing historical
link advisories). `npm run build` succeeded and produced all four normal/reduced
Chromium and Firefox archives. The production bundler and generated preview
assets required no functional change. These integration checks did not repeat
account sends or replace installed extension/Drafts copies; the earlier live
observations above remain evidence only for their stated artifact and scope.
