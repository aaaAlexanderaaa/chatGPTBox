---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-11-11
---

> The 2026-10-22 review classified this existing interface document and
> checked its source ownership. It did not repeat live-account validation
> of every protocol claim. Verification remains partial.

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

`ask_chatgpt` creates a **new, isolated conversation on every call** and waits for
its final answer. It is the only tool exposed by this MCP server. Consecutive
calls do not continue a conversation or share task context.

This HTTP MCP connects the caller to ChatGPT Web as **an independent external
researcher running in the cloud**. The local MCP server and API gateway relay
the question and answer; they do not supply the caller's environment or project
state. ChatGPT is fully isolated from the caller's local environment and project.
It has no implicit knowledge of that project and cannot inspect the caller's
repository, files, terminal, tools, private documents, conversation or tool
results. Task context must be explicitly included in `query`.

The server instructions ask MCP clients to treat ChatGPT as a capable peer agent.
The user's account supplies its configured model, thinking effort and
personalization; do not override them. Those settings and account memory do not
supply this coding agent's task context. The user clarified the cloud-researcher
and local-project isolation boundary on 2026-11-11; it applies to the HTTP
interface independently of any client's local file handling.

Every `query` must be a self-contained, natural-language question. Explain the
actual problem, relevant context and desired outcome as if asking ChatGPT
directly. Understand and synthesize the material before asking: include the
facts, constraints, prior findings and source or code excerpts needed for this
question. Complex questions can need substantial background; self-contained does
not mean forwarding an unfiltered agent handoff, raw tool output or a collection
of files. Let ChatGPT choose its investigation and answer structure.

ChatGPT cannot see earlier calls or their answers. When following up, repeat the
necessary context and prior conclusions. References such as “此前”,
“我们的方案”, “这个项目”, a local path or a file hash do not convey that material.
A public namesake or upstream repository found through web search cannot establish
the private/local working tree's behavior. Supply the facts needed for that
judgment, or explicitly retain the gap.

For example, a self-contained review question supplies both the contract and
the actual disputed code:

````text
请审查这个浏览器扩展的配置变更逻辑。enabled 默认 false；删除该配置键也应立即关闭功能。
当前代码为：
```js
let enabled = true
function changed(changes) {
  if (changes.enabled?.newValue === false) enabled = false
}
```
复现：先开启，再删除 enabled，事件为 { enabled: { oldValue: true } }，结果 enabled 仍为 true。
请根据这些材料判断原因和修正边界；材料不足的部分请明确指出。
````

Use ChatGPT when its judgment would help rather than for keyword search or
synthetic connectivity tests. The HTTP MCP accepts the question text only;
paths and file references do not attach or read local files, and earlier results
are not automatically included.

`ask_chatgpt` accepts only `query`. The server automatically appends this response preference to the question: "请直接以文本回答；如有参考链接，请附上链接。请不要创建文件、代码或图片，我的浏览器无法在当前页面打开或加载这些内容。" Its ordinary text result contains only the final answer; `structuredContent` also contains the conversation and message IDs and `thought_duration_seconds` for diagnostics. The duration sums ChatGPT Web's reported `finished_duration_sec` values for the turn. It is `null` if ChatGPT does not report a duration; it is never inferred from the MCP call's elapsed time. The MCP server does not expose conversation listing, continuation, or turn-status tools. The server generates an internal idempotency key for each dispatch; an ambiguous dispatch is reported as an error, not automatically resent.

The server permits **four active `ask_chatgpt` calls**. A fifth call returns a `concurrency_limit` error before sending a message to ChatGPT. Wait for an active call to finish before retrying.

### Updating the advertised description

[`scripts/mcp-server.mjs`](../scripts/mcp-server.mjs) owns the initialization
instructions, `ask_chatgpt` description and `query` schema description. Keep all
three explicit about the independent cloud researcher, isolation from the
caller's local environment and project, isolated sessions, and synthesized,
self-contained questions. Verify them through MCP `initialize` and `tools/list`;
those metadata requests do not send a ChatGPT question. The HTTP regression
checks their advertised contract. Client-specific local file handling is not a
capability of this HTTP interface and must not be advertised as one.

Restart only the MCP process after changing those descriptions, preserving its
working directory, Node runtime, bind address, ports and authentication settings.
The gateway, extension and Drafts do not need redeployment for a metadata change.
Clients that cache tool metadata need to reconnect/refetch before displaying the
new description; a successful server restart alone does not prove a client's
cached description changed. Do not send a model test prompt to check metadata.
The [official MCP update guidance](https://developers.openai.com/plugins/build/mcp-server#plan-for-updates)
likewise calls for refreshing the connection after metadata changes.

On 2026-10-30, the isolated-session/self-contained-query wording was verified in
both local HTTP regression cases, then deployed by restarting only the existing
MCP process. Live authenticated `initialize` and `tools/list` returned the updated
server instructions, tool description and parameter description. The existing
bind address, ports, authentication files and gateway process were retained.
Lint and documentation checks passed. No ChatGPT question was sent to verify
this change. The active coding chat still exposed its old cached tool metadata;
client reconnection was not completed because the computer-use tool disallowed
controlling the Codex UI. Server deployment and active-client cache freshness
are therefore recorded separately. Later prompt quality has not yet been observed.

On 2026-11-11, all three advertised descriptions were updated to state the
independent cloud researcher's isolation from the caller's environment and
project, and to ask for synthesized, natural-language questions. Both controlled
HTTP regression cases, lint and documentation checks passed on Node.js 22.
The regression checks the advertised boundaries and excludes client-specific
file expansion from the descriptions; it sends no questions to ChatGPT.
Restarting only the existing MCP process then returned the updated instructions,
tool description and query description through authenticated live `initialize`
and `tools/list`. The Node runtime, bind address, ports and authentication files
were preserved, and the gateway process was unchanged. No ChatGPT question was
sent. Clients with cached metadata still need to reconnect/refetch; freshness
of the active coding chat's cached description was not verified.

## Waiting and recovery

The MCP server sends one create request to the API gateway. The gateway acknowledges it with `conversationId` and `messageId`; the extension's ChatGPT Web runtime continues processing in the background. The MCP server holds the HTTP response open and polls `GET /chatgpt/conversations/:id/turns/:messageId` every 10 seconds by default. Ordinary polls read only a local record in the extension background. Every minute, the waiter adds `?recover=true`: the extension performs a bounded, read-only ChatGPT conversation GET anchored to the acknowledged user message. This repairs a lost completion notification even if the original stream or resume has stalled. It checks one native page without downloading the conversation's older history. Recovery reads are shared between callers and limited to one per turn per minute.

Interim answer text and thinking time do not finish the MCP call. It returns when the runtime posts its terminal `done` event with nonempty answer text, or a fresh recovery read confirms a non-pending final answer for the exact user message. A stale cache, an older question with the same text, or a final-looking fragment cannot finish the call. The HTTP response uses SSE with keepalive comments; clients that send a progress token also receive progress notifications. Temporary bridge outages, network failures, and retryable status errors are retried within the original wait deadline; they never trigger another create request. Cancellation and non-retryable errors still stop waiting. Configure the MCP client's tool-call timeout long enough for the question. The server's default maximum wait is 45 minutes (`CHATGPT_MCP_WAIT_SECONDS` changes it, capped at two hours).

If the wait times out after acknowledgement, ChatGPT may still finish in the browser and the error result includes the known conversation and message IDs. A disconnected client may receive no result: recovery within a running call does not resume a cancelled or closed MCP client connection. When the IDs are known, an operator with the separate gateway API token can inspect the existing turn with `GET /chatgpt/conversations/:id/turns/:messageId?recover=true`; MCP intentionally exposes no recovery tool. Running turn records and the most recent 30 finished turns are saved in extension local storage. If a local record is missing, the waiter checks the exact existing turn once before reporting it as missing. No recovery path sends a second ChatGPT write. Do not send a new prompt solely to test whether the connection works.

## Access control

The MCP server binds to `127.0.0.1` by default, requires its own bearer token for every request, and validates HTTP Host and Origin headers. With `--host 0.0.0.0`, IP-address Host headers are allowed while DNS hostnames and non-local browser origins remain rejected. It does not enable browser CORS. The API gateway likewise requires its API token for client endpoints and grants browser CORS only to the paired extension origin or explicitly configured origins. Keep all three tokens private.
