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

5. Keep the bridge page open.
6. Make sure the browser is logged in at `https://chatgpt.com`.

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
- Requires a non-empty `messages` array
- Defaults to model `gpt-5-5-thinking` if `model` is omitted
- Any model slug is passed through directly to ChatGPT's backend, including `auto` (which enables web search) and new model slugs not yet in the extension's local config

Minimal request:

```bash
curl http://127.0.0.1:18080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-5-thinking",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

Streaming request:

```bash
curl http://127.0.0.1:18080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-5-thinking",
    "messages": [{"role": "user", "content": "Summarize this page"}],
    "stream": true
  }'
```

Common errors:

- `400` invalid JSON or missing `messages`
- `503` extension bridge is not connected
- `500` upstream bridge or ChatGPT Web request failed

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

To keep request volume down, the extension syncs the active conversation list on a configurable background interval (15 minutes by default) and only pulls the archived list when it is needed (for example, an archived view request or when an active thread disappears and needs to be reconciled).

The cache uses incremental upserts:

- new active IDs are appended and hydrated into local conversation snapshots
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

Example:

```bash
curl -X POST http://100.104.70.122:18081/chatgpt/conversations \
  -H "Content-Type: application/json" \
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

Example:

```bash
curl -X POST http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>/messages \
  -H "Content-Type: application/json" \
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
- `preferResume`
- `resumeTimeoutMs`
- `think`

Example:

```bash
curl -X POST http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>/refresh \
  -H "Content-Type: application/json" \
  -d '{"preferResume":true,"resumeTimeoutMs":10000,"think":true}'
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

These are transport endpoints used by the extension bridge page, not the main client API:

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

The HTTP routing for them is in [`scripts/api-server.mjs`](../scripts/api-server.mjs), and the ChatGPT Web data-fetching logic is in [`src/services/apis/chatgpt-web-conversation-api.mjs`](../src/services/apis/chatgpt-web-conversation-api.mjs).
