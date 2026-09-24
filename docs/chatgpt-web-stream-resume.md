# ChatGPT Web stream, resume, and reconnect

This note describes the user-supplied 2026-09-23 bundles in
[`resources/chatgpt-web/current/`](../resources/README.md). It is a reading of
those files, not a live-server verification. The
[Chinese migration notes](chatgpt-web-2026-09-23.md) compare them with the former
current set, now preserved in `resources/chatgpt-web/archive/`.

## Reference layout

| Role | Current file | Stable search markers |
| --- | --- | --- |
| Conversation orchestration | `8b34dbc2-jcq3z9svhxjfed5y.js` | `/f/conversation/resume`, `stream_handoff`, `subscribe_ws_topic` |
| SSE transport, token store, polling | `conversation-small-dem1o3a5ym7cm94l.js` | `No done event received`, `resume_token_ttl_ms` |
| WebSocket, delta decoder, resume controller | `4813494d-fyc7wvz5e3kse9ep.js` | `includeAllHistory`, `delta_encoding`, `resume_conversation_token` |

The delta decoder and generic resume controller moved from `conversation-small`
to `4813494d`. The three supplemental `_conversation*` files in `current/routes/`
are route entry points, not additional protocol roles. The probe reads only the
three top-level `.js` files. After a future swap, use the generated map and stable
markers rather than this build's minified function names.

## Request flow

The extension's chat UI sends a request to the background provider, which
forwards it through `chatgpt-proxy-service.mjs` to a dedicated `chatgpt.com` tab.
The tab's `client.mjs` sends `POST /backend-api/f/conversation`.
The local API gateway reaches the same client through its extension bridge.

The initial conversation POST is a write and must not be replayed after dispatch.
A resume POST reads an existing turn and can be retried without resubmitting the
user's prompt. In the new orchestrator, `K0t()` selects `/backend-api` for logged-in
requests or `/backend-anon` for anonymous requests; the previous model-based
`/backend-alt` branch is gone. The extension already defaults to `/backend-api`.

```text
POST /backend-api/f/conversation (at most once)
  → SSE events → delta v1 decoder → messages
      → interrupted stream: POST /backend-api/f/conversation/resume
          { conversation_id, offset: consumed events }
      → completed stream with handoff: HTTP resume from offset 0
      → resume unavailable or incomplete: conversation polling
```

The official page can also follow a `subscribe_ws_topic` handoff using a WebSocket
subscription. The extension continues to use HTTP resume for that live follow.
It does not implement the official topic subscription or early out-of-band
`conversation-turn-handoff-control` ownership mechanism.

## HTTP resume

In this snapshot, the orchestrator's `aV` wraps streams with the shared controller
(`ebe` in `4813494d`), and `y2t` sends the resume request.

- Method/path: `POST /f/conversation/resume`.
- Body: `{ conversation_id, offset }`.
- Include `X-Conduit-Token` when present; omit it otherwise. Do not send a
  placeholder token. The turn trace header is optional.
- Automatic resume requires a known conversation id and a non-temporary chat.
- Tokenless resume is allowed at offset 0 only. If events have been consumed and
  no token has arrived, the controller does not retry at a nonzero offset.
- Token events update both `conversation_id` and the resume token.
- Retry network failures and HTTP 408, 409, 425, 429, 502, 504.
- Default maximum: 12 **consecutive** failed retries. Acknowledging an event clears
  the consecutive failure count. This behavior exists in both supplied versions.
- Delay: `min(300 * 1.5 ** attempt, 5000) * (0.5 + Math.random() * 0.5)` ms,
  with attempt starting at 1.
- A failed tokenless resume can produce `tokenless_resume_unavailable` or
  `conduit_miss`. The official reload flow can then use polling.

Every delivered SSE event increments the HTTP offset except ping, empty data,
and `[DONE]`. Token and encoding events count. HTTP offsets are not WebSocket
`last_offset` values; they must not be mixed.

An interrupted root stream and its resume share decoder state. A completed root
stream that hands off live following starts a new stream at offset 0 with a fresh
decoder. Further reconnects within that stream preserve its offset and decoder.

The previous note incorrectly said the old current bundle always required a
token. Its controller already had `allowTokenlessResume: true`, with the same
nonzero-offset restriction. This adaptation fixes a local implementation gap.

## Delta encoding v1

Search `delta_encoding`, `previousValueByChannel`, and `previousDelta` in
`4813494d`. The wire format is unchanged between the supplied versions:

```text
event: delta_encoding
data: "v1"

event: delta
data: {"c":0,"o":"add","p":"","v":{"message":{"content":{"parts":["Hello"]}}}}

event: delta
data: {"o":"append","p":"/message/content/parts/0","v":" world"}

event: delta
data: {"v":"!"}
```

Short keys are `c` (channel), `p` (path), `o` (operation), `v` (value). Missing
channel/path/operation carry forward; value does not. Nested `patch` operations
expand short keys without inheriting the outer operation's keys.

Operations are `add`, `remove`, `replace`, `append`, `patch`, and `truncate`.
An empty path refers to the root. JSON Pointer escaping and array indexes apply.
The official decoder requires a `delta_encoding` announcement; the local decoder
also accepts unannounced v1 deltas for compatibility with existing integrations.
Both reject a declared unsupported encoding.

The SSE `data` field can contain the JSON string `"v1"`. The official transport
JSON-decodes it before checking the encoding; the extension's raw SSE callbacks
do not. The shared accumulator therefore parses this announcement before
validation, while retaining compatibility with bare `v1`. Both initial and
resume streams use this same path.

Both initial and resumed responses can contain full-message objects. The local
accumulator now handles both shapes and retains the state needed for compressed
continuations. A final-looking assistant message alone does not establish stream
completion. Resume requires an authoritative completion marker, and the extension
requires a final, non-pending answer before considering recovery complete.

`streaming_parent_patch` is a new control event in the supplied new snapshot. It
contains `conversation_id`, `logical_answer_id`, a positive `revision`, and
`updates` pairing `message_id` with `streaming_parent_id`. The official page uses
it to reorder multiple messages. The extension ignores it for answer text and
completion; it does not reproduce the official multi-message ordering UI.

## Other transport behavior

The SSE transport still checks for `No done event received` on conversation/resume
streams. The local resume consumer treats a missing completion marker as a
retryable error. The initial stream uses the same resume path on EOF or a reader
failure; it never repeats the original conversation write.

The official resume token store is keyed by conversation id and has a default
four-hour TTL (`resume_token_ttl_ms`). The extension keeps tokens in the active
request and accepts token rotation in SSE events and response headers.

The official WebSocket topic supports `includeAllHistory`, uses string offset
`"0"` on a first full-history subscription, accepts `last_offset` from the server,
and uses catch-up messages after reconnect. None of these topic offsets is an
HTTP resume event counter.

The official page has additional Work-specific polling and terminal-receipt
handling. This change does not claim full Work parity. The extension's existing
conversation polling remains its fallback when an answer cannot be recovered.
The official timeout/first-byte retry machinery is also not fully replicated by
the local initial SSE fetch helper.

## Local implementation map

| Behavior | Local source |
| --- | --- |
| Reference role markers | `src/services/protocol-probe/specs.mjs` |
| Generated active filenames | `src/services/protocol-probe/chatgpt-web-current.mjs` |
| Initial SSE decode and reconnect | `src/services/clients/chatgpt-web/client.mjs` |
| Delta state, resume offset, consecutive retries | `src/services/clients/chatgpt-web/resume-delta.mjs` |
| Handoff and tokenless policy | `src/services/clients/chatgpt-web/stream-handoff.mjs` |
| Request body and headers | `src/services/clients/chatgpt-web/request-wire.mjs` |
| Public refresh/resume entry point | `src/services/clients/chatgpt-web/conversation-api.mjs` |

The public resume entry point returns the consumed offset and accepts a caller's
conduit token. It is separate from automatic in-turn recovery and does not share
the in-memory decoder across separate public calls.
