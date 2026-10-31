---
doc_type: authority-map
status: current
authority: normative
last_reconciled: 2026-10-29
---

# Project documentation

Start with the document that owns the decision you need. A recent file, a long
plan, or a successful test run does not acquire product authority.

## Find the owner

| Question | Read | Role |
| --- | --- | --- |
| What is ChatGPTBox for? | [Product definition](product/definition.md), then the [browser assistant direction](product/browser-assistant.md) | Accepted purpose, user outcomes, and scope |
| What must a feature preserve? | [Product contracts](product/contracts.md) | Product behavior and failure boundaries |
| Where does code belong? | [Architecture](../ARCHITECTURE.md) | Runtime boundaries, state owners, and dependency direction |
| How should a change be delivered? | [Development discipline](contracts/development.md) | Investigation, authority, implementation, and verification |
| How are documents maintained? | [Documentation discipline](contracts/documentation.md) | Ownership, lifecycle, evidence, and checks |
| How is an external discipline learned or updated? | [Read rules before judging fit](contracts/documentation.md#read-rules-before-judging-their-fit) | Complete source understanding, applicability judgments, and authorized local changes |
| How do I develop and test? | [Contributing](../CONTRIBUTING.md) | Supported runtime and executable commands |
| How do I use page functions? | [Browser assistant guide](browser-assistant.md) | Current usage and portable function format |
| How do I use the local gateway? | [API server](api-server.md), [MCP server](mcp-server.md), [Drafts](drafts/README.md) | Interfaces and operator procedures |
| How do ChatGPT Web recovery and rendering work? | [Gateway recovery](api-server.md#at-most-once-writes-and-bounded-recovery), [cache lifecycle](cache-lifecycle.md), [native visualizations](chatgpt-web-genui.md) | Current interface boundaries; [September stream study](chatgpt-web-stream-resume.md) is dated evidence |
| Which execution records are still active? | [Plans](plans/README.md) | Explicit plan states; no implied backlog |
| Why did a previous decision change? | [Historical records](history/README.md), [verification evidence](evidence/README.md) | Provenance and observations |

## Authority and current state

The user owns product direction, priorities, and accepted trade-offs. An explicit
new instruction can authorize reconciling the affected document. Contributors
make ordinary reversible implementation choices within that scope.

Architecture owns structure; product and interface contracts own their stated
behavior. Neither silently overrides the other. Reconcile a conflict at the
affected owners before dependent implementation. Plans sequence work, guides
explain it, and evidence supports claims. They cannot change a contract.

`current` describes an operative decision or procedure. `target` records accepted
future behavior. `active` describes work actually in progress.
`needs_reconciliation` exposes a known conflict or an unverified status.
`completed`, `historical`, and `superseded` records are available for provenance
and recovery; their old branch names, commands, and task lists are not startup
instructions. Full state definitions live in the
[documentation contract](contracts/documentation.md#lifecycle).

An accepted product expectation and its implementation are separate facts.
Contract metadata records implementation and verification separately. In
particular, the dated Grok and DeepSeek Harness designs remain `target` while
their full acceptance is unproved. This does not mean that their existing code
is absent or that their accepted safety boundaries can be ignored.

## Reading for a task

Establish the requested outcome, current code and evidence, decision authority,
affected boundaries, and completion evidence. Follow only the relevant owners;
do not read every archived plan before a local fix.

Read complete applicable owner sections, their dependencies, and exceptions
before choices rely on them. Recover truncated text in parts; a manifest or
summary alone is a locator. Use the [concern route](contracts/development.md#apply-the-concerns-the-change-actually-touches)
and [execution depth](contracts/development.md#choose-execution-depth-by-consequences)
for the actual task. An ordinary lookup needs no standalone plan or full survey.

The product direction confirmed on 2026-10-21 is the entry for browser assistant
work. Its engineering exploration is historical reference. A JSON example or
passing schema check does not make that exploration an approved architecture.

For ChatGPT Web protocol work, use the repository's
[adaptation skill](../.agents/skills/chatgpt-web-adapt/SKILL.md) and current code.
The dated September reports describe observations at that time.

## Maintaining this map

Update the owner when a decision changes; update its links and affected usage
guides in the same change. Add a document only for a distinct decision,
procedure, execution record, or durable piece of evidence. The
[documentation contract](contracts/documentation.md) owns metadata and closure
requirements. [The October reconciliation](evidence/2026-10-22-documentation-discipline.md)
records what was changed, the reference practices selected, and remaining limits.
The [October 29 refresh](evidence/2026-10-29-discipline-refresh.md) records the
complete rule comparison and the additional local discipline changes.

Run `npm run docs:check` after documentation edits. It checks structure and local
references. Semantic review still compares the prose with its sources and the
requested outcome.
