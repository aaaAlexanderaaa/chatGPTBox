# API Server Bridge

ChatGPTBox ships with a local API gateway that lets any OpenAI-compatible client talk to ChatGPT Web through the extension.

The gateway has two layers:

- The local Node.js server in [`scripts/api-server.mjs`](../scripts/api-server.mjs)
- The extension bridge page in [`src/pages/ApiServer/App.jsx`](../src/pages/ApiServer/App.jsx)

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
- Defaults to model `gpt-5-4-thinking` if `model` is omitted
- Any model slug is passed through directly to ChatGPT's backend, including `auto` (which enables web search) and new model slugs not yet in the extension's local config

Minimal request:

```bash
curl http://127.0.0.1:18080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

Streaming request:

```bash
curl http://127.0.0.1:18080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-4-thinking",
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

Proxies ChatGPT Web conversation listing through the logged-in browser session.

This endpoint is intended to mirror:

`GET https://chatgpt.com/backend-api/conversations?offset=0&limit=28&order=updated&is_archived=false&is_starred=false`

The response keeps the upstream JSON shape instead of returning a ChatGPTBox-specific DTO.

Query parameters:

- `offset`
- `limit`
- `order`
- `is_archived`
- `is_starred`

Example:

```bash
curl "http://127.0.0.1:18080/chatgpt/conversations?offset=0&limit=28&order=updated"
```

Typical upstream fields include:

- `items`
- `total`
- `limit`
- `offset`

### `GET /chatgpt/conversations/:id`

Fetches a normalized conversation snapshot and the best assistant message currently available.

Optional query parameters:

- `user_message_id`
- `assistant_message_id`

Example:

```bash
curl "http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>"
```

The response includes fields such as:

- `conversationId`
- `title`
- `asyncStatus`
- `pending`
- `message`

### `POST /chatgpt/conversations/:id/refresh`

Fetches the conversation snapshot again and, when the conversation is still pending, optionally calls the ChatGPT resume stream to pull newer assistant output.

Optional JSON body:

- `userMessageId`
- `assistantMessageId`
- `offset`
- `preferResume`
- `resumeTimeoutMs`

Example:

```bash
curl -X POST http://127.0.0.1:18080/chatgpt/conversations/<conversation-id>/refresh \
  -H "Content-Type: application/json" \
  -d '{"preferResume":true,"resumeTimeoutMs":10000}'
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

## About The "3 Endpoints"

If the three endpoints you meant were the conversation APIs, they are implemented:

- `GET /chatgpt/conversations`
- `GET /chatgpt/conversations/:id`
- `POST /chatgpt/conversations/:id/refresh`

The HTTP routing for them is in [`scripts/api-server.mjs`](../scripts/api-server.mjs), and the ChatGPT Web data-fetching logic is in [`src/services/apis/chatgpt-web-conversation-api.mjs`](../src/services/apis/chatgpt-web-conversation-api.mjs).
