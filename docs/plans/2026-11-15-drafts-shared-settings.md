---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-15
---

# Drafts shared settings

The user approved **More → 设置** on 2026-11-15 after identifying repeated edits
to action variables as their main friction. The [interface owner](../api-server.md#drafts-shared-settings)
defines the accepted behavior; the [Drafts guide](../drafts/README.md) owns use.

The baseline already shares a gateway Credential, but model/display constants
remain copied into generated actions. Add one versioned nonsecret settings file
and an editor inside More, wire every network action to it, and retain the
existing credential, engine/gateway bindings and frozen-operation recovery.
Preview and native provider protocols are outside this change. No helper action
or manually installed config file is needed.

Execution and completion:

1. Reconcile the interface owner, implement shared loading/editing and regenerate
   the four network scripts/packages with their existing IDs.
2. Exercise generated actions with controlled Drafts host/file/HTTP boundaries:
   shared values, missing/invalid/unavailable/stale storage, cancellation, no
   settings HTTP/note writes, and unchanged pending request identity.
3. Reconcile installation instructions, run affected tests, lint, generation and
   documentation checks, and obtain one fresh-context workflow review.

Token values remain in Credential; URL changes retain the note's existing
gateway guard. Storage failure blocks networking rather than assuming defaults.
The staged file bounds leftover storage to one small file; iCloud has no merge
or instant-sync guarantee. Rollback retains the Credential and notes; old
packages ignore the new file and require restoring any explicit script settings.

## Local implementation and verification

The four generated network scripts/packages now share the version-1 preferences
reader and More editor while retaining their existing package IDs. The guide
describes the one-time replacement, previous customizations, Credential reuse,
file sync and recovery. The source reviewed for the settings implementation is
`scripts/drafts/settings.shared.txt`, SHA-256
`b21a8ed146a4545185efcb0ad12170098269799f273dd2ab8327c0cc9020855e`.
The final source after the missing-file correction is SHA-256
`638692d958399719326aa4d4108190f5e6cb11e9b2ec43e792cd7a1e32cd69da`.

- Node.js 22.18.0: 249 affected tests passed across nine files, including 30 new
  settings tests and a photo/Project frozen-model regression.
- `npm test`: 157 files / 2,182 tests passed with permission to bind synthetic
  loopback servers. The initial sandboxed full run failed on `listen EPERM` and
  related timeouts; a minimal loopback probe reproduced that sandbox restriction.
- `npm run lint`, `node scripts/sync-drafts-engines.mjs --check` and
  `git diff --check` passed. `npm run docs:check` reported no errors and six
  existing frozen-history link advisories.
- No extension runtime or provider protocol changed; no extension production
  build, installation or live AI request was needed for these action packages.

One authorized ChatGPT fresh-context workflow review completed with the
original request/approval, install/use instructions, full shared-settings source,
adapter wiring, Credential and gateway/pending boundaries, API references and
observed test/native limits. The reviewer cannot access the repository or native
Drafts; its result is source-based evaluation rather than device acceptance.
The [review conversation](https://chatgpt.com/c/6afa5bdc-1abc-83ee-96e0-8e20ab19765a)
returned message `755815d4-7873-42dd-baf2-a1550b5c4432`. It found no inevitable
single-device source blocker and raised two delivery issues:

1. A file not yet synced to another device was indistinguishable from an unused
   configuration and could silently use defaults. Network reads now stop on a
   missing file, explain first-save versus sync recovery, and leave the note and
   credential untouched. The settings form still offers the original defaults.
   A generated-action regression exercises all four network entries, and both
   affected and full suites passed after this correction.
2. Import instructions could leave an older duplicate active. The guide now
   explicitly says to choose Replace for the intended four actions and disable
   or rename retained backups. It also identifies the first explicit Save and
   says Preview need not be replaced for this update.

The reviewer recommended native/device smoke checks before publication. These
remain unperformed; this assignment delivers local source and import packages,
without publication or installed-action replacement. The corrections received
local verification, not a second independent review. Actual account use was one
review generation, with no provider test generation or duplicate review call.

Native Drafts import, physical devices and iCloud synchronization are not proved
by the controlled host fixtures. Local source/package delivery, review
dispositions and documentation are complete; native acceptance remains
separately unverified.
