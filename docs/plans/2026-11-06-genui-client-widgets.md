---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-06
---

# Client widget compatibility and Drafts preview

The user requested implementation of the GenUI gaps investigated in this chat,
after pulling remote changes, and an updated Drafts preview. The clean `master`
checkout fast-forwarded from `7f98a73` to `683e9a8`; those remote changes remain.
The [rendering contract](../chatgpt-web-genui.md) owns the resulting behavior.

## Outcome and boundaries

Resolve native `charts_widget_v2` / `recharts-json` references into the existing
portable chart descriptor, including bar, line, pie and scatter, axis settings,
line interval bands, and descriptive text. Preserve readable static content for
writing, map, app and learning/translation widgets. Unsupported widget content
gets a visible local alternative when its source is available, so neighboring
content survives. Generated JavaScript, remote resources and native interactive
apps remain outside the static rendering boundary.

Use the same conversion for streams, resume, history, and Drafts. Correct the
accepted tooltip switches and monotone curve configuration. Regenerate the
offline HTML and Preview Action together; Get/Send keep their existing HTTP and
transcript contract. No gateway credential, model setting or pending-turn state
changes are needed.

## Delivery

1. Reconcile the rendering contract and Drafts update instructions.
2. Implement bounded widget/graph normalization and local source alternatives.
3. Verify data, interval geometry, sanitization, neighboring content and actual
   Get/Send script output with synthetic fixtures, including SSE and resume.
4. Regenerate preview artifacts, run relevant checks and production builds,
   inspect desktop/narrow/dark/offline rendering, and re-read the reported
   existing answer without resubmitting it.
5. Update the installed extension when its existing directory is confirmed;
   distinguish source/build/reload/gateway/Drafts-device evidence at closure.

The original failing answer and official public JS were inspected on November 3;
private captures stay outside Git. Synthetic fixtures retain only their data
shapes. Device import/iCloud synchronization cannot be inferred from a browser
preview. Replacing an imported Preview Action remains a separate installation
step if Drafts is unavailable on this machine.

## Progress and evidence

- Remote pull and the bounded implementation above are complete. No changes to
  the remote history-backup/Functions work were reverted.
- Node 22.18.0: full `npm test` passed **127 files / 1,678 tests**. This includes
  chunked first-stream, resume and history polling with native widgets, with and
  without DIL, late content references, HTML sanitization, interval geometry,
  exact fractional source values, and both existing Drafts refresh scripts.
  The initial sandboxed full run could not bind loopback sockets (`listen
  EPERM`); the successful full run allowed the tests' local HTTP/WebSocket servers.
- `npm run lint`, `npm run docs:check`, `git diff --check` and the generated-preview
  consistency check passed. Documentation retains four existing historical-link
  advisories. Production Chromium/Firefox and reduced builds passed through
  `npm run build:extension`; the build reported the existing stale Browserslist
  database warning.
- The generated HTML and Preview Action contain the same updated inline runtime
  and CSP hash. Browser checks used fixed synthetic pages served from memory,
  without exposing a filesystem directory: four SVG charts, desktop and 390px
  layouts, a locally scrolling map table, legend toggle, data-table keyboard
  interaction, and native-browser dark-media redraw. The 390px page had a 390px
  scroll width; its four charts were 358px wide. After stopping the preview
  server, the loaded page still opened its data table with all four SVGs present.
  Temporary pages, media/viewport overrides and that server were cleaned up.
- The browser confirmed its existing unpacked directory before replacement.
  The installed 4.3.2 extension was reloaded, its proxy page refreshed, and its
  bridge reconnected to the unchanged gateway on port 18081. The installed
  background bundle matches the production build. No gateway script changed,
  so its existing process/configuration was retained.
- Two forced GETs re-read the reported existing answer, without submitting its
  question again. The final running gateway returned `html/rendered`, one pie
  with four rows, its footer, full-precision table values, `pending: false` and
  a non-stale cache. Both actual Get/Send scripts preserved that final HTML in
  isolated scripting contexts. Private captures remain outside the repository.
- One configured ChatGPT code-review call returned an ambiguous-dispatch timeout;
  it was not resubmitted and is not claimed as a completed independent review.

The delivered scope is source, built/installed extension, gateway readback and
regenerated Drafts assets. Drafts is unavailable on this host: native HTML Preview
import, WebKit behavior and iCloud synchronization were not verified. The user
must import the regenerated HTML or Preview Action on the Drafts device, then
Get the existing conversation again. Get/Send scripts need no replacement for
this update. Interactive apps/maps, multiple axes for one dimension and exact
natural-curve interpolation remain the documented static-renderer boundaries.
