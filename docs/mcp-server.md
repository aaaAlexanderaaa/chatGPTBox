# ChatGPTBox MCP Server

The MCP server is a separate local HTTP service for ChatGPT Web conversations. It uses the standard Streamable HTTP MCP transport, with one endpoint at `http://127.0.0.1:18081/mcp`.

## Start

1. Log in to `chatgpt.com` in the browser, open the extension's `Advanced -> API Server Bridge -> Open API Server Bridge` page, and enable the bridge. Keep that page open.
2. Run `npm run api-server`. Pair the page with the printed **Bridge token**.
3. Run `npm run mcp-server` in another terminal.
4. Configure your MCP client with the HTTP URL `http://127.0.0.1:18081/mcp` and `Authorization: Bearer <MCP token>`. The MCP token is generated in `~/.chatgptbox/mcp-token` on first startup. This is separate from the gateway API token and the extension bridge token.

The MCP server reads the gateway API token from `~/.chatgptbox/gateway-api-token`. If the API gateway uses `--api-token` or `CHATGPT_GATEWAY_API_TOKEN` instead of that file, set the same `CHATGPT_GATEWAY_API_TOKEN` in the MCP server environment. The default API gateway port is 18080; override it with `--gateway-port` or `CHATGPT_GATEWAY_PORT`. Override the MCP port with `--port` or `CHATGPT_MCP_PORT`.

To accept MCP clients on other devices, explicitly bind the MCP server to all IPv4 interfaces. For an API gateway already running on port 18081, start the MCP server on a different port:

```bash
npm run mcp-server -- --host 0.0.0.0 --port 18082 --gateway-port 18081
```

Set the remote client's URL to `http://<this-computer's-IP>:18082/mcp` and use the MCP bearer token. The `--host` option (or `CHATGPT_MCP_HOST`) defaults to `127.0.0.1`; it accepts `127.0.0.1` or `0.0.0.0`. The API gateway connection remains local to this computer. Keep the MCP token private and use a trusted network or TLS when connecting across networks; plain HTTP exposes the token to network observers.

## Tool

`ask_chatgpt` creates a conversation and waits for its final answer. It is the only tool exposed by this MCP server.

The server instructions ask MCP clients to treat ChatGPT as a capable peer agent. The user's ChatGPT Web account already supplies its configured model, thinking effort, custom instructions, memory, and personalization. Send one clear, natural question with relevant background and the desired outcome; a long background can go in a code block. For example: "关于 X，我已经知道 Y；我需要你 Z" or "深度调研：关于 X，我应该知道的一切". Let ChatGPT choose its own investigation and answer structure. Use it when that judgment would help, rather than for keyword search or synthetic connectivity tests.

`ask_chatgpt` accepts only `query`. The server automatically appends this response preference to the question: "请直接以文本回答；如有参考链接，请附上链接。请不要创建文件、代码或图片，我的浏览器无法在当前页面打开或加载这些内容。" Its ordinary text result contains only the final answer; `structuredContent` also contains the conversation and message IDs and `thought_duration_seconds` for diagnostics. The duration sums ChatGPT Web's reported `finished_duration_sec` values for the turn. It is `null` if ChatGPT does not report a duration; it is never inferred from the MCP call's elapsed time. The MCP server does not expose conversation listing, continuation, or turn-status tools. The server generates an internal idempotency key for each dispatch; an ambiguous dispatch is reported as an error, not automatically resent.

The server permits **four active `ask_chatgpt` calls**. A fifth call returns a `concurrency_limit` error before sending a message to ChatGPT. Wait for an active call to finish before retrying.

## Waiting and recovery

The MCP server sends one create request to the API gateway. The gateway acknowledges it with `conversationId` and `messageId`; the extension's ChatGPT Web runtime continues processing in the background. The MCP server holds the HTTP response open and polls `GET /chatgpt/conversations/:id/turns/:messageId` every 10 seconds by default. Ordinary polls read only a local record in the extension background. Every minute, the waiter adds `?recover=true`: the extension performs a bounded, read-only ChatGPT conversation GET anchored to the acknowledged user message. This repairs a lost completion notification even if the original stream or resume has stalled. It checks one native page without downloading the conversation's older history. Recovery reads are shared between callers and limited to one per turn per minute.

Interim answer text and thinking time do not finish the MCP call. It returns when the runtime posts its terminal `done` event with nonempty answer text, or a fresh recovery read confirms a non-pending final answer for the exact user message. A stale cache, an older question with the same text, or a final-looking fragment cannot finish the call. The HTTP response uses SSE with keepalive comments; clients that send a progress token also receive progress notifications. Temporary bridge outages, network failures, and retryable status errors are retried within the original wait deadline; they never trigger another create request. Cancellation and non-retryable errors still stop waiting. Configure the MCP client's tool-call timeout long enough for the question. The server's default maximum wait is 45 minutes (`CHATGPT_MCP_WAIT_SECONDS` changes it, capped at two hours).

If the wait times out after acknowledgement, ChatGPT may still finish in the browser and the error result includes the known conversation and message IDs. A disconnected client may receive no result: recovery within a running call does not resume a cancelled or closed MCP client connection. When the IDs are known, an operator with the separate gateway API token can inspect the existing turn with `GET /chatgpt/conversations/:id/turns/:messageId?recover=true`; MCP intentionally exposes no recovery tool. Running turn records and the most recent 30 finished turns are saved in extension local storage. If a local record is missing, the waiter checks the exact existing turn once before reporting it as missing. No recovery path sends a second ChatGPT write. Do not send a new prompt solely to test whether the connection works.

## Access control

The MCP server binds to `127.0.0.1` by default, requires its own bearer token for every request, and validates HTTP Host and Origin headers. With `--host 0.0.0.0`, IP-address Host headers are allowed while DNS hostnames and non-local browser origins remain rejected. It does not enable browser CORS. The API gateway likewise requires its API token for client endpoints and grants browser CORS only to the paired extension origin or explicitly configured origins. Keep all three tokens private.
