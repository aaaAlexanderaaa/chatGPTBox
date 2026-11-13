---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-13
---

# Unified engine runtime implementation

## Outcome and authority

The user requested implementation of the [unified engine design](../engine-contract.md):
converge ChatGPT/Grok/Gemini, extension clients, API/bridge and MCP onto shared
operation semantics, preserve existing capabilities and old interfaces, and verify
the result. This authorizes the migration and necessary corrections, not a release
publication or unrelated API/DSH refactor. Existing design-document edits belong
to the preceding assignment and are retained in this worktree.

The design owns semantics. [Architecture](../../ARCHITECTURE.md),
[API](../api-server.md), [MCP](../mcp-server.md), [Gemini](../gemini-web.md),
[cache lifecycle](../cache-lifecycle.md) and the
[adaptation skill](../../.agents/skills/chatgpt-web-adapt/SKILL.md) own their boundaries.

On November 13 the user clarified that API gateway and MCP share authority;
the prototype's separate gateway MCP credential/grants are withdrawn. The
same follow-up authorizes committing the corrected implementation.

## Baseline and end state

Source baseline: `3398b9c`. The registry unifies dispatch, but the bridge and
control routes still interpret provider semantics. Grok's ordinary disabled
guard does not cover its conversation control writes. MCP depends on ChatGPT's
special create/turn protocol. The three native clients, account protections,
rich content, history and binding owners must survive the migration.

End state: one background engine owner handles admission, identity, runs,
subscriptions and terminal outcomes. Provider adapters keep native execution
and evidence. Page clients, HTTP and MCP project the same operations. Public
legacy paths are edge aliases without independent execution or authorization.
External access uses explicit engine policy. No uncertain request is replayed.

## Execution and evidence

- [x] Independent design review; [first findings and decisions](../evidence/2026-11-12-engine-runtime-review.md) recorded before affected runtime integration.
- [x] Pure contract/catalog/policy and one-time config migration.
- [x] Durable run/binding owner, native adapters, legacy Port projection.
- [x] All legacy controls use the same admission/execution owner.
- [x] Versioned bridge, generic HTTP operations, compatible completions.
- [x] Generic MCP waiter/tools and compatible `ask_chatgpt`.
- [x] Settings expose engine access and actual capabilities/recovery states.
- [x] Controlled runtime/Port/WS/poll/HTTP/MCP and provider regression checks.
- [x] Browser interaction, lint, documentation, production packaging checks.
- [x] Fresh completion review, corrections, owners/guides and closure evidence.

The design review is one synthesized ChatGPT request using the existing authorized
collaboration; completion review is one fresh request after the artifact exists.
The old bridge was disconnected; reopening its existing page restored a healthy
connection without changing port, tokens or account settings. This observation
does not establish provider compatibility.

## Compatibility, recovery and removal

Preserve ports/authentication, selected models/defaults, original ledger keys,
native continuation IDs and durable holds. New request IDs must reach the
background before any native write. Read recovery uses exact run/turn identity.
Old clients keep their documented response and `ask_chatgpt(query)` contract.
Use the explicit engine-contract header for independent standard completions
during this compatibility release; leave an announced breaking default switch
to release work. No published version is invented by this local implementation.

Remove provider branching from common bridge, waiting and execution code as each
consumer migrates; retain only necessary edge aliases and the scoped legacy
completion projection. Do not delete API/DSH routes. Rollback stops new writes
and preserves the owner needed to inspect unresolved operations; it never clears
the ledger, a provider hold or an invalidated binding.

## Verification limits

Controlled checks must observe native-call counts, disabled/unauthorized zero
writes, precise continuation/terminal evidence, identical cross-entry semantics,
Stop/disconnect/restart, capacity and old-client behavior. A synthetic fourth
adapter must work through common entrypoints without provider branches.
Real-account sends are separately bounded and recorded if performed. Local
builds, installed extension, running processes and user's copied Drafts actions
are different artifacts and must be reported separately.

## Closure

Completed local implementation and controlled delivery on 2026-11-12. Final
full suite: 151 files / 2,007 tests; lint, documentation checks and production
packaging passed. The existing Brave installation was updated/reloaded; API/MCP
processes retained ports, bindings and existing credentials, and the real local
engine catalog/tool list and UI grants were observed.

[Completion evidence](../evidence/2026-11-12-engine-runtime-review.md) records both
review findings, corrections and verification boundaries. All-three live-account
generation/append acceptance was not claimed or used to broaden existing
permissions. Old public clients retain their declared compatibility profile.
No release was published and no user Drafts copy was replaced.

November 13 source corrections preserve the existing gateway API credential for
MCP, use common engine grants, honor a changed ChatGPT UI model, and preserve
newer conversation bindings during older-run recovery. Final regression passed
152 files / 2,012 tests; lint, documentation checks and production packaging
passed. Their checks and delivery limits are recorded in the existing completion
evidence. The installed November
12 prototype and user Drafts copies are separate from these source corrections.
