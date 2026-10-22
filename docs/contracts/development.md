---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-10-23
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

When correcting a recurring defect, identify the mechanism and protect a
plausible sibling case with a proportionate guard. Fix the responsible default,
interface, example, or reading path before appending another startup reminder.
Retain the lesson at the point where matching work begins, with its limits.

## Apply the concerns the change actually touches

| Affected boundary | Required consideration and existing owner |
| --- | --- |
| User interface | Applicable product/design contract; loading, empty, failure, disabled, and recovery states; keyboard/focus, narrow and intermediate layouts, theme, locale, and actual user task |
| Provider or external protocol | Actual outgoing requests, identity, authentication, capability, streaming, stop, timeout, and ambiguous writes; [product contracts](../product/contracts.md), provider code, and relevant interface document |
| Local gateway or MCP | [API server](../api-server.md), [MCP interface](../mcp-server.md); caller authorization, request identity, concurrency, acknowledgement, error and recovery semantics |
| Stored state, cache, or migration | Existing storage owner and [cache lifecycle](../cache-lifecycle.md); ownership, restart, stale data, partial writes, duplicate/replay, and explicit migration scope |
| Both sides of a message | [Architecture](../../ARCHITECTURE.md#dependency-and-state-boundaries) and shared message definitions; update producer and consumer together and observe the visible result |
| Account activity, permissions, sensitive input, or resource cost | Existing account and interface boundaries; unnecessary reads/writes, rate limits, explicit effects, and safe recovery. Never use a real account to probe a write path without authorization |
| Build, dependency, or release | [Contributing](../../CONTRIBUTING.md), lockfile, build entrypoints and workflows; actual artifact identity and compatibility |
| Time, clock, or demonstration data | Preserve the source timestamp's unit and meaning; distinguish an instant, duration, and calendar date; control clocks in relevant tests. Declare semantics at the affected runtime owner before new behavior relies on them |
| Documentation | [Documentation discipline](documentation.md); current owner, lifecycle, provenance, links, and honest evidence |

This table routes work; it does not order unrelated refactors, a new time-policy
system, an analytics framework, or a universal checklist for every edit.
For an unfamiliar external claim, inspect available source material and then
primary external documentation if needed. If a tool fails, seek a permitted
alternative that observes the same property; otherwise retain the uncertainty.

## Verify promises and effects

Choose evidence for the claim before choosing the easiest available test.
Compare the observed outcome with the original request and the accepted
contract. For each promised result, check its trigger and boundary; also inspect
actual requests, writes, notifications, and suppressed effects for behavior the
contract did not authorize. Include failure and recovery when they can affect
the outcome.

Use unit tests for pure behavior and repeatable defect classes, integration
tests for connected boundaries, built artifacts for packaging claims, and real
browser interaction for user-facing claims. A deterministic transport can verify
UI behavior without proving live authentication or model quality. Do not infer
real-account safety from a mock alone.

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
