# ChatGPT Web stream, resume, and reconnect

This note is a protocol reading of the ChatGPT Web production bundles in
[`resources/chatgpt-web/current/`](../resources/README.md). Use it to re-open
the minified sources and verify the claims. Function names below are **this
build's** minified locals; they will change on the next ChatGPT deploy.
Filenames change too — grep `resources/chatgpt-web/current/*.js`, not a
hardcoded hash.

The local gateway should match these boundaries:

- The initial conversation POST is a write. After it has been dispatched, do
  not send that write again.
- `/backend-api/f/conversation/resume` is a **read** of an in-flight turn. It
  is safe to POST again with an event `offset`.
- Nested resume (conversation stream dies, then the resume stream dies) is the
  same loop, not a second API.

## Bundles to grep

The live set is whatever is in `resources/chatgpt-web/current/` (one file per
role). Hashes below are the set this note was first written against; after a
swap, `ls resources/chatgpt-web/current` is authoritative.

| File (see `current/`)                              | SHA-256                                                            | Role                                       |
| -------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| `8b34dbc2-kjj15hg4y6iyx13p.js`                     | `9990fb9a8682917d0d790acf7b6aa78355e8520e4ffd2c5e0a183212d612d4b5` | Conversation page orchestration            |
| `conversation-small-hiw4wce20lu6te81.js`           | `296ec15ad991764de750c55f3c85b1643c8f385236b9402168fa4348696e37d1` | SSE transport, delta v1, poll, token store |
| `4813494d-hrplraurzfyvxb10.js`                     | `89c95d937bac1191e91d5ceb4872eb0c328d39a98ce05399093a663f18921aa0` | WebSocket connection and topic offset      |

Previous hashes (2026-08) are in `resources/chatgpt-web/archive/`. Source maps are
referenced (`//# sourceMappingURL=…`) but were not published next to the
scripts. Verification is by searching the protocol strings below, not a
minified local — those names change every deploy.

## How to verify a claim

From the repo root:

```bash
rg -n "resume stream retry" resources/chatgpt-web/current/*.js
rg -n "resume_sse_endpoint" resources/chatgpt-web/current/*.js
rg -n "conversation-turn-handoff-control" resources/chatgpt-web/current/*.js
rg -n "No done event received" resources/chatgpt-web/current/*.js
rg -n "includeAllHistory" resources/chatgpt-web/current/*.js
```

This build **does** contain `resume_sse_endpoint`. Search `function LJt` in
`8b34dbc2`: when a statsig flag (`tv`) is on and a `stream_handoff` option has
that type, the page starts HTTP resume at offset 0 instead of
`subscribe_ws_topic`. Early control can also arrive out-of-band on
`conversation-turn-handoff-control` before the root SSE yields bytes.

## Layered reconnect

The live completion pipeline in `8b34dbc2` (`LJt` / `UB` / `KJt`) is:

```text
root SSE POST /f/conversation
  → UB  (on failure: POST /f/conversation/resume with offset)
    → LJt  (stream_handoff: resume_sse_endpoint and/or subscribe_ws_topic)
      → delta v1 decode → parse events → poll-on-error
```

`LJt` sits **outside** the nested resume wrapper. HTTP resume-on-failure wraps
the SSE. A `subscribe_ws_topic` follow is an extra iterator spliced in; that
iterator is itself wrapped in another `UB`, so a WS drop also falls back to
HTTP resume. When `tv()` is true, `resume_sse_endpoint` takes the same
`KJt` HTTP-resume kernel at offset 0 (`root_sse`).

Explicit page-reload resume is `yJt` → `KJt` then `UB`. If no token, poll.

```text
                    ┌─ first-byte same-request retry (retry_stream_requests, default OFF)
POST /f/conversation ┤
                    └─ bytes flowing
                         │
                         ├─ idle 60s / socket close / no [DONE]
                         │     → UB/KJt: POST resume {conversation_id, offset}
                         │         offset = counted SSE events so far
                         │         max 12, backoff 300ms → 5s, jitter 0.5–1.0
                         │         refresh X-Conduit-Token from events
                         │         resume dies → same UB/KJt, offset keeps rising
                         │
                         ├─ stream_handoff.options contains subscribe_ws_topic
                         │     → WS subscribe(topic_id, includeAllHistory)
                         │         WS has its own last_offset / catchups
                         │         WS dies → UB/KJt HTTP resume
                         │
                         └─ cannot resume (no token, 404 after a retry, 12 used)
                               → GET /backend-api/conversation/{id}
                                 + GET /conversation/{id}/stream_status
```

### Nested resume (`UB` / `KJt`)

Search `function KJt({conversationId` and `function GB(e)` in `8b34dbc2`.
`KJt` is the resume POST; `UB` is the retry wrapper around it.

Conditions before a reconnect POST:

- `resume.currentAttemptCount < MAX_RETRY_COUNT` (from `FTt`, default **12**)
- not aborted
- not temporary chat (`!isTemporaryChat`)
- `resumeToken != null` and `conversationId != null`
- network error (`HI` / message equals `sh`) **or** HTTP 408, 409, 425, 429,
  502, 504 (`jTt`)

On each yielded item that is not the `{response}` wrapper, `h++`. Token events
update `p`/`f` and **are counted** but not yielded to the UI. Then:

```text
KJt({ conversationId, resumeToken, offset: h, ... })
```

That is secondary and tertiary resume.

`FTt` defaults (statsig `3165814200`):

- `MIN_RETRY_INTERVAL` 300
- `MAX_RETRY_INTERVAL` 5000
- `RETRY_FACTOR` 1.5
- `MAX_RETRY_COUNT` 12

### `KJt` (the resume POST)

Search `function KJt({conversationId` in `8b34dbc2`.

- URL: `{backend-api|backend-alt}/f/conversation/resume`
- Method: POST
- Headers: `x-conduit-token: token ?? "no-token"`, plus `x-oai-turn-trace-id`
- Body: `{ conversation_id, offset }`

### First-byte same-request retry (not nested resume)

`retry_stream_requests` (statsig `603105008`, default `false`) retries the
**same** HTTP request only until the first `{response}` item. After the stream
has opened, reconnect is `UB` / `KJt`, not another POST of the original
conversation body.

### Missing `[DONE]` is an error

Search `No done event received` in `conversation-small` (`_S` / `L()`). For
URLs containing `/backend-api/f/conversation` or `/conversation/resume`, if
fetch resolves without a done event, the client throws. That throw is what
feeds `UB` / `KJt`. A clean EOF is **not** “incomplete, go poll”.

Pings and empty `data` are dropped in the SSE `onmessage` path and never reach `UB` / `KJt`, so
they do not increment `offset`. `[DONE]` closes the stream and is also not
counted.

### Idle timeout

Search `Zet({initialOpenTimeoutMs` and `sse_between_bytes_timeout_ms` /
`HTt=1e3*60` in `8b34dbc2` / `conversation-small`. Defaults:

| Timer                      | Default |
| -------------------------- | ------- |
| SSE first-response warning | 30s     |
| SSE initial open           | 60s     |
| SSE between bytes (idle)   | 60s     |
| WS initial idle            | 5s      |
| WS idle                    | 30s     |

GPT-5.6 max thinking commonly exceeds 60s of silence, so idle-timeout →
`UB` / `KJt` resume is the normal path, not an edge case.

## `stream_handoff` vs HTTP resume

Search `function LJt` and `` o.type===`resume_sse_endpoint` `` in `8b34dbc2`.

This build advertises **both** live-follow options:

- `resume_sse_endpoint` — HTTP resume at offset 0 (`KJt` + `UB`), used when
  the `tv` flag is on and a conversation id is already known.
- `subscribe_ws_topic` — splice a WebSocket topic. Still the path when `tv`
  is off, or when the handoff has no SSE option.

Out-of-band early handoff: `conversation-turn-handoff-control` with
`handoff_attempt_id` and topic ids `conversation-…` or `conv-turn-low-ttl-…`.
Header `x-oai-stream-handoff-attempt-id` is set on that attempt.

Page reload (`yJt` in `8b34dbc2`):

- Token present → HTTP resume from offset 0, then `UB` for nested reconnects.
- Websocket topic present and `tv()` off → subscribe that topic instead.
- Token missing → poll.

The local gateway does not implement the ChatGPT WebSocket topic. It uses HTTP
resume both as reconnect **and** as the live follow after a handoff. That now
matches the official `resume_sse_endpoint` path when the flag is on; it remains
a substitute for `subscribe_ws_topic`.

## Delta encoding v1

Search `Wet=class`, `Vet=[[\`channel\`,\`c\`]`, and `async function\*Met`in`conversation-small`.

Wire events:

```text
event: delta_encoding
data: v1

event: delta
data: {"c":0,"o":"add","p":"","v":{...object...}}

event: delta
data: {"o":"append","p":"/message/content/parts/0","v":"Hello"}

event: delta
data: {"v":" world"}
```

Short keys: `c` channel, `p` path, `o` op, `v` value.

`Pet` copies **channel / path / op** from the previous decoded delta when the
short key is absent. `value` is never copied. `Fet` expands short keys to long
names. Nested `op: "patch"` values are remapped with `Fet` only (no
carry-forward).

`Wet.applyDelta` keeps `previousValueByChannel[channel]` and applies one
operation to that tree. After decode, upstream sees a **full object**, not a
patch.

Operations in `Let`: `add`, `remove`, `replace`, `append`, `patch`, `truncate`.
Empty path replaces `__root`. JSON Pointer `~0` / `~1` decoding applies.
Numeric path segments are array indexes (`splice` on `add`/`remove`).

`Met` requires `delta_encoding` / `v1` before the first `delta`; an unknown
encoding throws. Non-delta SSE events pass through unchanged (`resume_conversation_token`,
`stream_handoff`, `[DONE]`, legacy `{message}` objects).

## Conduit token store

Search `mWe={set:cWe` and `resume_token_ttl_ms` in `conversation-small`.

- Keyed by conversation id in `localStorage` (`vl.ResumeTokenStore`).
- Default TTL `4 * 3600_000` ms (4 hours), overridable by statsig
  `1409565123` / `resume_token_ttl_ms`.
- Expired entries are dropped on read.
- `UB` / `KJt` also keep the token in memory and update it from
  `resume_conversation_token` events (`token` + `conversation_id` required).
- Response header `X-Conduit-Token` is read in `wTt` as
  `interruptConversationToken`.

Without a token, this build will not HTTP-resume; it polls.

## Polling fallback

Search `async function*z7e` and `async function*B7e` in `conversation-small`.

`zIe`/`z7e` runs only when the stream throws, `shouldPollOnError` is true, and
a thread id exists. Origins logged by `B7e`:

- `resume_token_missing`
- `resume_error_fallback` (resume endpoint was in use, or `UB` / `KJt` already tried)
- `stream_error_fallback`
- `local_conversation_insert_failure`
- `direct_polling`

Poll loop constants next to `$x=class` in the same chunk:

- min interval 5s (`H7e`)
- max consecutive network errors 30 (`V7e`)
- expected-message grace 60s (`U7e`)
- interval/freshness also come from message metadata (`poll_interval_ms`,
  `poll_freshness_max_mins`)

Each attempt: GET conversation snapshot (`ky`). When the leaf looks like a
streaming model, also GET `/conversation/{id}/stream_status`. Continue while
`stream_status === "IS_STREAMING"` or `async_status` is set and not `UNREAD`.
On success, yield `conversation_async_status` + `done`. On timeout, POST
`/conversation/{id}/async-status` with `{status: null}`.

HTTP 410 `persisted_final_available` is a special poll trigger (`A7e`).

`shouldPollOnError` (`ATt` in `8b34dbc2`): network errors poll; 403 / history
expired / deleted do not; other 4xx do.

## WebSocket topic offset

Search `async subscribe(e={})` and `this.offset=r.last_offset` in `4813494d`
(`J7e`).

- First subscribe with `includeAllHistory` and no offset uses `offset: "0"`.
- Server reply `last_offset`; catch-up payloads replay missed events.
- Incoming messages can carry `offset` and update the local cursor.
- Reconnect resubscribes with the stored offset.

This offset is **not** the HTTP resume event counter. Mixing them is wrong.

## Gateway implementation boundary

Keep:

1. Initial `/f/conversation` POST at-most-once after dispatch (429 / timeout /
   disconnect after send → `ambiguous_dispatch`, do not replay the prompt).

Change:

2. HTTP resume is reconnect: default max 12, same retryable statuses as `jTt`,
   body `{ conversation_id, offset }`, carry `X-Conduit-Token`.
3. Count SSE events like the official SSE + `UB`/`KJt` path: every event except ping, empty data, and
   `[DONE]`. Interrupted HTTP streams POST resume with that counted offset.
   After a completed HTTP stream that still needs a live follow (`stream_handoff`,
   including `subscribe_ws_topic`), this gateway's HTTP-resume substitute starts
   at offset 0 — a new `KJt`, matching the inner WebSocket wrapper and `yJt`
   reload. Nested reconnects of that resume POST then use the consumed offset.
4. Decode delta v1 with short-key carry-forward and the six operations above.
5. Treat “stream ended without `[DONE]`” as a retryable resume error, then
   poll only after resume retries are exhausted or resume cannot start (no
   token).
6. Poll after a failed/incomplete resume uses the existing conversation poll
   timeout/interval, not a single snapshot.
7. Do not require a `resume_sse_endpoint` handoff option. Start HTTP resume
   when `conversation_id` and conduit token are present.
8. Public `/chatgpt/conversations/:id/refresh` must return the **consumed**
   offset, accept a conduit token, and not use a 10s resume timeout for
   thinking turns.

Out of scope until a later pass: implementing `subscribe_ws_topic` itself.
HTTP resume is the substitute for live follow.

## chatGPTBox source map

| Official behavior                               | Local files                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `UB` / `KJt` nested resume, offset, max 12      | `src/services/clients/chatgpt-web/resume-delta.mjs` (`consumeChatgptWebResumeDeltaStream`)         |
| delta v1 (`delta_encoding` / `v1`)              | `src/services/clients/chatgpt-web/resume-delta.mjs` (`createChatgptWebResumeDeltaAccumulator`)     |
| `LJt` live follow / HTTP substitute             | `src/services/clients/chatgpt-web/stream-handoff.mjs`, `client.mjs` `followStreamHandoffViaResume` |
| `z7e` / `B7e` poll after resume cannot continue | `src/services/clients/chatgpt-web/client.mjs` `pollConversationResult`                             |
| Public refresh / resume HTTP                    | `src/services/clients/chatgpt-web/conversation-api.mjs`, `docs/api-server.md`                      |
