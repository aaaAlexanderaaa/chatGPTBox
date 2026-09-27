# ChatGPTBox MCP Server

The MCP server is a separate local HTTP service for ChatGPT Web conversations. It uses the standard Streamable HTTP MCP transport, with one endpoint at `http://127.0.0.1:18081/mcp`.

## Start

1. Log in to `chatgpt.com` in the browser, open the extension's `Advanced -> API Server Bridge -> Open API Server Bridge` page, and enable the bridge. Keep that page open.
2. Run `npm run api-server`. Pair the page with the printed **Bridge token**.
3. Run `npm run mcp-server` in another terminal.
4. Configure your MCP client with the HTTP URL `http://127.0.0.1:18081/mcp` and `Authorization: Bearer <MCP token>`. The MCP token is generated in `~/.chatgptbox/mcp-token` on first startup. This is separate from the gateway API token and the extension bridge token.

The MCP server reads the gateway API token from `~/.chatgptbox/gateway-api-token`. If the API gateway uses `--api-token` or `CHATGPT_GATEWAY_API_TOKEN` instead of that file, set the same `CHATGPT_GATEWAY_API_TOKEN` in the MCP server environment. The default API gateway port is 18080; override it with `--gateway-port` or `CHATGPT_GATEWAY_PORT`. Override the MCP port with `--port` or `CHATGPT_MCP_PORT`.

## Tool

`ask_chatgpt` creates a conversation and waits for its final answer. It is the only tool exposed by this MCP server.

The server instructions ask MCP clients to treat ChatGPT as a capable peer agent. The user's ChatGPT Web account already supplies its configured model, thinking effort, custom instructions, memory, and personalization. Send one clear, natural question with relevant background and the desired outcome; a long background can go in a code block. For example: "关于 X，我已经知道 Y；我需要你 Z" or "深度调研：关于 X，我应该知道的一切". Let ChatGPT choose its own investigation and answer structure. Use it when that judgment would help, rather than for keyword search or synthetic connectivity tests.

`ask_chatgpt` accepts only `query`. The server automatically appends this response preference to the question: "请直接以文本回答；如有参考链接，请附上链接。请不要创建文件、代码或图片，我的浏览器无法在当前页面打开或加载这些内容。" Its ordinary text result contains only the final answer; `structuredContent` also contains the conversation and message IDs and `thought_duration_seconds` for diagnostics. The duration sums ChatGPT Web's reported `finished_duration_sec` values for the turn. It is `null` if ChatGPT does not report a duration; it is never inferred from the MCP call's elapsed time. The MCP server does not expose conversation listing, continuation, or turn-status tools. The server generates an internal idempotency key for each dispatch; an ambiguous dispatch is reported as an error, not automatically resent.

The server permits **four active `ask_chatgpt` calls**. A fifth call returns a `concurrency_limit` error before sending a message to ChatGPT. Wait for an active call to finish before retrying.

## Waiting and recovery

The MCP server sends one create request to the API gateway. The gateway acknowledges it with `conversationId` and `messageId`; the extension's ChatGPT Web runtime continues processing in the background. The MCP server holds the HTTP response open and polls `GET /chatgpt/conversations/:id/turns/:messageId` every 10 seconds by default. That route reads only a local record in the extension background. It never calls the upstream ChatGPT conversation endpoint. The ChatGPT Web runtime itself owns any upstream stream or resume activity needed to finish the response.

Interim answer text and thinking time do not finish the MCP call. It returns only when the runtime posts its terminal `done` event with nonempty answer text. The HTTP response uses SSE with keepalive comments; clients that send a progress token also receive progress notifications. Configure the MCP client's tool-call timeout long enough for the question. The server's default maximum wait is 45 minutes (`CHATGPT_MCP_WAIT_SECONDS` changes it, capped at two hours).

If the wait times out after acknowledgement, ChatGPT may still finish in the browser and the error result includes the known conversation and message IDs. A disconnected client may receive no result. When the IDs are known, an operator with the separate gateway API token can inspect the existing turn with `GET /chatgpt/conversations/:id/turns/:messageId`; MCP intentionally exposes no recovery tool. Running turn records and the most recent 30 finished turns are saved in extension local storage. A bridge disconnect or missing record is reported as an error rather than causing a second ChatGPT write. For a missing record, check both IDs from the acknowledgement; if the record expired, inspect the existing conversation. Do not send a new prompt solely to test whether the connection works.

## Access control

The MCP server binds to `127.0.0.1`, requires its own bearer token for every request, and validates HTTP Host and Origin headers. It does not enable browser CORS. The API gateway likewise requires its API token for client endpoints and grants browser CORS only to the paired extension origin or explicitly configured origins. Keep all three tokens private.
