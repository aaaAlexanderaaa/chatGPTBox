---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-11-13
---

> The 2026-10-22 review classified this existing interface document and
> checked its source ownership. It did not repeat live-account validation
> of every protocol claim. Verification remains partial.

# ChatGPTBox MCP Server

The MCP server is a separate Streamable HTTP service, normally at
`http://127.0.0.1:18081/mcp`. It uses the same
[engine operations](engine-contract.md) as API and extension clients.
`ask_chatgpt(query)` remains the compatible isolated ChatGPT alias; `ask_engine`
and `get_engine_run` add generic generation and observation without another
provider-specific waiter.

## Start

1. Log in to `chatgpt.com` in the browser, open the extension's `Advanced -> API Server Bridge -> Open API Server Bridge` page, and enable the bridge. Keep that page open.
2. Run `npm run api-server`. Pair the page with the printed **Bridge token**.
3. Run `npm run mcp-server` in another terminal.
4. Configure your MCP client with the HTTP URL `http://127.0.0.1:18081/mcp` and `Authorization: Bearer <MCP token>`. The MCP token is generated in `~/.chatgptbox/mcp-token` on first startup. This is separate from the gateway API token and the extension bridge token.

The MCP process reads the existing gateway API token from
`~/.chatgptbox/gateway-api-token`. If the gateway uses `--api-token` or
`CHATGPT_GATEWAY_API_TOKEN`, set that same `CHATGPT_GATEWAY_API_TOKEN` in the MCP
process environment. API and MCP share the gateway caller identity, engine grants
and run access. There is no separate gateway MCP token or MCP engine grant.
The public MCP token stays at `~/.chatgptbox/mcp-token`; the existing API,
public MCP and bridge tokens do not need to change.

Use `--data-dir` or `CHATGPT_GATEWAY_DATA_DIR` consistently when relocating token
storage. Gateway port defaults to 18080 (`--gateway-port` or
`CHATGPT_GATEWAY_PORT`); MCP port defaults to 18081 (`--port` or
`CHATGPT_MCP_PORT`). In `Settings → Engines → External engine access`, the engine
must be enabled and externally open for the requested operation. The same grant
applies to API and MCP, including Grok/Gemini when enabled and externally open.

To accept MCP clients on other devices, explicitly bind the MCP server to all IPv4 interfaces. For an API gateway already running on port 18081, start the MCP server on a different port:

```bash
npm run mcp-server -- --host 0.0.0.0 --port 18082 --gateway-port 18081
```

Set the remote client's URL to `http://<this-computer's-IP>:18082/mcp` and use the MCP bearer token. The `--host` option (or `CHATGPT_MCP_HOST`) defaults to `127.0.0.1`; it accepts `127.0.0.1` or `0.0.0.0`. The API gateway connection remains local to this computer. Keep the MCP token private and use a trusted network or TLS when connecting across networks; plain HTTP exposes the token to network observers.

## Generic tools

- `ask_engine({engine_id, query, model_id?})` starts an independent run on an
  authorized engine and waits for a verified final result. Omitted `model_id`
  delegates to that adapter's configured default. Context must be explicit.
- `get_engine_run({run_id, recover?})` reads an existing gateway run shared with
  API clients. `recover: true` asks for exact readonly recovery where adapted;
  it never submits input. It does not grant native-history browsing.
- `ask_chatgpt({query})` retains its strict query-only schema, account defaults,
  context-isolation instructions and old final text/structured fields. It adds
  `run_id`, `engine_id` and result format for observation.

A cancelled or timed-out wait can leave the original engine running. Continue
by reading the known `run_id`, not by sending the question again. A completed run
whose result body is no longer obtainable returns an explicit unavailable error.
While its original writer is active, observation polls that writer's run and does
not compete with it through native recovery. A refused read or recovery after
registration cannot prove that generation was unsent: errors preserve the known
run ID and report accepted/possibly-submitted state unless a terminal run itself
supplies positive unsent proof. A busy readonly recovery can be observed again;
it never starts another question.

## Tool

`ask_chatgpt` creates a **new, isolated conversation on every call** and waits for
its final answer through the common run service. Consecutive
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

`ask_chatgpt` accepts only `query`. The server automatically appends this response preference to the question: "请直接以文本回答；如有参考链接，请附上链接。请不要创建文件、代码或图片，我的浏览器无法在当前页面打开或加载这些内容。" Its ordinary text result contains only the final answer; `structuredContent` also contains the conversation and message IDs and `thought_duration_seconds` for diagnostics. The duration sums ChatGPT Web's reported `finished_duration_sec` values for the turn. It is `null` if ChatGPT does not report a duration; it is never inferred from the MCP call's elapsed time. The MCP server does not expose native conversation listing, continuation, or arbitrary native-turn lookup. `get_engine_run` observes only runs owned by its credential. The server generates an internal idempotency key for each dispatch; an ambiguous dispatch is reported as an error, not automatically resent.

The server permits **four active generation calls across `ask_chatgpt` and `ask_engine`**. A fifth call returns a `concurrency_limit` error before sending a message to an engine. Wait for an active call to finish before retrying.

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

The MCP server sends one `POST /engines/:id/runs` with an idempotency key and
receives a local run receipt. It waits on `GET /runs/:id`, every 10 seconds by
default. Ordinary polls never read the provider. When the run is recoverable,
exact readonly recovery is bounded to once per minute and shared by the
background owner. ChatGPT supports it; Grok/Gemini report it as unadapted.
Neither missing local output, bridge reconnection nor a lost acknowledgement
causes another generation request.

Only a common completed run with nonempty available final content ends a call
successfully. A stale cache, preview or same-text older question cannot do so.
The response uses SSE keepalive comments and optional progress notifications.
The default wait is 45 minutes (`CHATGPT_MCP_WAIT_SECONDS`, maximum two hours).
Cancellation detaches observation; it does not request remote cancellation.
Errors retain the known `run_id` and forbid write retries. `get_engine_run` can
continue observation with the same credential, including after external access
is turned off. The gateway API credential is shared with API clients; there is
no separate per-engine MCP grant to revoke.

The runtime protects execution metadata separately from its 30 finished in-memory
results. Worker restart can make a previously completed body unavailable; exact
recovery may recover that body when supported. Unknown effects and native holds
are not cleared by result eviction, toggles or upgrades. Manual review in Engines
allows new work while retaining the original outcome as unconfirmed and retiring
its old continuation binding. This does not make an uncertain run completed.

## Access control

The MCP server binds to `127.0.0.1` by default, requires its own bearer token for every request, and validates HTTP Host and Origin headers. With `--host 0.0.0.0`, IP-address Host headers are allowed while DNS hostnames and non-local browser origins remain rejected. It does not enable browser CORS. The API gateway likewise requires its API token for client endpoints and grants browser CORS only to the paired extension origin or explicitly configured origins. API and MCP use the same gateway principal and can read the same gateway runs. The public MCP endpoint retains its existing MCP token; the extension bridge retains its bridge token.
