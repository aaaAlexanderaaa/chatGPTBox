# API Server Bridge

ChatGPTBox ships with a local API gateway that lets any OpenAI-compatible client talk to ChatGPT Web through the extension.

The gateway has two layers:

- The local Node.js server in [`scripts/api-server.mjs`](../scripts/api-server.mjs)
- The extension bridge page in [`src/pages/ApiServer/App.jsx`](../src/pages/ApiServer/App.jsx)

Unless you changed the host or port, all examples below use the default local gateway at `http://127.0.0.1:18080`.

ChatGPT Web streaming, resume, and reconnect are documented in
[`docs/chatgpt-web-stream-resume.md`](./chatgpt-web-stream-resume.md).

## Startup

1. Open the extension settings.
2. Go to `Advanced -> API Server Bridge -> Open API Server Bridge`.
3. Turn on `Enable API Server Bridge` on that page.
4. Start the local server:

```bash
npm run api-server
```

5. Copy the `Bridge token` the server prints on startup into the `Bridge token` field on the bridge page.
6. Keep the bridge page open.
7. Make sure the browser is logged in at `https://chatgpt.com`.

## Bridge Authentication

The bridge channel carries every prompt and every answer, so it is gated on a shared token: without it the gateway refuses the WebSocket upgrade and the HTTP polling endpoints with `401`, and any web page that tries to connect to `ws://127.0.0.1:18080/bridge` is rejected on its `Origin` as well.

The token is generated on first run and stored in `~/.chatgptbox/gateway-bridge-token`, so it stays stable across restarts and only needs to be pasted into the bridge page once. To set it yourself:

```bash
npm run api-server -- --bridge-token <token>
# or
CHATGPT_GATEWAY_BRIDGE_TOKEN=<token> npm run api-server
```

The token is accepted as a `?token=` query parameter, an `X-Bridge-Token` header, or an `Authorization: Bearer` header.

The token protects the bridge channel only. It does **not** protect the completion and conversation endpoints, which are unauthenticated and served with `Access-Control-Allow-Origin: *`. Binding to loopback keeps other machines out, but it does not keep out a web page running in your own browser: while the bridge is paired, any site you visit can `fetch()` `http://127.0.0.1:18080/v1/chat/completions` to spend your ChatGPT session, or `http://127.0.0.1:18080/chatgpt/conversations` to read your conversation list, and can read the responses cross-origin. Run the gateway only while you need it.

If you need to open the bridge page manually, run this in the extension service worker console:

```js
chrome.tabs.create({ url: chrome.runtime.getURL('ApiServer.html') })
```

## Request Flow

1. Your client sends an HTTP request to the local gateway.
2. The gateway forwards the request to the extension bridge over WebSocket or HTTP polling.
3. The bridge page asks the extension background to send the request through the ChatGPT Web flow.
4. The result is streamed back in an OpenAI-compatible response shape.

## Public HTTP Endpoints

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint.

- Supports `stream: true` and `stream: false`
- Works with standard OpenAI clients without custom headers
- Requires a non-empty `messages` array
- Defaults to model `gpt-5-6-thinking` with `max` thinking effort if `model` and effort are omitted. Chat GPT-6 Pro is `gpt-6-pro` (quota-limited); Work / TPP uses `gpt-6-astra-wm` and other `*-wm` slugs.
- Accepts `reasoning_effort` or `thinking_effort` per request with `min`, `standard`, `extended`, `xhigh`, or `max`; both are forwarded as ChatGPT Web `thinking_effort`
- Any model slug is passed through directly to ChatGPT's backend, including `auto` (which enables web search) and new model slugs not yet in the extension's local config

Minimal request:

```bash
curl http://127.0.0.1:18080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-6-thinking",
    "reasoning_effort": "max",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

Streaming request:

```bash
curl http://127.0.0.1:18080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-6-thinking",
    "reasoning_effort": "max",
    "messages": [{"role": "user", "content": "Summarize this page"}],
    "stream": true
  }'
```

Common errors:

- `400` invalid JSON or missing `messages`
- `409` the write result is uncertain, or the same key was used with a different request
- `503` extension bridge is not connected
- `500` upstream bridge or ChatGPT Web request failed

### At-most-once writes and bounded recovery

The protocol contract is:

- Standard OpenAI-compatible endpoints do not require private headers or fields.
- The gateway dispatches each inbound write request to ChatGPT Web at most once. It never
  automatically re-submits that write after a timeout, transport failure, bridge disconnect, or
  missing acknowledgement.
- `/chatgpt/conversations*` is a custom protocol. Its conversation-create and follow-up writes
  require `Idempotency-Key`; the same key and payload return the recorded result or uncertain state
  without contacting ChatGPT Web again.
- A separate retry of a standard request is a new request and cannot be safely deduplicated by the
  gateway. Standard clients should decide explicitly whether to retry an `ambiguous_dispatch` error.

Network failures, timeouts, HTTP errors, bridge disconnects, and missing acknowledgements after
dispatch are reported as `ambiguous_dispatch` with `retryable: false`.

Custom conversation write state is persisted under `~/.chatgptbox/gateway-operations.json`.
Standard unkeyed requests are not written to that ledger. The initial `/f/conversation` POST is the
write and stays at-most-once after dispatch. `/f/conversation/resume` is a reconnectable read: the
gateway may POST it again with an event `offset` (up to 12 times). After resume retries are
exhausted or resume cannot start, recovery falls back to the existing conversation poll
timeout/interval.

Once streaming has begun, an error event closes the stream without a success `stop` or `[DONE]`.
Non-monotonic final snapshots are reported as errors instead of silently returning truncated text.

History synchronization has a separate safety policy: any HTTP `429` immediately stops that sync,
clears automatic scheduling, preserves pages already stored, and requires manual unlocking in
settings before history sync can run again.

### `GET /v1/models`

Returns the models available through the gateway.

When the bridge is connected, this endpoint dynamically fetches the model list from ChatGPT's backend API (cached for 5 minutes). If the bridge is not connected or the fetch fails, it falls back to a hardcoded list of known models.

Example:

```bash
curl http://127.0.0.1:18080/v1/models
```

### `GET /status`

Fast status probe for bridge connectivity.

Example response fields:

- `status`
- `bridge_connected`
- `bridge_type`
- `pending_requests`

Example:

```bash
curl http://127.0.0.1:18080/status
```

### `GET /health`

Detailed diagnostics endpoint.

Returns:

- server host/port and uptime
- bridge transport and connection status
- total request/error counters
- pending request count
- request timeout settings
- troubleshooting steps when the bridge is disconnected

Example:

```bash
curl http://127.0.0.1:18080/health
```

### `GET /chatgpt/conversations`

Returns the locally cached ChatGPT conversation list from the extension.

Reading this endpoint does not implicitly contact ChatGPT. History synchronization is disabled by default and must be enabled in the extension settings before `force_sync=true` can run. A manual full sync is RPM-limited, saves each completed page immediately, and does not pre-download every conversation body. Optional automatic synchronization fetches only the newest 100 active conversations per run.

If a history request receives HTTP 429, the extension stops the task, clears automatic scheduling, and keeps the pages already saved. History automation remains locked until the user reviews the settings and unlocks it manually.

The cache uses incremental upserts:

- new active IDs are appended to the list index; their full snapshots are fetched on demand
- missing upstream IDs are kept locally instead of being deleted
- changed `update_time` / `async_status` / `is_archived` values update the cached list entry

The response still uses the upstream-style list shape (`items`, `total`, `limit`, `offset`), but the source is the local browser cache rather than a fresh upstream proxy call.

Query parameters:

- `offset`
- `limit`
- `order`
- `is_archived`
- `is_starred`
- `force_sync`

Example:

```bash
curl "http://127.0.0.1:18080/chatgpt/conversations?offset=0&limit=100&order=updated&force_sync=true"
```

Typical response fields include:

- `items`
- `total`
- `limit`
- `offset`
- `source`
- `cached_at`

### `GET /chatgpt/conversations/:id`

Returns a normalized conversation snapshot from the local browser cache by default.

When the cached list entry shows a newer `update_time` or different `async_status`, the gateway overlays the latest status immediately and attempts to fetch a fresher snapshot before responding.

Optional query parameters:

- `user_message_id`
- `assistant_message_id`
- `think`
- `force_refresh`

Example:

```bash
curl "http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>?think=true"
```

`user_message_id` anchors the snapshot to one turn: the `messageId` returned by `POST /chatgpt/conversations` or `POST /chatgpt/conversations/:id/messages`. When the snapshot contains that user message, `message`, `query`, and the top-level thought timing describe only that turn:

- If the user message has no assistant beneath it yet, `message` is `null` and the thought timing fields are `null`. The previous turn's answer is never reported in its place.
- `messages` includes the anchored turn even while `current_node` still points at the previous answer.
- If the user message is not in the snapshot at all (ChatGPT has not stored the send yet), the anchor cannot narrow anything and the snapshot follows `current_node` as if no anchor were given. Check `messages` for the anchored id to tell this case apart, and poll again later.

Without `user_message_id` the snapshot follows `current_node` as before.

The response includes fields such as:

- `conversationId`
- `title`
- `query`
- `queryMessage`
- `messages` (assistant entries also carry `thoughtDurationSec` / `thoughtDurationText` / `thoughtDurationLabel` for their own turn)
- `thoughtDurationSec` / `thoughtDurationText` / `thoughtDurationLabel` (thinking time of the turn that produced `message`, for example `90`, `"1m 30s"`, and `"Thought for 1m 30s"`)
- `thinking` when `think=true`
- `defaultModel`
- `currentNode`
- `asyncStatus`
- `pending`
- `message`
- `cache`

Thinking time is a per-turn property, so every assistant entry in `messages` carries its own value and the top-level fields describe the turn that produced `message`. They do **not** require `think=true`.

Timing prefers ChatGPT's official fields: `metadata.finished_duration_sec`, then the page sentence in `metadata.finished_text` (`Worked for 2 minutes 30 seconds`, `Worked for 2分30秒`, or the older `Thought for …`). Those can sit on a `reasoning_recap` node or on the visible answer. A turn normally also has a `thoughts` node spanning the same window, so deriving a duration from node timestamps would report that turn twice and is not used as a fallback. When no official field is present, the duration fields are `null` rather than an estimate.

`thoughtDurationText` is the compact display form (`12s`, `1m`, `1m 30s`). `thoughtDurationLabel` is ChatGPT's own sentence — the segment's `finished_text` verbatim when the turn has a single timed segment, otherwise `Thought for <duration>`.

`thinking` is best-effort data extracted from ChatGPT Web reasoning-related nodes such as `thoughts`, `reasoning_recap`, and reasoning metadata that are present in the conversation snapshot. When requested, each entry also includes `durationSec`, `durationText`, `finishedDurationSec`, `finishedText`, and `reasoningStartTime`.

### `POST /chatgpt/conversations`

Starts a brand-new ChatGPT conversation from a user prompt and returns as soon as the gateway knows the new `conversationId`. The assistant response continues in the browser after the HTTP response returns, so this is useful for fire-and-forget tools that only need the thread created.

JSON body:

- `query` or `message`
- `model` (optional)

Required header: `Idempotency-Key`. The Drafts client generates and persists this value before it
sends the request, so retrying the same Drafts action does not create another conversation.

Example:

```bash
curl -X POST http://100.104.70.122:18081/chatgpt/conversations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"query":"Start a new thread from this note"}'
```

The response includes:

- `conversationId`
- `messageId` (the id of the user message that opened the thread; pass it back as `user_message_id` on `GET /chatgpt/conversations/:id` to anchor the snapshot to this turn)
- `defaultModel`
- `createdAt`
- `pending`
- `query`

### `POST /chatgpt/conversations/:id/messages`

Sends a follow-up user message into an existing ChatGPT conversation and returns as soon as ChatGPT acknowledges it. The answer keeps generating in the browser after the HTTP response returns, so this route never holds the connection open while a thinking model works. Collect the answer later with `GET /chatgpt/conversations/:id`.

JSON body:

- `query` or `message`
- `model` (optional, defaults to the conversation's default model when present)
- `think` (accepted for compatibility, but ignored: this route returns an acknowledgement rather than a snapshot)

Required header: `Idempotency-Key`. The Drafts client stores one key in the waiting-reply metadata
and reuses it if the same send action is retried.

Example:

```bash
curl -X POST http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>/messages \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"query":"continue from the cached thread","think":true}'
```

The response includes:

- `conversationId`
- `messageId` (the id of the user message just sent; pass it back as `user_message_id` on `GET /chatgpt/conversations/:id` to anchor the snapshot to this turn)
- `createdAt`
- `pending` (always `true`; the answer has not been generated yet)
- `query`

### `POST /chatgpt/conversations/:id/refresh`

Fetches the conversation snapshot again and, when the conversation is still pending, optionally calls the ChatGPT resume stream to pull newer assistant output.

Optional JSON body:

- `userMessageId` (same anchoring as `user_message_id` on `GET /chatgpt/conversations/:id`)
- `assistantMessageId`
- `offset` (start offset for the resume POST; the response `resume.offset` is the **consumed** offset)
- `preferResume` (defaults to `false`; enabling it sends a resume POST when a conduit token is supplied or the conversation is still pending)
- `conduitToken` (`X-Conduit-Token`; required for HTTP resume)
- `resumeTimeoutMs` (clamped; thinking turns need much more than 10s)
- `think`

Example:

```bash
curl -X POST http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>/refresh \
  -H "Content-Type: application/json" \
  -d '{"preferResume":false,"think":true}'
```

The response includes:

- `conversationId`
- `pending`
- `asyncStatus`
- `source`
- `conversation` (same snapshot shape as `GET /chatgpt/conversations/:id`, including per-turn thinking time on `messages`)
- `resume`
- `text`

### `GET /grok/conversations`

Returns a live Grok Web conversation list through the extension's grok.com proxy tab.

Unlike `/chatgpt/conversations`, this endpoint always performs a live GET. There is no local conversation cache, no `force_sync`, and no history-sync / 429 lock behavior.

Query parameters:

- `limit` or `pageSize` (default `20`)

Example:

```bash
curl "http://127.0.0.1:18080/grok/conversations?limit=20"
```

Typical response fields include:

- `items` (each with `conversationId`, `title`)
- `total`

### `GET /grok/conversations/:id`

Returns a live Grok Web conversation snapshot (messages flattened from response nodes).

Example:

```bash
curl "http://127.0.0.1:18080/grok/conversations/<conversation-id>"
```

The response includes fields such as:

- `conversationId`
- `title`
- `messages`
- `defaultModel`
- `pending`

### `POST /grok/conversations`

Starts a brand-new Grok Web conversation from a user prompt. The write is at-most-once after dispatch: the gateway does not auto-retry create on timeout or bridge error.

JSON body:

- `query` or `message`
- `model` (optional Grok slug such as `grok-chat-expert`; when omitted, the bridge uses `pickDefaultGrokWebKey` for the signed-in account tier)

Required header: `Idempotency-Key` (or `X-Idempotency-Key`). Ledger keys are scoped under `/grok/conversations` and cannot collide with `/chatgpt/` writes.

Example:

```bash
curl -X POST http://127.0.0.1:18080/grok/conversations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"query":"Hello","model":"grok-chat-fast"}'
```

### `POST /grok/conversations/:id/messages`

Sends a follow-up message into an existing Grok Web conversation. Same at-most-once write contract as create: Idempotency-Key required; no automatic replay after dispatch.

JSON body:

- `query` or `message`
- `model` (optional)
- `previousResponseID` (required parent response id from create, GET, or the previous send)

Example:

```bash
curl -X POST http://127.0.0.1:18080/grok/conversations/<conversation-id>/messages \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"query":"Follow up","previousResponseID":"<parent-response-id>"}'
```

### `POST /grok/conversations/:id/refresh`

Re-GETs the conversation snapshot. This is not ChatGPT-style resume: there is no conduit token, `preferResume`, or streaming resume path.

Example:

```bash
curl -X POST http://127.0.0.1:18080/grok/conversations/<conversation-id>/refresh \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Internal Bridge Endpoints

These are the HTTP polling fallback for the bridge transport, not the main client API. The extension page uses the WebSocket bridge, so nothing ships against these today; they exist for a client that cannot hold a socket open. All require the bridge token (see [Bridge Authentication](#bridge-authentication)):

- `GET /bridge/poll`
- `POST /bridge/respond`
- `POST /bridge/disconnect`
- `WS /bridge`

## Conversation Endpoints

If you meant the manual conversation APIs, these are the current endpoints:

ChatGPT Web:

- `GET /chatgpt/conversations`
- `GET /chatgpt/conversations/:id`
- `POST /chatgpt/conversations`
- `POST /chatgpt/conversations/:id/messages`
- `POST /chatgpt/conversations/:id/refresh`

Grok Web:

- `GET /grok/conversations`
- `GET /grok/conversations/:id`
- `POST /grok/conversations`
- `POST /grok/conversations/:id/messages`
- `POST /grok/conversations/:id/refresh`

The HTTP routing for them is in [`scripts/api-server.mjs`](../scripts/api-server.mjs). ChatGPT Web data-fetching lives in [`src/services/clients/chatgpt-web/conversation-api.mjs`](../src/services/clients/chatgpt-web/conversation-api.mjs); Grok Web uses the grok.com proxy tab and [`src/services/clients/grok-web/`](../src/services/clients/grok-web/).
