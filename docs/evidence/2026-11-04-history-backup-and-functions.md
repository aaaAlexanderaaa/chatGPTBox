---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-11-04
---

# Large history backups and function interaction repairs

## Request and investigation boundary

The user reported freezes and page crashes after several hundred conversations
in a backup with thousands of conversations and more than ten projects. They
also reported poor function-management and assistant interaction, then clarified:
“编辑要到页面顶部、开了模板的时候输入就失效了，UI不好看”. The crash
report was not accompanied by a trace, heap dump, browser version, or the actual
library. This repair establishes specific failure mechanisms and controlled
verification; it does not reproduce that user's crash.

Baseline source revision: `7f98a73f216971181ee5d9fc7592c552df3192ab`.
Product and resource decisions remain at the
[browser assistant owner](../product/browser-assistant.md#2026-11-04-功能编辑与助手唤出修正)
and [cache owner](../cache-lifecycle.md#resource-boundaries-during-large-backups).

## Observed mechanisms and changes

| Boundary | Baseline problem | Repair and evidence |
| --- | --- | --- |
| Configuration subscription | `useConfig` merged all storage events, including raw snapshots, into each mounted consumer's state. More backed-up bodies meant more retained bodies in floating toolbars, conversation cards and panels | Only declared configuration keys and the explicit panel session subscription enter configuration. A hook regression sends 1,200 body/progress events and checks no additional render or retained body keys |
| Live history statistics | Every metadata/progress event started a fresh read of all cached bodies; reads could overlap | Statistics use the index and key names; refreshes coalesce over 1.5 seconds and share one in-flight read. Older records without coverage metadata are unknown, rather than complete. Browsers without key discovery show an estimate |
| Full file export | All raw bodies were loaded before splitting into volume maps | Two passes measure individual records and then await one volume writer at a time. Settings and the API Server Bridge use this path; schema 2 and selected-conversation exports remain compatible |
| Template input | Template mode always suppressed the automatic material suffix, even without a material variable. The assistant's `content` provider could read page content during an input rewrite | Templates without material variables retain the material suffix; both material variables refer to the chosen material. Tests and browser submission inspect the actual prompt |
| Function editing | One editor above the entire list moved editing away from the selected row; repeated entry checkboxes dominated each item | Search, named switches, compact icon/name/scope/result rows, collapsible entry assignment, and an editor inside the selected row. Failed saves retain drafts; successful save/cancel restores focus |
| Assistant invocation | Repeated function pills and all configuration fields crowded the initial view; focus was not restored | One function selector, a prominent instruction field, visible scope/connection summary and expandable adjustments/preview. The primary actions remain reachable, including when content scrolls. Run retains dialog focus; Escape restores the original page input |

The backup still uses the existing remote list/detail APIs and configured RPM.
No provider request, pagination, retry, HTTP 429 lock, persisted job identity, or
resume semantics changed. The settings page reads storage statistics locally;
it does not request remote bodies to populate those statistics. Export reads
local storage only and stops when its writer fails. Cancelling the directory
picker does not start an export scan.

## Interaction practice applied

This was a narrow practice inquiry into `template-project`, inspected at
`cb9e90a8f59b3535ce43bf250b0a4aad78449030`: its full frontend contract,
surface-contract template/design entry, outcomes-before-means and bidirectional
verification sections. The method was applied to the existing product owner,
with the dated feedback, implementation choices, states, focus, geometry and
verification limits preserved there.

The chosen presentation retains the existing theme, fonts, semantic colors and
UI components. Its hierarchy serves finding, editing and running a saved
instruction. Inline editing was preferred to a modal because the reported
problem was losing the selected row's context; a modal would require another
focus/scroll boundary. Collapsing entry assignment keeps it available without
repeating three checkboxes throughout the list. The assistant selector scales
to many saved functions while the instruction remains directly editable.
These are implementer choices within the requested repair, not verbatim user
layout specifications or a broader adoption of the template's tooling.

## Verification

Checks ran with Node **24.22.1**, within the project's supported `>=22` range.
The shell's default Node 20 was not used for project checks.

- Full Vitest run: **125 files / 1,648 tests passed**. The first sandboxed run
  timed out on local HTTP/WebSocket listeners and was interrupted. The complete
  rerun with permitted local listening passed, including the existing hydrate,
  pagination, Stop/resume and module-boundary cases. No real account was used.
- ESLint passed. Production build passed and emitted all four Chromium/Firefox
  normal/reduced ZIP archives. Existing Browserslist age notices were advisory.
- Documentation check: 51 files, zero errors and four existing historical-link
  advisories. `git diff --check` passed. No documentation-checker logic changed.
- History regressions cover 1,200 entries across 14 project IDs, zero body reads
  for live statistics, one-snapshot reads for file export, awaited writers,
  disk-failure stop, schema-2 round-trip import, old coverage and browser fallback.
- Function regressions cover in-row editing, focus, search/empty results,
  template toggles preserving Chinese text, failed-save retry, actual input
  material submission, no invocation on ordinary open, and composition-aware
  Escape handling.

### Resource probe

Run `node scripts/check-history-backup-resources.mjs` after installing the locked
dependencies. The script bundles the
[synthetic fixture](../../tests/fixtures/history-backup-resource-probe.mjs) with
the browser-storage stub and runs it in a fresh process with a **128 MiB V8
old-space limit**. It generates each 256 KiB body when read, emulating storage
IPC rather than holding the complete storage inside the measured JS process.
It serializes every output volume and samples memory during reads/writes.

The retained probe run processed **1,200 conversations, 14 project IDs, 300 MiB
of raw body text**, producing **20 volumes / 300.59 MiB**. It made 2,400 body
reads across two passes, at most one body per read, and zero body reads for the
preceding live-statistics query. Sampled peak heap was **131.94 MiB**, RSS
**299.13 MiB**, elapsed **775 ms**; 20 timer callbacks ran while writers yielded.
An earlier disposable probe of the same workload sampled 117.07 MiB heap and
293 MiB RSS. The old-space limit excludes the young generation, external
buffers and other process memory; neither number is a total-memory cap.

This is a local resource regression and a reproducible structural check, not a
browser benchmark, a safe account request rate, an export-duration promise, or
a measurement on the reporter's machine. The mock does not include browser
storage internals, Blob downloads, other extensions or rendering processes.
One unusually large snapshot or catalog can still exceed the volume target;
import still materializes its complete input.

### Controlled browser observations

The in-app browser loaded the actual ToolsTab, FunctionLibrary, assistant,
styles and template-preparation path in a disposable local fixture. Storage and
the conversation transport were controlled; Run exposed the prepared prompt,
not a live model response.

- Editing a searched saved function placed the form inside that row and
  focused its name. Chinese text survived template off/on; a forced storage
  failure preserved it, and retry closed the form and returned focus to Edit.
- At viewport widths 320, 420, 600 and 960 px, the actual function containers
  measured 288, 388, 568 and 928 px. All 32 visible editor controls were within
  the containing surface; there was no horizontal row overflow. All 17
  populated rows were also checked at the narrow width without overflow.
- At 320 × 640 in the dark theme, the assistant measured 296 × 569.28 px and
  stayed within the viewport; Run occupied y=489.69–525.69. At 424 × 611 with
  adjustments expanded, its bottom was y=599, Run remained at y=552–588,
  and the content scrolled inside the panel. No horizontal control clips
  were measured. Light and dark screenshots were visually inspected.
- Running the saved `{{content}}` rewrite used the source draft and excluded
  the surrounding article. Running a template without a material variable
  included the chosen draft as JSON data. Run moved focus into the dialog;
  Escape removed it and restored focus to the source textarea.
- Temporary viewport overrides were reset and the test tab/server were closed.
  Screenshots and the disposable fixture stay outside tracked product files.

Real OS input-method composition, Firefox interaction, low-memory browser
pressure and the reporter's original library remain unverified. Unit composition
events are not a real input-method trial. No installed extension, gateway,
proxy tab or Drafts copy was updated, and no release was published.

## Follow-up persistence correction

Review found a race in the uncommitted function-settings changes: while storage
was still saving the first toggle, a second toggle built its complete function
list from the old configuration and could undo the first change. A delayed-write
comparison reproduced the loss in the proposed code and preserved both changes
with the baseline hook's optimistic updates.

The correction keeps function settings visible as saved only after a successful
write. The function library reserves one operation synchronously, disables its
native controls until completion or failure, and includes imported-file reading
inside that reservation. Duplicate submissions cannot start another write before
the disabled state renders. Invalid imports and failed writes restore controls;
failed saves retain the editor draft for retry.

Six regressions exercise the actual settings hook and function library with
delayed storage: enabled switches, entry checkboxes, write failure, duplicate
submission with draft retry, delayed import reading, and invalid-import recovery.
The initial five-test run exposed four failures before the correction. The fresh
full run after correction passed **126 files / 1,654 tests** on Node **24.22.1**.
The first full attempt was interrupted when sandboxed local HTTP/WebSocket tests
timed out; the rerun with permitted local listening passed. ESLint and the
production build also passed, producing all four normal/reduced archives.

A disposable in-app browser fixture loaded the actual function library, settings
hook and built options CSS with manually delayed storage. During a pending write,
zero library controls were enabled. Completing the first write and then toggling
the second function preserved both disabled states. A forced save failure kept
the Chinese draft, restored editing, and displayed the error; retry saved the
draft, closed the editor and returned focus to Edit. This is controlled browser
evidence, not a real browser-storage latency or real-account trial. The fixture
tab and local server were closed. No installed extension was updated.
