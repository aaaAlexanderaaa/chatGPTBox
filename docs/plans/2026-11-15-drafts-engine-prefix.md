---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-15
---

# Drafts engine prefixes and common actions

## Outcome and authority

On 2026-11-15 the user requested simpler Drafts installation and then specified
the engine selection rule: a new note starts with `:c ` for ChatGPT or `:g ` for
Gemini, defaults to ChatGPT, and cannot switch engines after binding. This rule
also governs lists and Project selection. Replies do not interpret prefixes.
The [gateway owner](../api-server.md#drafts-engine-selection) records the behavior;
the [Drafts guide](../drafts/README.md) owns installation and use.

## Baseline and end state

The baseline has ten actions across two providers and Preview, with shared
sources, generated scripts and seven import packages mixed in one directory.
Each network script has its own manually edited address and credential.

Deliver common List, Get, Send, More and offline Preview entries. More contains
the supported photo, Project and older-history operations. Keep native provider
adapters, v2/v3 note validation, frozen requests, exact recovery and capabilities.
Use shared Drafts credentials; separate maintained sources from install assets.
Do not change gateway/native provider protocols, enable Grok, publish packages,
install into the user's applications or submit live Drafts/provider validation
requests. Authorized ChatGPT review generations are bounded separately below.

## Execution and recovery

1. Reconcile prefix, binding, capability and failure behavior at the owner.
2. Review routing and legacy-note protection before runtime implementation.
3. Generate common self-contained actions from isolated provider adapters.
4. Verify actual generated scripts/packages, including both providers, old
   notes, pending operations, cancellation, malformed controls and prefix edges.
5. Reconcile installation and source references, run focused runtime checks,
   lint and documentation checks, then evaluate the final change in fresh context.

Existing installed copies and notes remain untouched. Old note formats route to
their original adapter. Unknown/conflicting controls stop before HTTP and retain
the original note. Pending requests keep their original engine, key and payload.

## Delivery and verification

Completed the bounded source, package and controlled-runtime delivery. Five
individual import packages now expose List, Get, Send, More and Preview; they
can be imported into one group. No single-file group importer is claimed.
Shared credentials replace nine hardcoded configurations. Maintained fragments
live in `scripts/drafts/`, generated scripts in `docs/drafts/scripts/`, and the
optional live-preview template in `docs/drafts/templates/`.

On Node 22.18.0:

- `npm test`: 156 files and **2,151 tests passed**, including the corrected old
  list routing. Local HTTP/WebSocket tests ran outside the filesystem sandbox
  because its loopback `listen` returned `EPERM`; the sandbox-only attempt was
  interrupted rather than reported as passing.
- Focused Drafts/compatibility checks: **134 tests passed** across the actual
  generated actions, both adapters, photos/Projects, control validation, exact
  requests, lost acknowledgements, failed saves and legacy recovery. The final
  wording cleanup is rechecked by this same focused scope.
- `npm run lint` and `git diff --check` passed.
- `npm run docs:check`: 0 errors; six frozen-history link advisories, including
  two older Drafts source paths relocated in this change. Current installation
  and owner links resolve; original dated evidence is retained.
- `npm run build` passed and produced the normal/reduced Chromium and Firefox
  archives. It emitted the existing outdated Browserslist database notice.
  `sync-drafts-engines.mjs --check` verifies the final generated scripts/packages;
  the Preview generation and its offline runtime remain checked by the suite.

The pre-migration Gemini pending fixture was produced using the original script
from baseline `194870fc3aaa9f7a6aa6f3b69e2a432a64646ea5`, with synthetic text and
a synthetic run ID. Common Get collects that original run without writing a new
question and retains a future reply containing `:c` as Gemini-bound user text.

## Review findings and corrections

Expected and actual account use: **two ChatGPT collaboration requests**, one
design review and one fresh-context completion review. Inputs included the user
outcome, local v2/v3/control and gateway facts, proposed/final routing, upgrade
instructions, reported tests and explicit native limitations. The completion
review received the actual router source, but not every full adapter/package.
These reviews share the supplied repository facts; they are not separate native
observations or independent test executions.

The design review raised v2 compatibility, host side effects, destructive List,
request identity and upgrade concerns. Version 2 remains the implicit ChatGPT
binding; adapters receive a buffered note with a single explicit commit boundary;
List protects unsent text/conversations; original requests/keys and a nonsecret
gateway URL are retained; the guide explains disabling obsolete Send actions.
Drafts documents `Draft.update()` as returning void; a simulated false return is
extra defensive coverage, not evidence of a native return value.

The completion review found a concrete legacy-list classification gap: an old
list was bound to ChatGPT but had no common `kind`, blocking List and exposing an
inappropriate More option. A common kind hint now preserves recognized legacy
list/conversation types while the original adapter still validates every control.
List refresh, Send and More/photo/Project protection have focused regression
coverage. Existing Send already had an adapter guard; the new precheck rejects
before even migrating that list. Upgrade instructions now describe group setup,
same-name replacement/copies and the order for disabling old actions.

This correction was evaluated locally after the second review; no third account
request was made. The final router SHA-256 is
`44720b8ff7a8f2ce6b13b7b28bcfb3288b6be9c3f15d2db23bf258d0f9651158`.

## Remaining acceptance limits

Native Drafts import/replacement, actual local persistence failures, camera and
WebKit behavior, and device/iCloud synchronization remain unverified. VM host
objects and a production extension build cannot establish those properties.
No live Drafts/provider validation write, installed extension update, native
action installation, directory publication or release was performed. The two
authorized review generations above are separate account use. Existing actions need
the documented manual upgrade; this completion does not claim native acceptance.
