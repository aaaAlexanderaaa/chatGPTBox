# API Server Bridge

ChatGPTBox ships with a local API gateway that lets any OpenAI-compatible client talk to ChatGPT Web through the extension.

The gateway has two layers:

- The local Node.js server in [`scripts/api-server.mjs`](../scripts/api-server.mjs)
- The extension bridge page in [`src/pages/ApiServer/App.jsx`](../src/pages/ApiServer/App.jsx)

Unless you changed the host or port, all examples below use the default local gateway at `http://127.0.0.1:18080`.

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
- Defaults to model `gpt-5-6-thinking` with `max` thinking effort if `model` and effort are omitted
- Accepts `reasoning_effort` or `thinking_effort` per request with `standard`, `extended`, or `max`; both are forwarded as ChatGPT Web `thinking_effort`
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
Standard unkeyed requests are not written to that ledger. Resume POST requests are also at-most-once
by default. After an abnormal resume or transport failure, recovery is limited to one read-only
conversation snapshot rather than a long stacked polling loop.

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

The response includes fields such as:

- `conversationId`
- `title`
- `query`
- `queryMessage`
- `messages`
- `thinking` when `think=true`
- `defaultModel`
- `currentNode`
- `asyncStatus`
- `pending`
- `message`
- `cache`

`thinking` is best-effort data extracted from ChatGPT Web reasoning-related nodes such as `thoughts`, `reasoning_recap`, and reasoning metadata that are present in the conversation snapshot.

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
- `defaultModel`
- `createdAt`
- `pending`
- `query`

### `POST /chatgpt/conversations/:id/messages`

Sends a follow-up user message into an existing ChatGPT conversation, then refreshes the conversation snapshot.

JSON body:

- `query` or `message`
- `model` (optional, defaults to the conversation's default model when present)
- `think` (optional; when true, the refreshed response includes `thinking`)

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

- `query`
- `pending`
- `asyncStatus`
- `conversation`
- `resume`
- `text`

### `POST /chatgpt/conversations/:id/refresh`

Fetches the conversation snapshot again and, when the conversation is still pending, optionally calls the ChatGPT resume stream to pull newer assistant output.

Optional JSON body:

- `userMessageId`
- `assistantMessageId`
- `offset`
- `preferResume` (defaults to `false`; enabling it sends one resume POST)
- `resumeTimeoutMs`
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
- `conversation`
- `resume`
- `text`

## Internal Bridge Endpoints

These are the HTTP polling fallback for the bridge transport, not the main client API. The extension page uses the WebSocket bridge, so nothing ships against these today; they exist for a client that cannot hold a socket open. All require the bridge token (see [Bridge Authentication](#bridge-authentication)):

- `GET /bridge/poll`
- `POST /bridge/respond`
- `POST /bridge/disconnect`
- `WS /bridge`

## Conversation Endpoints

If you meant the manual ChatGPT conversation APIs, these are the current endpoints:

- `GET /chatgpt/conversations`
- `GET /chatgpt/conversations/:id`
- `POST /chatgpt/conversations`
- `POST /chatgpt/conversations/:id/messages`
- `POST /chatgpt/conversations/:id/refresh`

The HTTP routing for them is in [`scripts/api-server.mjs`](../scripts/api-server.mjs), and the ChatGPT Web data-fetching logic is in [`src/services/clients/chatgpt-web/conversation-api.mjs`](../src/services/clients/chatgpt-web/conversation-api.mjs).
