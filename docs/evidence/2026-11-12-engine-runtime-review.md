---
doc_type: evidence
status: current
authority: evidence
last_reconciled: 2026-11-13
---

# Unified engine implementation review

## Inputs and independence

The user requested implementation of the [design](../engine-contract.md),
preserving three providers and old clients. One authorized ChatGPT collaboration
request received the original outcome, synthesized actual implementation facts,
proposed interfaces, authorization, persistence, lifecycle and migration rules.
It did not receive credentials, raw browser history or unrelated conversations.
The reviewer had fresh context but relied on supplied local facts; it could not
inspect the checkout. The first response is retained here as findings and
dispositions, not as a raw private conversation or runtime acceptance.

The configured bridge was restored by reopening its existing page. No token,
port or account setting changed. The review completed; reported thinking time
was 281 seconds. This is not completion review of the implementation.

## First findings and dispositions

| First finding | Implementation decision |
| --- | --- |
| Existing MCP credentials would gain Grok/Gemini access through a generic tool | The prototype added a separate gateway role/token and MCP grants. The user explicitly rejected that additional isolation on 2026-11-13: API and MCP share gateway authority. Current source uses the existing API token and common engine grants; see the correction below. |
| Concurrent claims and cleared storage need an authority and instance identity | One background serialized transaction queue owns claims/leases/bindings. A persistent installation epoch travels with dispatch. An old envelope is refused in a different epoch. |
| Thirty retained results cannot protect seven days of writes | Keep metadata tombstones separately, up to the protected ledger capacity; do not expire unresolved effects. Result eviction never permits execution. |
| Local expectedRevision does not verify native head | Bind the native account/document/head, check before append and isolate unresolved bindings. State the remaining race when the platform offers no conditional write. |
| Hidden legacy reuse must not be a generation.start | The compatibility projection resolves its own old binding and invokes public append. Public generation.start stays independent. |
| Provider extensions have different side effects/results/locks | Registered extension operations declare effect, schema and verification. Upload/history/delete do not inherit generation grants; shared resources have matching locks. |
| Rich output, SSE errors and transcript framing need precise mappings | Preserve format/version and verified content; unsuccessful SSE ends with an error and no success sentinel. Frame multi-message transcripts as JSON data, retaining the explicit absence of native role isolation. |
| MV3 lifetime cannot be guaranteed by an open Port | Retain native tab/document owners; persist before dispatch, mark orphaned runs unknown, and recover only where supported. Bound any local keepalive to active requests. |

The original review requested an unforgeable role boundary; its separate API/MCP
isolation proposal was later rejected by the user. Extension versus external
caller authentication remains. JSON framing can
prevent ambiguous serialization, not make a single native prompt enforce role
privileges. The contract retains this limitation rather than promising prompt
injection isolation.

The [Chrome lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
was checked directly: worker globals do not survive shutdown, an open Port alone
is not a lifetime guarantee, and active messaging/WebSocket traffic has its own
version-dependent behavior. These facts support durable state and bounded
observation; they do not prove the provider requests survive a worker loss.

## Fresh completion evaluation

A second, separate ChatGPT conversation received a self-contained implementation
capsule: the actual runtime/store/adapters, pre-write identity and lease order,
legacy projections, gateway/MCP trust, known checks and pending deployment limits.
It had no checkout access and relied on the supplied facts. Reported thinking time
was 363 seconds. It did not identify a confirmed additional P0 from that material;
it requested concrete closure of four conditional timing/capacity risks and did
not endorse a claim of full real-provider acceptance.

| Conditional finding | Verification and correction |
| --- | --- |
| Two opaque refs could append before delayed acceptance acquires a native lease | Append resolves the private native ID and acquires its reservation in the serialized claim **before** preparation/POST. A controlled two-ref race delays acceptance and asserts one native write. Learned conversation IDs also acquire per-run native leases; an alternative history ref cannot bypass an unknown write. |
| A gateway could return 202 without a durable background run, or lose completed content | A real HTTP/WS test holds the background receipt: the gateway has not acknowledged while the protected background run exists, then returns 202 only when that receipt arrives. Thirty-one completions and a restarted worker retain protected identity while honestly reporting an unavailable final body. MCP refuses to turn that metadata/preview into success. |
| A POST before accepted evidence might be mislabeled unsent, or cancellation might still dispatch | The adapter-failure fixture records one attempted write, settles unknown, retains its lease, and forbids another call. A preparation gate cancelled before dispatch asserts zero writes. Native completion/GenUI evidence and UI Stop races retain their existing correlation checks. |
| Full protection capacity could evict unresolved effects | Store and gateway ledger reject new identities at capacity. Result eviction is separate. The gateway was additionally tightened: ambiguous keys and receipt-only runs no longer expire on time alone; verified final-state reads reconcile metadata. A dated-record regression retains both identities. |

The reviewer accepted the explicit native read/check→write race, local-only Stop
promise, unsupported exact recovery errors, original native adapters, and the
retention of old internal helpers unused by the production public router. None
of these assessments is independent runtime evidence: the scenarios above are
local controlled checks, and the implementation author reconciled their results.

## Delivered implementation and controlled checks

The common owner is [runtime](../../src/engines/runtime.mjs) plus
[store](../../src/engines/store.mjs); the pure catalog/policy/schema describe
adaptation, external projection and caller-specific effective operations.
[Adapters](../../src/engines/adapters.mjs) retain native protocols and original
history/Project/image/default-model owners. UI Port, versioned bridge,
HTTP and MCP use those operations. The old completion transcript behavior stays
only in its compatibility facade; the explicit v1 header selects independent
prompt semantics. No breaking published default or release number was invented.

November 12 prototype full regression: `npm test`, Node 22.18.0,
**151 files / 2,007 tests passed**.
The suite includes the three native-protocol regressions and new common
contract/policy/store/runtime/Port/waiter tests, plus actual local HTTP/WS/poll/MCP
services with controlled native adapters. An additional fourth adapter traverses
the same owner and public projection without provider branches. Private proxy
response Ports do not re-enter UI dispatch. Generation, append, disabled policy,
MCP scope/ownership, cancellation, disconnect, capacity, restart, unavailable
results, account/head changes, images/Projects and old Drafts request formats
have explicit witnesses. Tests that formerly extracted supplier logic from the
bridge were retargeted to the production adapter/runtime/bridge path.

`npm run lint` and `git diff --check` passed. `docs:check` reports 64 documents,
zero errors and the same four pre-existing frozen-history link advisories;
`docs:test` passed 28 cases. No checker rule changed.

The first local network test attempt was constrained by sandbox loopback bind
`EPERM`; the successful integrations used approved local-port execution and
isolated temporary directories/test credentials. They did not call real
supplier accounts.

## Packaging and installed observation

This section records the November 12 prototype, before the November 13 source
corrections. Its installed token/grant UI and bundle hashes do not describe the
corrected source or establish that the later changes were installed.

`npm run build` produced normal and reduced Chromium/Firefox archives.
`npm run build:extension` used the repository's guarded staging/backup installer
to update the existing unpacked Chromium installation. Brave's extension page
confirmed that directory and a Reload; the version label remains 4.3.4 because
this task did not publish a release. Installed bundle and manifest hashes were
compared with the final Chromium build.

The production minified ChatGPT MAIN verification function was extracted from
`background.js` with Acorn. Scope analysis found only standard browser globals,
no captured bundle variables; evaluating the extracted function refused a wrong
origin. The account/workspace fingerprint guards also passed controlled native
module tests. This establishes serialization and boundary behavior, not live
successful native authentication on every release.

The existing API/MCP processes were identified, checked for pending requests,
restarted with their original arguments and related environment, and kept their
0.0.0.0 bindings on ports 18081/18082. Existing API, bridge and public MCP token
file hashes were unchanged; the new separately scoped gateway MCP credential
was created privately. Process logs remain outside the repository. No tokens,
account-linked conversation IDs or raw review captures are retained here.

Brave visibly reconnected the bridge and displayed healthy WebSocket status.
The Engines panel showed three separate native enable/access states, the migrated
ChatGPT MCP grant, closed Grok grants, and Gemini's independent API grant without
a new MCP grant. Expanding Gemini's operations showed adapted-but-ungranted
append and disabled unadapted history. These observations did not change those
grants. The bridge's setup copy now describes enabled web engines and their
external authorization rather than implying that ChatGPT login enables all three.

Final reloaded background SHA-256:
`131884f087578526e04e0473f480a4cde2c1f26741327682de9c5fc1e52af6f2`.
The final comparison covered 12 bundles/manifest files.

Authenticated reads of the actual `/engines` endpoint succeeded with both API
and gateway MCP credentials. API visibility was ChatGPT/Gemini; MCP visibility
remained ChatGPT only, with `effectiveOperations` limited to independent generation;
private management methods were absent from API effective operations. The actual MCP HTTP tool list contained strict
`ask_chatgpt(query)`, generic `ask_engine`, and `get_engine_run`.

## Remaining evidence limits

This delivery establishes source convergence, controlled effects, production
packaging, installation/reload, the real local transport and policy migration.
It does **not** establish a new full live-account generation/append trial for all
three platforms. In the November 12 prototype, Grok stayed disabled and Gemini's MCP grant stayed closed; no
account/permission settings were broadened for testing. The two authorized
ChatGPT review calls exercised the pre-update collaboration path, not the final
common path as a three-provider trial.

Current limitations remain deliberate: Gemini history/navigation recovery and
Grok exact run recovery are unadapted; cancellation is not proof of remote stop;
final bodies are bounded in memory; native concurrent changes cannot be
atomically excluded without a platform conditional write. Old internal native
helper exports remain for compatibility, while public production controls no
longer call their independent write branches. User-installed Drafts copies were
not modified; their repository request/response contract was verified through
compatible aliases. Release publication and a breaking default switch remain
outside this authorized implementation.

## November 13 review corrections

The user clarified that API gateway and MCP have the same authority. The
cross-credential idempotency-conflict finding was withdrawn; the additional
gateway MCP token, isolated principal and MCP engine grants were an implementation
choice, not a user requirement. Source now uses the existing gateway API token
and engine grants. The public MCP and extension bridge tokens are unchanged.
Previously persisted prototype MCP run/binding owners merge into the common
gateway principal without changing run IDs, fingerprints, state or leases.

Two other controlled reproductions were confirmed and corrected. Selecting
another ChatGPT model now clears the previous wire-model override while retaining
the conversation. Recovering an older run retires only its own binding in the
same serialized store update; a newer completed or active append keeps its head,
revision and pending owner. Tests also retain the expected retirement of the
recovered run's own unverified head.

The focused correction checks passed 40 tests. The final Node 22.18.0 regression
passed **152 files / 2,012 tests**, including actual local HTTP/WS/poll/MCP fixtures
with shared gateway credentials. Lint and production normal/reduced Chromium and
Firefox builds passed. Documentation checks report zero errors and the four
existing frozen-history link advisories. This source correction does not update the
installed extension, running API/MCP processes or user-installed Drafts actions.
Drafts still uses ChatGPT conversation endpoints; Gemini through Drafts remains
unimplemented.
