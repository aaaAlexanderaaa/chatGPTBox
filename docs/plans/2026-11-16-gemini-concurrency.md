---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-16
---

# Gemini: three independent concurrent writes

The user clarified that three concurrent Gemini requests were authorized, then
asked to implement that behavior after the Drafts write-lock investigation.
The earlier settings-button repair releases an engine lease correctly, but the
adapter still advertises one write and stores one global native hold. The existing
three-tab retention bound does not implement three concurrent executions.

The [Gemini contract](../gemini-web.md) owns account and native-operation behavior;
the [common engine contract](../engine-contract.md) owns durable admission and
execution identity. This change covers extension, API, MCP and Drafts consumers
of those owners. It does not change model selection, grant additional external
operations, replay uncertain prompts or claim Google guarantees concurrent use.

## Intended result

- At most three active or unresolved independent writes share one Gemini account.
  An unresolved run consumes one slot; a fourth write is refused before native
  preparation and is never queued. Same-conversation appends remain exclusive,
  including aliases imported through native history.
- The common store reserves per-run engine capacity atomically. Existing root
  engine leases count as one protected slot without changing their identities.
- The native owner maintains per-request holds and per-document writer ownership.
  Short serialized state transactions merge journal, tab and readonly-tab changes;
  native generation and waits run independently.
- Native v1 state migrates without losing its old hold. A v2 rollback fence makes
  old native code refuse the new state instead of ignoring multiple holds.
  Storage failure prevents further admission and never proves a write was unsent.
- Completion, cancellation, exact recovery and unsent proof act on their own
  request only. A readonly history channel can operate beside independent writers.
  Native account notices/challenges block new account writes across all slots.
- Manual review excludes live writes, blocks racing admissions, and reconciles
  only its captured set of old protections. It records permission for new work
  while retaining unknown outcomes and retiring uncertain continuation bindings.
- Finished writer retention must not silently consume the three execution slots.
  Reclamation must preserve active writers, unresolved holds, foreground pages,
  drafts and changed native heads; an unsafe candidate remains untouched.

## Execution and migration

1. Review admission, state migration and recovery design through the authorized
   ChatGPT collaboration; retain its actual findings and their limits here.
2. Reconcile owners, implement the common store/runtime and native owner together,
   and add regressions at both owners and their public settings/bridge boundary.
3. Verify three overlapping runs, capacity refusal, one unknown plus two usable
   slots, alias conflicts, mixed completion/Stop, concurrent state writes,
   restart/migration, history isolation, review races and account-wide notices.
4. Run affected tests, lint/docs checks and production packaging. Inspect final
   serialized MAIN functions. Update the installed Brave extension and Reload,
   preserving the gateway's port, credentials, installation identity and ledger.
5. Evaluate the final change with fresh review inputs and observe the installed
   descriptor, bridge and preserved protections. Real-account generation, native
   Drafts and cross-device behavior are separate observations, never inferred
   from fixtures or packaging.

Account-bound review is bounded to two ChatGPT review calls for this change.
No previous Gemini prompt may be resubmitted. Any real Gemini trial needs a stated
budget and stops on a challenge, quota notice, identity mismatch or uncertain
write; after uncertainty, observe only that original request.

Rollback disables Gemini while retaining protection. Running the previous native
owner over a multi-hold journal must fail closed. No rollback deletes an old run,
recomputes its request hash or resets an uncertain request to unsent.

## Progress and evidence

- Baseline: the preceding settings correction is already installed and reloaded;
  its current native hold and common Gemini lease were released by explicit
  website review. The original run remains unknown. That is not evidence of
  concurrent generation.
- One ChatGPT design review received the actual architecture and proposed
  migration. Its first findings identified pre-submit native-conversation
  exclusion, union accounting across journals, complete read/modify/write
  serialization, orphan-document protection, review/admission fencing and old
  reader isolation. These are covered by the implementation and regressions.
  The reviewer had supplied code facts, not direct repository or browser access.
  Its severity labels are review judgments, not evidence of a live exploit.
- Local decisions retain the existing contract: explicit manual review may
  release inspected uncertainty without changing its unknown outcome; separate
  intentionally identical new questions are allowed. Stable run IDs and existing
  request fingerprints prevent replay of the same operation. A global prompt-hash
  deduplicator would incorrectly reject legitimate new work and is not adopted.
  A sole background writer and local admission/review guards prevent concurrent
  journal writers; MV3 termination leaves native holds protected rather than
  allowing an old worker to resume a JS storage callback in a second writer.
- Implementation covers capacity, native v2 holds, independent reads,
  account pauses and review fencing. Three initial regression failures
  demonstrated the missing capacity/parallel behavior against the old source.
  The first broad test attempt hit `listen EPERM` in the sandbox; later full
  runs permitted temporary local ports. The final seven-file focused run passed
  140 tests. The final full suite passed 2,215 of 2,217 tests; the two failures
  are existing Drafts layout assertions, whose tests and generated scripts
  remain identical to baseline `HEAD`. Changed JavaScript lint passed.
- The second ChatGPT evaluation examined supplied completion code excerpts and test
  results. Its initial judgment withheld sign-off: it could not see the existing
  startup reconciliation, found the pause/last-Send race, and identified a null
  response-identity gap in automatic writer retirement.
- Existing common-store startup reconciliation already settles orphaned possible
  writes as unknown. A new three-orphan regression proves they remain occupied,
  become reviewable and are released only after native review, without replay.
  The pause race is repaired with a synchronous observed-notice fence and a short
  submission/publication gate ending at browser dispatch. A controlled test
  pauses B in tab lookup while A reports a notice, proving B never dispatches.
  Another proves a slow dispatched document does not hold the gate; Stop racing
  a notice still persists the account pause. Retirement now requires a nonempty
  response identity. A matching test preserves completed tabs without one.
- A final owner inspection also corrected recovery's writer metadata: exact
  completion can make only its own unreserved writer eligible for fresh-checked
  retirement. The regression recovers A beside live B/C and admits D without
  disturbing B/C. These corrections have controlled tests; no third independent
  review of the corrected bytes was performed within the two-call budget.
  Final packaging and installation include these corrections.
- Final `npm run build:extension` produced the four production archives and
  updated the Chromium installation used by Brave. Its background bundle is
  byte-identical to `build/chromium/background.js`. Both serialized Gemini MAIN
  functions were extracted with Acorn, deserialized without rewriting their
  text, and checked for standalone free-variable errors. The native fixture
  corpus passed 33 tests against those exact installed functions; the temporary
  test copy was removed. An evaluated copy of the actual old owner from baseline
  `HEAD` refused synthetic v2 state before any website access.
- Brave's actual extension detail page showed the expected installed directory
  and a successful Reload. The existing bridge reconnected on port 18081 with
  unchanged credentials and healthy status. The running `/engines` descriptor
  reports Gemini `maxConcurrent: 3` and no unresolved runs. The new settings copy
  is visible and its readonly check reports 4 Hydrogen / Medium ready. Settings
  review saved native v2 with its boolean rollback fence, zero holds and no
  account pause. The common journal has no active executions. The original
  Drafts run retains its unknown outcome and previously recorded reviewed
  disposition; it was not replayed or relabelled successful.
- Before Reload, the old extension-owned writer was visibly complete with an
  empty composer and no Stop control, with no unresolved protection. That one
  browser tab was closed to leave room for new writers; its remote conversation
  remains in Gemini history. Other manual pages were preserved.
- No new Gemini questions were submitted. Three-way generation, mixed recovery,
  account pauses and migration are controlled regressions, not three simultaneous
  live provider results. Native Drafts, device/iCloud and concurrent manual use
  on other devices remain unverified. This bounded source/package/installed
  delivery is complete; those observations are not acceptance claims.
- The two baseline failures are distinct: a Drafts Gemini test appends personal
  text after trailing metadata and conflicts with the readable-layout guard;
  another recovery test expects an edited prompt in an older layout. Neither
  their tests nor shared Drafts scripts were changed for this task.
