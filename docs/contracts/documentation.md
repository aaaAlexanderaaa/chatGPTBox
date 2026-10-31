---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-10-29
---

# Documentation discipline

## Purpose and scope

Keep product decisions, current implementation, proposed work, and observations
distinguishable. This contract governs repository documentation and its local
checker. It does not authorize feature work or select a roadmap.

The [documentation map](../README.md) routes readers to owners.
[Development discipline](development.md) owns collaboration and delivery.
The [reconciliation record](../evidence/2026-10-22-documentation-discipline.md)
identifies the template sources and the repository gaps behind these rules.
The [2026-10-29 refresh](../evidence/2026-10-29-discipline-refresh.md) compares
the complete current reference discipline with these local owners.

## One owner per decision

Before adding a document, identify what it owns and whether an existing owner
can be updated. Split when authority, audience, lifecycle, or reason for change
differs. File count and length do not measure quality.

Product meaning belongs in a product or interface contract; dependency direction
belongs in architecture. A plan contains the desired end state, baseline, steps,
and verification, with links to those owners. It does not issue permanent rules.
Root entrypoints route readers and keep a short executable path. Guides can
summarize an owner for their readers but cannot introduce new conditions.

When removing a working record from the active reading path, first move its
still-applicable decisions into the surviving owner. Keep dated originals when
they explain a decision or recovery. Delete disposable scratch material only
when it supports neither. Do not create a chain of summaries that a new reader
must reconstruct.

## Read rules before judging their fit

A request to learn, update, or restructure a discipline reads the source's
complete declared learning set before judging applicability, including rules
that initially seem inactive or already covered. Without a declared set, obtain
the complete operative source rules under comparison. Keep current rules and
target drafts distinct. Understand each rule's problem, mechanism, scope,
exceptions, costs, and decision authority; follow needed explanation when a
decisive reason is missing. A title, summary, transfer rank, or similarly named
local section cannot establish that understanding.

Compare the understood rule with actual project facts and existing coverage.
Record whether it applies and is satisfied, applies with a gap, or does not
apply with the fact and reason supporting that result. Use supplied corrections
and what the loaded rules caused when available; otherwise compare the present
expectation and baseline and leave unavailable history unknown. A passing
checker or filled policy does not establish the owner's expectation was met.

Keep the judgment at the existing comparison/evidence owner and its concise
result in `AGENTS.md`, naming the rule, result, and local owning section.
Land authorized settled changes at those owners. A no-change conclusion needs
the comparison and no unsatisfied applicable rule. A change needing new
authority names its concrete method and decision; existing authorization
remains sufficient for the scope it already covers.

Reading does not install source authority. Preserve local decisions, supported
languages, and enforcement scope. Copying a governance tree, enabling new gates,
replacing project instructions, or changing product code needs authorization
covering that method. The current assignment can supply it. This does not turn
an authorized update into repeated phase approvals.

An explicitly narrow practice request or a method inquiry inside a concrete
task reads that practice's full operative owner and dependencies, then judges
its fit. It does not claim a full survey or dismiss unread rules. Later ordinary
work reads its applicable rules under [development](development.md#apply-the-concerns-the-change-actually-touches);
it does not repeat the full discipline comparison for every task.

## Metadata

Markdown under `docs/`, plus `ARCHITECTURE.md`, carries flat frontmatter:

```yaml
doc_type: guide
status: current
authority: guidance
last_reconciled: 2026-10-22
```

Supported types are `authority-map`, `architecture`, `contract`, `design`,
`decision-log`, `plan`, `guide`, and `evidence`. Authority is `normative` for
architecture, maps, contracts, and designs; `planning` for plans; `guidance` for
guides; and `evidence` for observations and dated decision logs.

Contracts and designs also record:

- `implementation`: `not_started`, `in_progress`, `partial`, `implemented`, or `retired`;
- `verification_status`: `pending`, `partial`, `verified`, or `not_applicable`.

`implemented` means code exists for the stated scope. `verified` requires
linked, reproducible evidence for that scope, declared through
`verification_evidence: [docs/evidence/path.md]` (or a completed plan). A build, syntax check, fixture,
or old test count proves only the property it actually checks.

`last_reconciled` is the date the text was compared with its stated sources,
not a date refreshed by formatting. A lifecycle-only audit says so in the
record; it does not renew old live-service observations. Metadata uses scalar
values or JSON-style inline arrays; nested YAML is outside the local checker.

Root README files, `CONTRIBUTING.md`, `AGENTS.md`, component READMEs, and GitHub
templates are entrypoints rather than another canonical rule set. Their links
are checked without requiring frontmatter. Executable Drafts assets, JSON
fixtures, source captures, and generated HTML are not Markdown contracts.

## Lifecycle

| State | Meaning | Exit |
| --- | --- | --- |
| `current` | Operative decision, interface, or guidance within its scope | Reconcile when its sources or behavior change |
| `target` | Accepted future behavior; implementation or acceptance is incomplete | Verify the stated scope before promoting to current |
| `active` | Execution is actually in progress | Complete, cancel into history, or record a conflict |
| `needs_reconciliation` | Known conflict or unsupported completion/state claim | Resolve the named gap before relying on it |
| `completed` | Plan delivered its stated scope with evidence | Retain for provenance; do not resume its checklist automatically |
| `historical` | Dated decisions, observations, exploration, or retired work | Consult for a specific provenance or recovery question |
| `superseded` | A replacement in the same authority class owns the decision | Follow `superseded_by` |

Use `completed` only for plans. A record describing old implementation without
adequate acceptance evidence can be historical; it must not be declared complete
just because its branch or files exist. A plan can finish its bounded delivery
while the parent product direction remains partly implemented.

Supersession is explicit and reciprocal: the old document sets
`superseded_by: [docs/path.md]`; its replacement sets
`supersedes: [docs/old-path.md]`. Both ends retain the same type and authority.
These paths are repository-relative. Merely citing an old source is not
supersession. A guide that deliberately summarizes a current contract may
declare `projection_of: [docs/path.md]`; each source must be a current normative
contract or design. Review that guide when its source changes. A later source
date is a review signal, not proof that the guide is wrong.

## Sources, language, and conflicts

Distinguish the user's instruction, a proposal they accepted, an implementer's
choice, and an unresolved inference. Preserve date, scope, and a usable source
reference. An old generated statement claiming approval is reported evidence
until its original is available. Repetition and polished prose do not strengthen
that claim. Silence is not approval.

A proposed standing rule records its reason, source/date, scope, exceptions,
and intended owner. Existing instructions to adopt it supply confirmation;
otherwise obtain that decision before making it a new requirement. A permitted
exception records its authorizing owner, rule, scope, reason, residual risk,
review or expiry condition, and recovery. It grants no authority held elsewhere.

Use plain language and existing project terms. Keep existing Chinese product
records and the bilingual READMEs useful to their readers; do not translate an
entire archive merely to match the reference project's publication language.
Use exact UI labels in procedures. Explain which page sends a request, which
code forwards it, and which HTTP interface receives it.

Write for the actual reader and their next decision or action. Lead with the
useful conclusion; retain reasoning, examples, and uncertainty that help them
use it. Inspect the draft for repeated explanations, unexplained internal terms,
and process narration that makes the reader reconstruct the work. A necessary
qualification can improve clarity; word count is not the measure. Examples
teach the behavior future readers will copy. New discipline text uses plain
English while existing Chinese product records keep their supported audience.

Supplied personal context stays at its permitted location and audience.
Distinguish background, preference, inference, and permission. Transfer only a
general mechanism or project decision authorized for this repository's readers;
do not copy private profiles, local private paths, captures, or account details.
Authorship is assessed before an external lesson becomes policy: human decisions
with available originals, reported statements, generated leads, and unknown
authorship retain different evidence strength. Recurrence measures persistence
of a problem, not the importance of a preference.

Do not resolve contradictions by choosing the newest filename or making code
and tests agree with each other. Record the affected sources and gap, mark the
affected document `needs_reconciliation`, and reconcile at its owner under the
current authorization. Continue unrelated authorized work.

## Plans and closure

Use a plan for a material change with dependencies, uncertain migration, or a
handoff need. A routine correction updates its existing owner directly.
A plan must let a reader without the chat understand:

1. the requested outcome and authority;
2. the current state and gap;
3. the complete intended end state and exclusions;
4. execution order, material risks, and recovery;
5. acceptance evidence and its limitations;
6. what is finished and what remains unresolved.

At closure, merge live decisions into their owners, reconcile usage guides and
entrypoints, finish the plan's status, and link the actual checks and limits.
Do not mark unrelated product acceptance or releases complete.

## Mechanical checks and limits

[The policy](../../docs-policy.json) declares the checked paths and required
entrypoints. `npm run docs:check` validates metadata, lifecycle combinations,
local Markdown links and heading fragments, and declared document relationships.
Current documents and entrypoints fail on structural defects. Broken references
inside frozen historical/completed records are reported as advisories so missing
old chat IDs are visible without rewriting original evidence. Metadata and
relationship defects remain errors in history as well.

Local links must stay inside the repository, including through symlinks. Remote
URLs are not fetched. Code fences and inline code examples are not treated as
links. The checker supports inline and reference-style Markdown links, Markdown
headings, and explicit HTML heading IDs. It does not execute examples, validate
remote sites, compare prose with source code, or judge product quality.
Checker changes require positive and negative fixtures; ordinary prose edits
require the checker and a focused source review, not a full extension rebuild.

The PR documentation job runs for documentation, entrypoint, policy, checker,
and checker-test changes. Its trigger includes source files so a renamed source
file cannot silently break a live documentation link. It does not impose the
reference project's full adoption framework or product-code gates.

## Source and acceptance

The user requested repair of this project's documentation discipline on
2026-10-22, using `template-project` as a reference. The selected mechanisms are
single ownership, explicit lifecycle, source attribution, proportionate delivery,
and tested structural guards. The [reconciliation evidence](../evidence/2026-10-22-documentation-discipline.md)
records the inspected reference revision, findings, dispositions, and checks.

Acceptance requires that a reader can locate the current owner without replaying
old plans, distinguish implemented behavior from future promises, and see what
was actually verified. The checker supports those outcomes; a passing run alone
does not establish them. Subsequent contributor use remains unobserved.
