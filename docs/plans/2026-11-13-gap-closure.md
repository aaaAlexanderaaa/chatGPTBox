---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-14
---

# Installed delivery and workflow acceptance

## Outcome and authority

On November 13 the user requested handling the five gaps in the project status
assessment, with multiple-choice questions for product decisions. The resulting
bounded delivery is complete for the scope retained in the November 14 choices:
Gemini history/recovery/continuation, Gemini Drafts actions, installed runtime
alignment, and shared YouTube material. The user explicitly deferred ChatGPT
rewrite/video AI acceptance after the live request-body rejection described below.
This record does not claim completion of those deferred workflows or a release.

Baseline: clean `c244314`, version 4.3.4. The baseline production archive and
Brave installation differed despite the same version. Necessary implementation,
local installation/reload, process updates and bounded real-account verification
were authorized; no commit, push or release was requested for this task.

Owners: [engine contract](../engine-contract.md), [product behavior](../product/contracts.md),
[browser assistant](../product/browser-assistant.md), [architecture](../../ARCHITECTURE.md),
[API](../api-server.md), [MCP](../mcp-server.md), [Drafts](../drafts/README.md),
[Gemini](../gemini-web.md), [native-input acceptance](2026-10-30-chatgpt-native-input.md)
and [DSH target](../product/2026-08-18-dsh-full-client-design.md).

## User decisions and acceptance boundary

- Gemini history means the native conversation list and conversation detail,
  with continuation after refresh/reopening. It does not import the entire
  account into Box's local conversation list.
- Four Gemini Drafts actions deliver independent questions, continuation,
  list/detail and older pages. The user deferred native Drafts import,
  device/iCloud acceptance and DSH page parity for this round.
- Existing gateway clients retain persistent Gemini generation, append, list and
  read grants. Grok engine/external access remain off and its live trial is
  deferred. No new Grok account request was made.
- After two Argon / High continuations had no attributable response, the user
  selected 4 Hydrogen / Medium and asked about time fields. The model change
  applies to new Gemini work; old runs retain their actual model and outcome.
  It did not change the global default from ChatGPT to Gemini.
- The user clarified that ChatGPT account switching was not their requirement.
  It came from an older acceptance checklist and was excluded from this round.
  No automatic account switch was attempted.
- After the ChatGPT rewrite trial returned `400 Invalid conversation body`, the
  user selected B: deliver Gemini/Drafts now and retain ChatGPT rewrite and video
  AI acceptance as pending. Its unknown run is preserved without a resend.

## Implementation and corrections

Gemini now reads verified native conversation lists and paginated details in a
separate readonly tab. A reopened writer must match its original account,
conversation, completed server head and response. Known website compilations are
pinned by their observed service fields and eight public function fingerprints;
unknown mappings refuse submission. Native submission still invokes the site's
handler once, retaining its request construction, attestation and transport.

Produced-output proof associates the immutable common run and native request
with a newly accepted server turn. The parent head is only an input. Recovery
checks this proof before a native history read; old records or a crash before
proof persistence remain unknown. A native success event with an idle page but
no attributable response now allows two seconds for state delivery, then ends
observation as unconfirmed with the hold retained. It never uses the parent
answer or silently waits the entire generation deadline.

The common MCP waiter no longer attempts recovery of a still-active writer when
its recovery interval expires. Readonly busy/errors preserve the registered
submission state and original run ID. Active recovery returns the existing run
without retiring its binding or releasing its lease. Controlled HTTP/SSE and
common-runtime regressions exercise these boundaries.

The generated Gemini Drafts actions are List Conversations, Get, Send and Load
Older Turns. Complete request/key persistence precedes HTTP. Lost acknowledgements
use the generic readonly `/operations/:key` lookup, then the original run; Send
while pending only observes it. Generated history and pending regions have edit
checks. Get preserves Waiting Reply and notes outside the history, and a conflict
keeps the entire note. Version-3 Gemini controls remain separate from the existing
five version-2 ChatGPT actions. Packages contain credential placeholders.

YouTube summary and reusable page functions share frozen subtitle material:
visible loaded native transcripts, or one already-observed current-video subtitle
GET, bounded to 2 MiB / 20 seconds. Both old transcript elements and the observed
`transcript-segment-view-model` variant are supported. Source labels and timestamps
count toward the 30,000-character limit. Failure does not substitute page menus
or start AI. Saved functions retain the method, never captured subtitles.
Verified subtitle annotations can seek video time; real AI annotation/seek
acceptance remains deferred.

The logged-in ChatGPT editor changed to a marked ProseMirror composer. The exact
observed form/composer ancestry was added to the shared editor and draft-entry
adapters; unrelated, ambiguous and proxy editors remain excluded. Current native
network mapping was also added for the inspected `633146.6428a93122.js` runtime,
retaining identity, cancellation and `retry: never`. Transport readiness is not
proof that the current conversation request body is accepted.

## Real Gemini and Drafts evidence

The live sequence was bounded and sequential. All account identifiers, raw
responses, run IDs, guards and test notes remain outside Git.

1. One common MCP independent Argon / High generation completed, producing
   1,003 characters of safe HTML. API, MCP and the native response agreed. After
   a real native document reload, extension reload and API/MCP restart, exact
   recovery of the original run returned the same content/hash without replay.
2. The first Drafts-script continuation registered once through the real gateway;
   its 202 receipt was deliberately withheld. Get recovered its original key and
   retained future draft text and outside notes. Gemini emitted success while
   idle but exposed no attributable new response. Observation was stopped; its
   outcome remains unknown, not successful continuation.
3. The user approved one different continuation after the waiting-boundary fix.
   Its lost receipt was recovered likewise. The new boundary settled this run as
   unknown/possibly submitted rather than accepting the parent answer. No replay
   occurred. Both old runs were reviewed only to permit new work; neither was
   reclassified as a known successful or unsent request.
4. Following the user's model selection, a genuine native UI Send with 4 Hydrogen
   and `THINKING_LEVEL_MEDIUM` completed in the same test conversation. Matching
   native request/response, final state and COMPLETE draft were observed. The
   request-to-success frontend-event interval was 11.721 seconds; this is client
   observation, not official thinking time. The passive listener was removed.
5. A new Hydrogen Drafts continuation succeeded through the common API. A first
   pre-registration attempt was positively refused by the old common lease;
   it spent no native submission and was kept as an unsent record. After the
   reviewed hold was released, one separate guarded attempt registered, its
   receipt was withheld, and Get recovered the original operation without Send.
   The final result was accepted/completed, in the same native conversation with
   a new server turn, 264 characters, model `gemini-4-hydrogen-medium`.
   MCP `get_engine_run`, API and fresh native history returned identical content
   (SHA-256 `eb7d1e26f7faf9b015767bba65f9a9028e45ced783f2c8b9e48b2245d22f6e02`).
   Local run lifecycle elapsed time was 29.949 seconds, not thinking duration.
6. Generated Get collected that final result and cleared its pending state.
   Load Older read the real native pages to six messages with no remaining older
   cursor, retaining future Waiting Reply and outside notes. The scripts ran in
   a VM against the real authenticated gateway; this does not establish native
   Drafts import or device behavior. Independent-question script control was
   tested locally; the real independent generation above used common MCP.

Gemini's converted response has a native Date timestamp, propagated as
`responseTimestamp` in final metadata and assistant history. In the Hydrogen
continuation the live timestamp and fresh history timestamp differed by about
3.6 seconds despite matching turn identity and content. Preserve each source's
instant; its precise lifecycle meaning and an official thinking-duration field
were not established. `thoughtDurationSec` remained null. Timestamps never
replace request/turn identity.

## Page evidence and deferred acceptance

Installed Brave performed genuine Cmd+V on the logged-in rich composer: local
review opened while the native editor stayed empty, confirmed masked text was
inserted, and native Cmd+Z restored the empty draft. The rewrite entry was enabled
only for nonempty supported input. A later genuine rewrite opened its 62-character
preview and reached the configured ChatGPT engine, but the website returned
`400 Invalid conversation body`. The common run is settled/unknown,
possibly_submitted, with no native conversation reference. It was not retried.
Earlier video AI attempts had positively failed before formal submission; they
are not successful AI/video evidence. By the user's final choice, further
ChatGPT protocol repair, rewrite application/undo and video AI/annotation trials
are deferred. The ChatGPT unresolved-write protection remains in place.

Physical typing produced five trusted input events and zero composition events;
this does not verify OS IME. Real navigation away and browser Back returned an
empty editor with navigation type `back_forward`, but a new document, not a
BFCache hit. Native not-restored reasons included `response-cache-control-no-store`,
`response-cache-control-no-store-with-js-network-request` and
`websocket-used-with-ccns`. Website protections were not weakened. Passive
listeners and test session-storage markers were removed. These limits remain in
[the native-input plan](2026-10-30-chatgpt-native-input.md).

Real YouTube loaded native transcripts for two TED videos. The first, Grit,
produced 5,679 characters and retained the frozen material while its instructions
were edited. The saved function “字幕论点与证据” was reopened after reload. On
The power of introverts it retained the method and acquired that second video's
own timestamped material, 20,497 characters. The second-page check did not start
AI. Both videos were paused during inspection. Real truncation, final AI answer
and confirmed annotation seeking were not observed; truncation guards have
controlled-test evidence only.

## Reviews, verification and running delivery

Two separately declared fresh ChatGPT design/completion review requests were
used, with synthesized context and selected source, no repository execution or
credentials. Findings led to the produced-output proof, exact identity checks,
combined history-rendering budget and Drafts text-preservation corrections above.
One review-capsule sentence overstated reference rewriting: identical references
are deduplicated and a changed head receives a new reference; old references
are rejected by fresh head checks. No third review was made. Later corrections
have local checks and the live observations above, not independent re-approval.

- Final runtime source: `npm test` passed 154 files / 2,061 tests; lint passed.
  This is a fresh current-task result. Later edits only reconcile documentation.
- Production: normal/reduced Chromium and Firefox archives built. All four
  serialized Gemini MAIN functions matched source, compiled in isolation and
  had only standard browser/JavaScript free globals, at 20,450 bytes each.
  Serialized ChatGPT integrity/runtime-inspection closures were separately
  checked for bundler-helper capture. These are packaging checks, not site proof.
- Installation: Brave displayed Reloaded after the Hydrogen build. Six installed
  extension files were byte-equal to the Chromium build. The confirmed install
  path and version 4.3.4 were retained; version equality alone was not used.
- Processes: existing API/MCP arguments, environment, bindings, ports 18081/18082
  and all three credential files were preserved across their necessary restarts.
  The final bridge visibly reported Connected, healthy, websocket and pending 0.
- Cleanup: both temporarily enabled native ChatGPT switches are off again;
  running storage confirms false/false and zero native early registrations.
  The own unsent trial draft was cleared, its page reloaded, and the original
  settings chat preview restored. Original private drafts/history were not removed.
- Closure: `npm run docs:check` passed 65 documents, zero errors and four unchanged
  frozen-history link advisories; `git diff --check` passed. No checker code changed.

The initial CUA interruption from exhausted approval-service credits was resolved
after the user's refill/continue choice; it is not a current blocker or a supplier
challenge. Firefox execution, fresh-user observation, native Drafts/device/iCloud,
Grok and DSH parity remain unclaimed. The retained Gemini/Drafts delivery is
complete; those explicit deferrals do not become completed product acceptance.

## November 14 release authorization

After the retained delivery, the user requested “commit and push and build a
release.” This authorizes committing/pushing the current work and publishing
v4.3.5 through the existing tagged-release workflow. Package, lockfile and both
manifests are frozen together; bilingual changelogs retain the actual Gemini
evidence and explicitly deferred ChatGPT/Drafts/device/Firefox/Grok/DSH limits.
This new release instruction supersedes the earlier no-release scope for this
publication only. It does not imply a new provider trial or another installed
Brave update. Publication status is reported from the actual workflow and release.
