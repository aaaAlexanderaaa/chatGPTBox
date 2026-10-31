---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-10-29
---

# Development and collaboration

## Start from the requested outcome

Read the request, applicable product owner, relevant architecture boundary,
current implementation, and useful evidence. Investigate facts the repository
can answer before asking the user. A summary or old plan helps locate a source;
it does not replace that source.

The user owns direction, priorities, and accepted risks. An explicit instruction
authorizes delivering its agreed outcome through implementation, integration,
verification, and corrections. Make reversible engineering choices within that
scope without repeated permission requests. Ask only when new evidence requires
a material product choice, missing authority, or an irreversible action not
already authorized. Pause that path and continue unaffected work.

Keep instructions and accepted proposals distinct from implementation choices.
Record significant assumptions where they affect the behavior or verification.
Do not present an inferred requirement as the user's words.

Compare each next step and the final result with the original request and later
corrections. An example, initial batch, or finished subtask does not narrow that
request. When the user has said to continue until a named end, continue through
that end; describing the remaining work does not do it. Their later stop or
changed outcome replaces it. Completion of a bounded assignment authorizes no
new portfolio work.

Keep facts, risks, recommendations, required human decisions, and execution
blockers distinct. A risk names the affected person or system, its mechanism,
rough impact or uncertainty, and when it would not matter. A blocker names the
exact affected path, governing requirement, evidence, and recovery options;
a preferred approach alone cannot block authorized work.

When genuine human decisions depend on one another, ask only those whose
prerequisites are settled, with context, real options, trade-offs, and a
recommendation where useful. Recompute after the answer. Repository facts and
reversible engineering choices stay on their investigation/execution routes.

## Investigate the decisive uncertainty

For an unfamiliar checkable claim, inspect available sources and then primary
external material when needed. Read what supports the decisive assertion;
search snippets, generated summaries, and repeated accounts are leads.
Distinguish observations, interpretations, and recommendations, including shared
origins that prevent several sources from being independent corroboration.
The [documentation rule](documentation.md#read-rules-before-judging-their-fit)
governs learning from an external discipline.

Choose observations that can distinguish plausible explanations or expose an
important omission. Explain the mechanism on the actual input, the conditions
where it holds, and what would change the conclusion. For consequential or
disputed conclusions, recurring corrections, or a credible shared blind spot,
run a bounded comparison using a useful difference in evidence, question,
standpoint, or available model within the current permission and resource
envelope. Keep the original goal and constraints common, preserve first results,
and state shared dependencies. Different role names or models alone establish
neither independent review nor independent evidence. Ordinary lookups stay direct.

For a substantive recommendation, compare the strongest feasible alternative
under the current purpose and constraints; state expected value, cost, switching
conditions, and important unexamined directions. A direct correction needs no
manufactured alternative. A requested critical or Grill review may question
the direction as well as the artifact against the owner's supported goals and
standards. Findings need evidence, consequences, and limits; a repair plan is
optional and a supported no-findings result is valid. Review alone authorizes
no implementation.

When access fails, identify the property needed and try a permitted alternative
that preserves capability, safety, and evidence strength. A successful text
extraction cannot establish rendering or interaction. Partial access and evidence
of absence are different; inspect omitted or unmatched material before accepting
an empty result. Track costly attempts across tools within one task budget.
Stop on resolution, bounded diminishing returns, unavailable evidence, or the
budget, and state the remaining gap. Changing tools does not reset the budget.

## Retain experience where matching work begins

Before repeating an investigation, look for applicable methods in the existing
owner or skill; the [ChatGPT Web adaptation skill](../../.agents/skills/chatgpt-web-adapt/SKILL.md)
is one project example. Retain successful methods as well as failures, with
their observed result, explanation or hypothesis, applicable conditions, and
reason to revalidate. A past failure is not a permanent prohibition.

Correct the smallest responsible default, interface, example, or retrieval
route. Feedback can call for a better question, source, or usable example as
well as a guard; another prohibition alone may leave the missing capability
unfixed. Preserve the scope of the feedback and inspect a plausible sibling
case and, where overgeneralization matters, a case where the lesson should not
apply. Put a locator at the next matching entrypoint, retire redundant advice,
and keep current task state separate from historical evidence.

Distinguish saving a lesson, incorporating it, and observing later use. Claim
reuse only after matching work finds and applies it through its normal entry;
a restart-survival claim needs fresh context. Report unobserved reuse honestly
and do not start an unrelated task to manufacture that evidence.

## Reconcile before dependent implementation

For changed behavior, update its existing product or interface owner with the
trigger, visible result, failure behavior, boundaries, and acceptance evidence.
Preserve the original request or decision source. Unchanged behavior can rely on
its existing contract. A small fix needs neither a standalone plan nor a new
contract file.

For a material migration, name one coherent end state, affected consumers,
compatibility, recovery, and removal of transitional paths. A plan sequences the
work without overriding its contract. Unknown technical facts call for bounded
investigation; an experiment is evidence until an authorized design adopts it.

For a defect, name its mechanism and add a proportionate guard for a plausible
sibling where useful. Use the [experience route](#retain-experience-where-matching-work-begins)
for reusable corrections; no guard requirement authorizes unrelated cleanup.

## Apply the concerns the change actually touches

Read each applicable owner section in full, including its declared dependencies,
scope, and exceptions, before dependent choices. A summary or a familiar title
cannot waive the detail. Recover truncated text in bounded parts and confirm the
complete section was obtained. Use the existing product, interface, or design
owner; this table requires no new file when that owner already serves the work.
For each matching concern, name its scenario, observable boundary, failure and
recovery policy, evidence, and escalation or exception authority there.

| Affected boundary | Required consideration and existing owner |
| --- | --- |
| Graphical or non-graphical interaction | Applicable product/design or interface contract; actual user task, reachable loading/empty/failure/disabled/recovery states, accessibility, input, locale, and interruption behavior |
| Public interface, provider, or external protocol | Actual request/response/event/error meaning, identity, authentication, capability, streaming, stop, timeout, ambiguous writes, affected consumers, compatibility and removal; [product contracts](../product/contracts.md), provider code, and interface owner |
| Local gateway or MCP | [API server](../api-server.md), [MCP interface](../mcp-server.md); caller authorization, request identity, concurrency, acknowledgement, actionable errors, and recovery semantics |
| Stored state, cache, or migration | Existing storage owner and [cache lifecycle](../cache-lifecycle.md); atomicity, ordering, restart, stale data, partial writes, duplicate/replay, retention, schema evolution, and explicit migration/recovery scope |
| Both sides of a message | [Architecture](../../ARCHITECTURE.md#dependency-and-state-boundaries) and shared message definitions; update producer and consumer together and observe the visible result |
| Permissions, identity, sensitive or untrusted input | Existing account/interface and [architecture](../../ARCHITECTURE.md) boundaries; least privilege, abuse/failure cases, data flow, audit and retention. Never use a real account to probe a write path without authorization |
| Hot path, scale, capacity, or resource cost | Affected runtime/interface owner; actual load, response and resource bounds, saturation, backpressure, and exhaustion behavior. Calibrate guards to the operation and environments they protect |
| Availability, timeout, retry, recovery, or operator workflow | Affected service/interface owner; dependency failure, diagnostics, observable objective, intervention and rollback triggers. Use an error budget or alert threshold when that operation promises one |
| Build, dependency, or release | [Contributing](../../CONTRIBUTING.md), lockfile, build entrypoints and workflows; search existing solutions before building, assess provenance and whole-life cost, reproducibility, missing-dependency behavior, artifact location/name/contents, and compatibility |
| Time or clock | Affected runtime/interface owner; scoped instant/calendar/duration meaning, representations, input interpretation, injectable clock, and missing-policy behavior |
| Visible demonstration or sample data | Affected product/interface owner; declared time reference and labels, freshness when promised, repeat safety, retention, environment isolation, and recovery |
| Dataset analysis, metrics, ranking, or benchmarks | Owning analysis/report and its sources; question, coverage, method, parameters, record traceability, denominators, uncertainty, and intended reader decision |
| Assumption testable only after release | Affected product/interface owner; signal, observation window, decision threshold, and person or process responsible for rollback or reconciliation |
| Documentation | [Documentation discipline](documentation.md); current owner, lifecycle, provenance, links, and honest evidence |

This table routes work; it does not order unrelated refactors, a new time-policy
system, an analytics framework, or a universal checklist for every edit.

For frontend work, the existing surface owner records the subject, audience,
user tasks, accepted visual direction, states, geometry, and interaction.
Include environment changes such as sleep, reload, network or permission loss
when the surface must survive them. Use consistent user-facing action names
and explain the available next action in empty and failure states.

When changing shared style, declare the affected corpus and its precedence,
with each style file belonging to one layer. Name what scoping contains and
what can leak. Shared values have one owner; raw values, semantic roles, and
unit names reference only lower tiers. Declare governed recurring values and
legal local literals; restating a governed value or fallback forks its owner.
Consumers use published roles, variants, and override interfaces; selector
reachability does not publish private internals. Resolve competing values at
their owner. Register a necessary escalation with an owner and removal condition
instead of relying on selector weight or load order accidentally. Name whether
responsive behavior measures the display or the containing surface. Removing a
unit removes its owned style; record what cannot be proven reachable. This does
not order a new CSS system during unrelated work.

For service or message changes, define valid state transitions and public errors,
including cause and correction for agent clients. Validate against the valid
input contract; invalid configuration or a missing dependency must not silently
downgrade capability. Payloads, counts, cursors, stored state, and replay describe
the same reality. A UI projects the authoritative state and mutation permission
instead of reconstructing them from private implementation details.

Time consumers declare how storage, calendar calculation, input, and display
resolve their scope. Intentional differences are valid; an undeclared device
or host default cannot choose meaning. Preserve external timestamps' units and
interpret declared offsets as their instants; preserve original offset text only
when promised. Retain unknown or reject when no meaning is established.
Inject the clock through the actual consumer path and test applicable midnight,
duration, ambiguous-input, and absent-policy cases.

Visible samples declare whether they show the present, a fixed reference, or
history. A fixed example needs no daily refresh. A mutating refresh declares
identities, repeat/retention behavior, an explicit permitted environment,
atomic recovery, and production isolation; it cannot introduce a second set of
runtime rules. Disposable unit-test rows that never reach users are outside
this visible-sample concern.

For analytical deliverables, audit fetched, omitted, and unmatched records
before conclusions. Keep input identity, method, assumptions, parameter origins,
and supporting records checkable; reusable analyses supply a rerunnable function.
Show counts beside proportions and make important small populations legible.
Static reports can use source tables; interactive marks lead to their records,
controls change the computation they claim to control, and records stay
recognizable across views. Retain method versions for meaningful comparisons.
Measures inform fallible judgment: a zero may mean an unrun or blind detector.
Check raw cases, useful accepted cases, and unfamiliar material before calling
it improvement. Material or high-risk analysis needs independent evaluation of
claim support and presentation; a routine lookup uses focused evidence.
Use statistics where records answer the question instead of semantic guesses
over sparse data. Lead with useful conclusions, and add visual encoding or
depth only when it makes a relevant distinction easier to read.

## Choose execution depth by consequences

Routine work is authorized, bounded, inexpensive to recover, and credibly
verified at its existing owner. It needs no standalone plan. Material work
changes a published integration contract, durable-state semantics, a migration,
or separately owned commitments, or needs substantial recovery planning; use
the [plan requirements](documentation.md#plans-and-closure). Assess high risk
from actual effects and recovery cost: authorization/isolation changes or a
credible path to serious user, confidentiality, integrity, availability, or
financial harm require independent design review and fresh completion evaluation.
File count alone selects none of these routes.

For high-risk work, authorized independent reviewers inspect consistency,
user/operator experience, maintenance cost, and the activated specialist
boundaries before implementation. Completion evaluation also receives the
original request, accepted interpretation, and observed artifact. Retain the
review context, inputs, first findings, and limits. If required independence
is unavailable, report the affected work as incomplete until it is supplied
or the authorized human grants a permitted, scoped exception with residual
risk and a review/expiry condition. Same-context analysis cannot substitute.

A technical experiment may answer a fact unavailable to read-only inspection
inside existing authority and safety boundaries. Name its question, disposable
path, effort/expiry bound, abort and cleanup actions, and cleanup evidence.
It creates evidence; it cannot silently become production behavior or authorize
an external write.

For already authorized concurrent work, check the existing plan or handoff for
overlap, record scope, announce shared-owner changes, and reread before editing.
A delegated assignment carries the parent outcome, original intent relevant to
its judgment, authority, baseline, allowed effects, assumptions, method locators,
verification, and stop condition. Private context keeps its permitted audience.
Workers return artifacts, actual checks, uncertainty, and remaining work;
the parent checks stale baselines, reconciles conflicts, and verifies the
integrated outcome. A late result cannot silently overwrite newer work.

## Bound repeated work and account use

Before spending billed, rate-limited, or account-bound resources, declare the
expected volume and stop condition, then report actual use where observable.
Follow the affected interface's request, concurrency, recovery, and quota policy.
A limit response calls for stopping the affected activity and checking the
mechanism; blind retry is not recovery. Do not invent a safe request rate or
replace an ambiguous write with another model, key, or payload.

Reuse verification only while artifact identity, relevant dependencies,
method/criteria, and freshness remain valid. Changed inputs or a missed defect
invalidate affected evidence even if the file is unchanged. When a concrete
growth mechanism matters, distinguish more objects, accumulated executions,
and higher rate/concurrency; test the consequential axis and recovery.
Stable bounded repetition creates no scale exercise. Judge acceleration by
useful verified results and total waiting, rediscovery, rework, and recovery,
rather than calls or commits.

## Verify promises and effects

Choose evidence for the claim before choosing the easiest available test.
Compare the observed outcome with the original request and the accepted
contract. For each promised result, check its trigger and boundary; also inspect
actual requests, writes, notifications, and suppressed effects for behavior the
contract did not authorize. Include failure and recovery when they can affect
the outcome.

At the affected boundary, define the identity and scope of a logical operation,
allowed effects/counts, eligible triggers, timing/order, and relevant cadence,
freshness, or maximum silence. Inspect missing, undeclared, excessive, wrongly
suppressed, wrong-identity, stale, and partially completed effects as relevant.
An idempotency key alone establishes neither exactly-once execution nor an
acceptable operation frequency. A helper's return value cannot prove effects
at the service, storage, or user boundary.

Use unit tests for pure behavior and repeatable defect classes, integration
tests for connected boundaries, built artifacts for packaging claims, and real
browser interaction for user-facing claims. A deterministic transport can verify
UI behavior without proving live authentication or model quality. Do not infer
real-account safety from a mock alone.

For layout work, inspect the rendered surface and measure relevant geometry,
including repeated instances on both axes and intermediate container widths.
Exercise focus, scrolling, hit targets, input, theme, locale, and recovery where
applicable. A screenshot, DOM existence, and a production bundle prove different
properties. Verify a reported failure in its actual environment before claiming
the fix there; otherwise state the reproduction and remaining gap.

For material or high-risk delivery of a user/operator workflow or reusable
explanation, include an authorized fresh-context consumer with the inputs a real
consumer receives. Investigate failed trials at the artifact, supplied inputs,
and environment before assigning cause. Routine corrections with credible
focused evidence need no separate consumer trial.

Name what ran, its conditions and result, and what remains unknown. A passing
syntax check is not a runtime test. A test count in an old record is not a new
verification. Separate implementation, local verification, live acceptance, and
release completion. Never call same-context self-review independent.

Run the relevant checks from [Contributing](../../CONTRIBUTING.md). Broaden them
when the affected risk warrants it; a documentation-only change does not require
credentials, a production build, or browser-account traffic. Preserve unrelated
working changes.

## Close and communicate

Complete the authorized outcome, reconcile its owners and guides, and finish
applicable plan states under [documentation closure](documentation.md#plans-and-closure).
Explain what changed, why it matters, how it was verified, and material limits
in plain language. Mention exact settings labels when they matter. A written
next step does not complete work already authorized in this assignment.

This contract applies to bounded project work. It does not authorize scheduled
portfolio work, new chats, delegation, release publication, or messaging others.
Those actions need the applicable user authorization.

When checks pass but value disappoints, or corrections recur, inspect the
question, candidate choices, evidence, and selection standard before adding
effort or another rule. Distinguish a problem never observed from one observed
but dismissed. When replacing a workflow or artifact, compare useful capabilities,
lost distinctions, accepted trade-offs, and actual effects before and after.
Keep that reasoning at the existing owner; this is no recurring reflection form.

The [2026-10-29 comparison](../evidence/2026-10-29-discipline-refresh.md) records
the source rules, local gaps, retained boundaries, and verification limits.
