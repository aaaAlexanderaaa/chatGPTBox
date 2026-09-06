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
| `8b34dbc2-kcpqu5058w4p0qpa.js`                     | `e79414f74728b7ddd7c02c24fc102bf03f9f6ec6132ce62bc06608dde71c2872` | Conversation page orchestration            |
| `conversation-small-c1ziqs0jcp1f9pz2.js`           | `cf1ae55587c51b4a65e2417a91011fb7617b2741610e09277ec3f46d9bd1e411` | SSE transport, delta v1, poll, token store |
| `4813494d-k5qf4d34uhzjqhsa.js`                     | `08944b2c038545754d222be8d67def253870e9d5c9d52c680671e648365bd778` | WebSocket connection and topic offset      |

Source maps are referenced (`//# sourceMappingURL=…`) but were not published
next to the scripts. Verification is by searching the strings in the table
below.

Import aliases in `8b34dbc2` (search `as Tbe` in that file's import list):

| Page alias | Export from              | Local name in that chunk | Meaning                      |
| ---------- | ------------------------ | ------------------------ | ---------------------------- |
| `Tbe`      | conversation-small `Itn` | `ott`                    | HTTP-level SSE retry wrapper |
| `Aje`      | conversation-small `Rtn` | `qet`                    | delta v1 decoder (`Met`)     |
| `zIe`      | conversation-small `Vnn` | `z7e`                    | poll-on-error wrapper        |
| `gde`      | conversation-small `Bnn` | `B7e`                    | conversation GET poll loop   |
| `klt`      | conversation-small `ynn` | `B9e`                    | splice extra async iterator  |
| `WO`       | conversation-small `mdn` | `mWe`                    | conduit token store          |
| `cye`      | conversation-small `Htn` | `Aet`                    | async-iterator adapter       |
| `Lte`      | 4813494d `gD`            | `VF`                     | WebSocket manager factory    |
| `df`       | 4813494d `_D`            | `L7e`                    | `getTopic(topicId)`          |
| `Jh`       | 4813494d `p5`            | `ur`                     | HTTP error class             |
| `sh`       | 4813494d `l5`            | `gr`                     | network-error message string |

## How to verify a claim

From the repo root:

```bash
rg -n "resume stream retry" resources/chatgpt-web/current/*.js
rg -n "function kTt" resources/chatgpt-web/current/*.js
rg -n "Wet=class" resources/chatgpt-web/current/*.js
rg -n "No done event received" resources/chatgpt-web/current/*.js
rg -n "includeAllHistory" resources/chatgpt-web/current/*.js
```

There is **no** `resume_sse_endpoint` string in this build. Confirm with:

```bash
rg "resume_sse_endpoint" resources/chatgpt-web/current/*.js
```

## Layered reconnect

The live completion pipeline in `8b34dbc2` (`xTt`) is:

```text
Tbe/_S  (SSE POST /f/conversation)
  → kTt  (on failure: POST /f/conversation/resume with offset)
    → CTt  (on stream_handoff.subscribe_ws_topic: splice WebSocket topic)
      → NTt → Aje/Met (delta v1) → wTt (parse events) → zIe/B7e (poll)
```

`CTt` sits **outside** `kTt`. HTTP resume-on-failure wraps the SSE. The
WebSocket follow is an extra iterator spliced in by `klt`/`B9e`. That WebSocket
iterator is itself wrapped in another `kTt`, so a WS drop also falls back to
HTTP resume.

Explicit page-reload resume is `mTt` → `sendResumeRequest`. Same kernel:
`MTt` then `kTt`. If no token: `WEt` → `resumeWithPolling`.

```text
                    ┌─ Tbe retry (only before first byte; statsig default OFF)
POST /f/conversation ┤
                    └─ bytes flowing
                         │
                         ├─ idle 60s / socket close / no [DONE]
                         │     → kTt: POST resume {conversation_id, offset}
                         │         offset = counted SSE events so far
                         │         max 12, backoff 300ms → 5s, jitter 0.5–1.0
                         │         refresh X-Conduit-Token from events
                         │         resume dies → same kTt, offset keeps rising
                         │
                         ├─ stream_handoff.options contains subscribe_ws_topic
                         │     → WS subscribe(topic_id, includeAllHistory)
                         │         WS has its own last_offset / catchups
                         │         WS dies → kTt HTTP resume
                         │
                         └─ cannot resume (no token, 404 after a retry, 12 used)
                               → GET /backend-api/conversation/{id}
                                 + GET /conversation/{id}/stream_status
```

### `kTt` (nested resume)

Search `async function*kTt` in `8b34dbc2`.

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
m = MTt({ resumeToken, conversationId, offset: h })
```

That is secondary and tertiary resume.

`FTt` defaults (statsig `3165814200`):

- `MIN_RETRY_INTERVAL` 300
- `MAX_RETRY_INTERVAL` 5000
- `RETRY_FACTOR` 1.5
- `MAX_RETRY_COUNT` 12

### `MTt` (the resume POST)

Search `function MTt({conversationId` in `8b34dbc2`.

- URL: `{backend-api|backend-alt}/f/conversation/resume`
- Method: POST
- Headers: `x-conduit-token: token ?? "no-token"`, plus `x-oai-turn-trace-id`
- Body: `{ conversation_id, offset }`

### `Tbe` / `ott` (not nested resume)

Search `async function*ott` in `conversation-small`. This retries the **same**
HTTP request only until the first `{response}` item. After the stream has
opened, reconnect is `kTt`, not `ott`. Gated by statsig
`retry_stream_requests` default `false`.

### Missing `[DONE]` is an error

Search `No done event received` in `conversation-small` (`_S` / `L()`). For
URLs containing `/backend-api/f/conversation` or `/conversation/resume`, if
fetch resolves without a done event, the client throws. That throw is what
feeds `kTt`. A clean EOF is **not** “incomplete, go poll”.

Pings and empty `data` are dropped in `_S.onmessage` and never reach `kTt`, so
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
`kTt` resume is the normal path, not an edge case.

## `stream_handoff` vs HTTP resume

Search `function CTt` and `` r.type===`subscribe_ws_topic`  `` in `8b34dbc2`.

This build's live follow option is **`subscribe_ws_topic`**. HTTP resume is
**not** advertised as a handoff option. `CTt` only splices a WebSocket. HTTP
resume is the reconnect/reload transport (`kTt` / `mTt`).

Page reload (`UEt` / `WEt` in `8b34dbc2`):

- Token present → `sendResumeRequest` → `mTt` (HTTP resume from offset 0, then
  `kTt` for nested reconnects).
- Token missing → log `Resume token unavailable; starting polling`.

The local gateway does not implement the ChatGPT WebSocket topic. It uses HTTP
resume both as reconnect **and** as the live follow after a handoff, which is a
deliberate substitute for `subscribe_ws_topic`.

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
- `kTt` also keeps the token in memory and updates it from
  `resume_conversation_token` events (`token` + `conversation_id` required).
- Response header `X-Conduit-Token` is read in `wTt` as
  `interruptConversationToken`.

Without a token, this build will not HTTP-resume; it polls.

## Polling fallback

Search `async function*z7e` and `async function*B7e` in `conversation-small`.

`zIe`/`z7e` runs only when the stream throws, `shouldPollOnError` is true, and
a thread id exists. Origins logged by `B7e`:

- `resume_token_missing`
- `resume_error_fallback` (resume endpoint was in use, or `kTt` already tried)
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
3. Count SSE events like `_S`+`kTt`: every event except ping, empty data, and
   `[DONE]`. Interrupted HTTP streams POST resume with that counted offset.
   After a completed HTTP stream that still needs a live follow (`stream_handoff`,
   including `subscribe_ws_topic`), this gateway's HTTP-resume substitute starts
   at offset 0 — a new `kTt`, matching the inner WebSocket wrapper and `mTt`
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
| `kTt` nested resume, offset, max 12             | `src/services/clients/chatgpt-web/resume-delta.mjs` (`consumeChatgptWebResumeDeltaStream`)         |
| `Wet` / `Met` delta v1                          | `src/services/clients/chatgpt-web/resume-delta.mjs` (`createChatgptWebResumeDeltaAccumulator`)     |
| `CTt` live follow / HTTP substitute             | `src/services/clients/chatgpt-web/stream-handoff.mjs`, `client.mjs` `followStreamHandoffViaResume` |
| `z7e` / `B7e` poll after resume cannot continue | `src/services/clients/chatgpt-web/client.mjs` `pollConversationResult`                             |
| Public refresh / resume HTTP                    | `src/services/clients/chatgpt-web/conversation-api.mjs`, `docs/api-server.md`                      |
