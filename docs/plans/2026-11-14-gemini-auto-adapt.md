---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-11-14
---

# Gemini automatic compatibility

## Requested outcome and boundary

On November 14 the user requested implementation, Gemini-skill verification,
commit and push of automatic compatibility for build-ID or obfuscated-name-only
changes. Logic changes or an unconfirmed mapping must still refuse. The current
[Gemini contract](../gemini-web.md#automatic-compatibility-for-identifier-changes)
owns this behavior. This does not authorize model fallback, question replay,
account changes or a release/version bump.

## Decision and delivery

Eight roots from the saved TX and K public compilations have the same AST shape
when all identifier names are erased, but their complete application units have
different structure. Root-only normalized hashes would miss helper changes.
The implementation therefore compares a complete inspected compilation under
reference-selected, injective mappings for namespace exports, instance fields
and lexical helpers separately. It preserves external names,
constants, operators and module composition, and accepts conservative refusals.

The initial reference is the complete TX runtime/application pair; both source
units remain outside Git. The bundled record holds public-code digests, masks
and symbol names. Reference generation requires all eight original profile
fingerprints to match. A candidate is never executed to test compatibility.

The background discovers only after a positively unattempted compatibility
preflight. It reads already loaded public resources without credentials and
derives a volatile document-scoped mapping. MAIN rechecks the nonce, runtime,
inventory, real instances and exact native fingerprints before the original
operation runs. Submission journaling and result identity retain their owners.

The namespace is required to remain statically addressed inside its inspected
wrapper; reflection, computed indexing and shadowing refuse reference creation.
The binding domains avoid conflating an exported class `AM` with the unrelated
timezone string `"AM"` or an object's same-spelled field. Prototype-control keys,
fixed identifiers, raw literals and parser semicolon-insertion decisions remain
protected. This covers return/newline and escaped-strict-directive changes that
a name-erased token comparison could otherwise miss.

## Verification and delivery limits

- Final `npm test`: **155 files / 2,102 tests passed**, with loopback listening
  permitted. The initial sandboxed full run was stopped after an explicit
  `EPERM listen 127.0.0.1` probe established its local-server restriction.
  Lint passed. Documentation checked 69 files with zero errors and the same four
  frozen-history advisories. The Gemini skill validator passed.
- The complete saved TX runtime/app pair matched its reference. An offline
  experiment consistently renamed **20,905** permitted symbols, including the
  view Map, input/service classes, preparation/attestation/thinking exports and
  native submit method. All eight new fingerprints were extracted. The renamed
  compilation was 6,767,710 bytes, within the production 8 MiB read budget.
  The check passed with a 512 MiB V8 old-space ceiling; this is not a browser
  heap or latency guarantee.
- A mutation to a runtime dependency, while all eight original native root
  fingerprints stayed equal, refused compatibility. Controlled cases cover
  incomplete/extra code, competing matches, name collisions, prototype keys,
  changed guards/constants/external APIs/dynamic keys, source failures,
  changed documents/nonces/runtime objects, and no rediscovery after invocation.
- Both production passes produced normal/reduced Chromium/Firefox archives.
  Each archive contains the bundled reference and two self-contained Gemini
  MAIN functions with no external bundler helpers. All eight extracted functions
  passed standalone unsupported-origin checks. Each archive also passed the
  same **32 native-boundary regressions**, after asserting exact reconstruction
  of its extracted function text; these are repeated artifact checks, not 128
  independent cases. Importing compressed functions directly through Vitest
  rewrote their text; the corrected fixture reconstructs only the project's own
  extracted functions, never the candidate website source.

The final source/package verification is complete. Git delivery uses the normal
pre-commit hook and remote SHA verification under the user's explicit commit/push
instruction. No release/version bump is included.

There were **zero live Gemini submissions and zero ChatGPT review submissions**
for this change. A separate ChatGPT review was unavailable: the connector had
reported unattempted native failures and a fresh official page returned
`ERR_CONNECTION_CLOSED`. Same-context analysis is not independent review.
The trial tab was closed and the user's original browser tab restored.

Saved public-source comparison and synthetic fixtures do not establish a future
live compilation, provider policy or account safety. The initial automatic
reference is only the complete TX composition; other inspected profiles keep
their explicit mappings, and unconfirmed variations still refuse. The installed
Brave directory, API/MCP processes, ports/tokens/grants and Drafts copies were
not updated. Unknown historical runs remain protected.
