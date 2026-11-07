---
doc_type: evidence
status: current
authority: evidence
last_reconciled: 2026-11-06
---

# Gateway process exits, November 6, 2026

The user reported occasional API server exits and supplied startup and bridge
disconnect/reconnect logs. The requested outcome was to investigate and correct
the failure. No credential from that log is retained here.

## Observations and limits

A read-only inspection found the process from the supplied startup still
listening, after approximately 6 hours 21 minutes. Its authenticated
`/health` returned `200` with the WebSocket bridge connected. Its npm parent and
Node child wrote to a terminal, without a persistent lifecycle log. This
establishes the state at inspection, not the cause of any earlier exit. The user
later clarified that this was their manual replacement after the earlier service
became unreachable; it was not proof that the earlier process had survived.

Controlled reproductions used Node.js 22.18.0, temporary data directories,
random loopback ports, dummy credentials and a fake extension bridge:

| Trigger on the original code | Observed result |
| --- | --- |
| Unauthenticated raw HTTP `GET //[/` with an ordinary Host header | `new URL` threw `TypeError: Invalid URL`; child exited with code 1 |
| Authenticated ChatGPT or Grok conversation path ending in `%E0%A4%A` | Route ID decoding threw an uncaught `URIError`; connection ended without a response |
| Paired WebSocket message containing JSON `null` | Accessing `msg.type` threw a `TypeError`; child exited with code 1 |
| HTTP polling response containing JSON `null` | Handler returned `500`; process remained alive |
| Bridge disconnect during a keyed conversation write | Existing behavior retained an ambiguous result and did not replay it |

These are reproducible defects, not evidence that the user's historical exits
had those exact triggers. No malformed traffic was sent to the user's running
server. The controlled requests never reached ChatGPT or Grok.

## Repair and review scope

The [API owner](../api-server.md#unexpected-exits-and-bridge-disconnections)
describes the resulting failure and diagnostic behavior. The
[server](../../scripts/api-server.mjs) now owns the full asynchronous HTTP
request rejection, handles invalid URLs and decoded IDs, validates bridge
message envelopes/fields, and contains WebSocket upgrade/message exceptions.
It preserves valid encoded ID semantics and existing ambiguous-write handling.

The [process diagnostics](../../scripts/lib/gateway-process-diagnostics.mjs)
record lifecycle events synchronously in a bounded private log. They monitor
fatal exceptions without suppressing Node's default exit, and log termination
signals before restoring signal termination. It does not collect request
contents, removes exception-message prefixes and redacts the gateway tokens.
Custom stack frames may still contain other private data; the log remains
private and requires inspection before sharing. Node's original fatal stderr
remains separate.

One authorized `ask_chatgpt` design review received the original symptom,
production observations, actual failure-boundary code, reproduction and proposed
repair, without credentials or conversations. Its first findings were:

- Envelope checks alone leave WebSocket callbacks and upgrades unprotected.
- URL repair must preserve valid routing and encoded ID behavior.
- A global no-retry header would unnecessarily change safe read semantics.
- Signal listeners and diagnostic failures must preserve termination behavior;
  uncatchable kills and original fatal stderr need explicit limits.
- Tests should exercise actual process survival, callback failure, signal exit,
  dummy-secret exclusion and the npm startup chain.

The implementation adds explicit event boundaries, a dedicated path-error type,
no-retry suppression only when a write operation ID exists, and synchronous
best-effort lifecycle logging. The URL parser's existing target forms remain
unchanged; only existing ID decoding is classified as an input error. No global
pathname decoding, payload-limit migration, automatic restart, or write replay
was introduced. The reviewer had an isolated conversation, but depended on
supplied local facts; it was not an independent execution of the repository.

A second authorized `ask_chatgpt` review received the original outcome,
observations, full patch, diagnostic implementation, complete new tests and API
guide changes. It found no confirmed new blocking defect, with three limits:

- It could not see the unchanged per-connection `ws.on('error')` listener in the
  diff and required checking that path. The listener remains in the server;
  an added raw illegal-RSV1 frame test verifies its asynchronous error does not
  terminate the process.
- The immediate no-redispatch assertion had an asynchronous observation gap.
  An ordered application ping/pong now drains preceding server frames before
  checking that no new write was dispatched.
- Custom stack frames could contain private data beyond the two known tokens.
  The API guide now states that boundary instead of guaranteeing arbitrary
  custom exception data is absent.

Both reviews were isolated-context static evaluations through the configured
account, not independent runtime executions. Exactly two review calls were used.
Full-suite and npm-chain checks were performed locally after the completion
review inputs were assembled; they are separate evidence.

## Verification

The [request isolation tests](../../tests/gateway-resilience.test.mjs) exercise
malformed URLs/IDs, invalid WebSocket frames and HTTP messages, a deliberately
thrown WebSocket send callback, valid `%2F` IDs, reconnect and keyed write retry without
redispatch. The [diagnostic tests](../../tests/gateway-process-diagnostics.test.mjs)
check fatal exceptions, unhandled rejections, `SIGINT`/`SIGTERM`/`SIGHUP` termination,
private bounded rotation, sensitive-message exclusion and an unwritable log path.

The final focused run passed 42 tests across six files: the two new files plus
`gateway-http-access`, `gateway-image-input`, `gateway-image-recovery` and
`api-server-compatibility-contract`. The full `npm test` run then passed 129 files
and 1,694 tests. `npm run lint`, the server's Node syntax check and
`git diff --check` passed. `npm run docs:check` reported no errors and four
existing historical-link advisories.

A separate bounded experiment started `npm run api-server` with a temporary
data directory, random loopback port and dummy tokens. It confirmed the log's
PID belonged to the Node child rather than the npm launcher. Sending `SIGTERM`
to that isolated process group left the Node child's `signal` record, terminated
the launcher with `SIGTERM` and closed the HTTP port. Only the created process
group was terminated; its temporary directory was removed. The experiment does
not establish how a different terminal or supervisor forwards signals.

At the initial isolated-test closure, the running production process had not
been restarted or replaced. The follow-up below records its later deployment.
No live provider compatibility, real client automatic retry, sustained-load,
kernel OOM, power-loss or historical-cause claim is made by these tests.

## Follow-up: runtime discovery and deployment

The user clarified that the earlier server had been restarted from another
coding chat, and the inspected instance was their later manual restart. They
also reported the webpage compatibility error in Mac Drafts Get and MCP.
Mobile Drafts List/Get/Send were spinning even though a browser could reach
the gateway's `401` response. The user restarted mobile Drafts, reported that it
worked again, and explicitly ended that branch of investigation. Its cause was
not diagnosed, and no mobile action or network settings were changed.

On the actual dedicated ChatGPT proxy document, the page was logged in and
displaying normally, but script/preload nodes and resource timing exposed no
official runtime JS URLs. The existing discovery and connection functions
therefore had no candidates. A real extension runtime message reproduced
`CHATGPT_WEB_RUNTIME_UNSUPPORTED`, matching the reported error. The current
React Router entry/root manifest still declared the public
[633146.7cb1d15d36.js runtime](https://chatgpt.com/cdn/assets/633146.7cb1d15d36.js).
Which page component removed or cleared the other references remains unknown.

Both serialized MAIN functions now also read the current manifest's entry/root
module and at most 256 imports from each. They do not inspect unrelated routes
or private bootstrap data. Existing official-origin/path checks, unique role
discovery, native identity/cancellation checks, read-only model preflight and
single-attempt transport verification remain in place; no new release mapping
or relaxed capability rule was needed.

Verification and deployment:

- The three focused integrity/capability/native transport files initially passed
  169 tests, and 174 after the review hardening. The final integrated suite passed
  129 files and 1,706 tests. Lint, documentation
  checks and the full production build passed. The build emitted its existing
  outdated Browserslist-data notices; dependencies were not changed.
- Brave's extension details confirmed the expected installed directory. A
  rollback copy was retained privately outside the repository, then
  `npm run build:extension` replaced that installation and Brave visibly reloaded
  it. Both MAIN entrypoints were extracted from the installed production bundle
  and ran in an isolated VM without extension bundler helpers.
- Before refreshing the formerly failing proxy document, the corrected running
  extension returned `ok: true, transport: native` on that same document. The
  proxy and bridge pages were then refreshed; the read-only integrity check
  passed again. Temporary verification channels were closed, the console filter
  was restored, and DevTools was closed.
- The idle manual gateway was replaced with an independent background process,
  preserving `0.0.0.0:18081`, default token files and the actual request timeouts.
  The original process had no `CHATGPT_GATEWAY_*` environment overrides. A later
  process inspection confirmed the new Node process had parent PID 1, rather
  than the coding tool's temporary execution session. Its bridge reconnected and
  `/health` returned `200`. This is not an automatic-restart or login service.
- Both process and console logs were present with `0600` permissions. No token
  rotation, authentication change or write replay was performed.
- A forced network refresh of one existing project-review conversation through
  the real Get route returned `200` in approximately 1.3 seconds, two messages,
  `pending: false`, `cache.source: network`, `stale: false` and no refresh error.
  No conversation body or account identifier is retained here. This verifies
  the read chain, not interaction with an installed Mac Drafts copy; Drafts is
  absent on this host, and Get/Send/Preview scripts were unchanged.

One additional authorized MCP project-review request used public code and this
reproduction rather than a synthetic connectivity prompt. It received an exact
write acknowledgement, reached `running` and returned a final answer, with
242 seconds of server-reported thinking. It was sent once and not replayed.
This verifies the live MCP create/wait/final-read chain; it does not establish
long-term provider availability.

That fresh-context review found no confirmed blocker in the finite repair, and
identified two relevant hardening opportunities in existing discovery behavior:
origin/path-only deduplication could choose different query/hash module
instances between discovery and connection, and a same-prefix unknown filename
could skip public-source preinspection. Both are corrected: source order is
aligned, conflicting full URLs for a runtime path are rejected, and only an exact
known filename can skip public webpack-export preinspection. Added regression
cases cover query/hash conflicts and refusal to import an unrelated same-prefix
chunk. The reviewer also suggested exact-origin matching instead of hostname
matching; existing nonstandard-port acceptance was not expanded by this repair
and was left outside this bounded change. The review was static and depended on
supplied local facts, not an independent execution.

After those two guards were added, the final production build was installed and
visibly reloaded again. A read-only check on the retained proxy document returned
`ok: true, transport: native`; the proxy and bridge pages were restored and
DevTools closed. A subsequent forced network Get returned `200` in approximately
0.95 seconds with the same complete, non-stale result. Gateway health was `200`
with WebSocket connected. The MCP request was not repeated after this hardening;
the final candidate-selection path was revalidated through the native connection
and network-read checks. No Drafts action/script replacement was required.
