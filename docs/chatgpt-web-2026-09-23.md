# ChatGPT Web 2026-09-23 对比与适配

本次依据仓库内提供的两组前端 JS 分析，不代表已经用真实账号验证了线上接口。
原 `current/new-2026.09.23/` 的三个核心文件已提升到 `current/`，旧三个文件移到
`archive/`，新增的三个路由入口保留到 `current/routes/`。

## 这些文件在项目中做什么

`resources` 里的代码是 ChatGPT 网页打包后的参考源码，扩展不会直接执行或导入它们。
构建时 `sync-protocol-reference.mjs` 从文件中的协议特征识别职责，生成文件名映射；
扩展的协议检测功能再用这些特征判断 ChatGPT 网页有没有变动。

真正发送请求的是 `src/services/clients/chatgpt-web/client.mjs`。扩展的聊天界面提交
问题后，后台的 `providers/chatgpt-web.mjs` 经 `chatgpt-proxy-service.mjs` 转发到
专用 `chatgpt.com` 标签页，该页面里的客户端调用 `POST /backend-api/f/conversation`。
本地 API 网关也通过扩展桥接到这条链路。因此，替换参考 JS 本身不会修好请求代码。

## 新旧差异

| 部分 | 旧 current | 2026-09-23 | 对项目的影响 |
| --- | --- | --- | --- |
| 会话编排 | `8b34dbc2-kjj15hg4y6iyx13p.js` | `8b34dbc2-jcq3z9svhxjfed5y.js` | 调整请求路由、事件处理、Work 恢复等逻辑 |
| SSE、token 存储、轮询 | `conversation-small-hiw4wce20lu6te81.js` | `conversation-small-dem1o3a5ym7cm94l.js` | delta 解码和通用续传控制器已移出此文件 |
| WebSocket 及共享逻辑 | `4813494d-hrplraurzfyvxb10.js` | `4813494d-fyc7wvz5e3kse9ep.js` | 现在还包含 `delta_encoding`、`resume_conversation_token` 和通用续传控制器 |
| 路由入口 | 旧快照未提供 | 三个 `_conversation*` 小文件 | 主要是初始化和导出 loader/组件，并非三种新的聊天协议 |
| 请求地址选择 | 可按模型开关走 `/backend-alt` | 编排中的 `K0t()` 统一选择 `/backend-api` 或 `/backend-anon` | 本项目登录态默认已使用 `/backend-api`，无需新增接口或改设置 |
| 消息关系 | 旧编排无此事件 | 新增 `streaming_parent_patch` | 更新多个消息在同一逻辑回答中的显示顺序，不是文本片段 |
| Work 恢复 | 较早的轮询处理 | 新增部分结果、被新请求取代及异步交接等恢复分支 | 属于官网完整 Work 界面功能，本项目没有照搬其多消息界面 |

最容易误判的是文件拆分：旧检测要求 `conversation-small` 必须有
`delta_encoding` 和 `resume_conversation_token`，新版缺少这两个字符串不意味着
协议被删除，它们只是移到了 `4813494d`。

以下核心协议在两组文件中都存在，并不是本次新增：

- 初次提交走 `/f/conversation`；恢复已有回答走 `/f/conversation/resume`，请求体为
  `{ conversation_id, offset }`，有 token 时带 `X-Conduit-Token`。
- `stream_handoff` 可提供 `resume_sse_endpoint` 或 `subscribe_ws_topic`。
  HTTP resume 使用 conversation id；不能把 WebSocket 的 `topic_id` 当作必填条件。
- delta v1 使用 `c/p/o/v` 短键，省略 channel、path、op 时沿用前一个 delta 的值。
- 续传控制器允许无 token、offset 为 0 的尝试；一旦 offset 大于 0 且仍无 token，
  就不能继续重试。临时聊天不进入官网自动续传分支。
- 重试上限是连续失败 12 次，收到事件后连续失败计数清零，并非整轮回答最多断线 12 次。
- 重试 HTTP 状态仍为 408、409、425、429、502、504。退避为
  `min(300 × 1.5^attempt, 5000) × [0.5, 1.0)` 毫秒，attempt 从 1 开始。

上述续传控制器在旧 transport 的 `uon` 与新 WebSocket 文件的 `ebe` 中可以逐段对照。
旧文档中“没有 token 就一定只能轮询”的说法不准确，已修正。

## 已修改的代码

1. **协议检测**：更新 `specs.mjs` 中三个文件的职责和必需特征，重新生成
   `chatgpt-web-current.mjs`。测试直接读取实际参考文件，避免只测模拟字符串。
2. **首个响应也解码 delta**：`client.mjs` 接入已有 delta 累积器。之前初次提交的
   SSE 只按完整 `{ message }` 读取，遇到压缩 delta 会丢失文本。这是原有兼容缺口。
3. **断线保留解码状态**：初次 SSE 被截断或读取失败时，调用 resume 并保留之前的
   文本和短键状态；已正常结束的 handoff 则从 offset 0 开始新解码器。不会重新提交问题。
   空流缺少结束标记时不会直接返回成功，工具消息也不会覆盖助手答案。
4. **续传策略**：允许普通会话在 offset 0 时无 token 尝试，失败后按现有逻辑轮询；
   非零 offset 无 token 不重试。自动续传排除临时聊天。
5. **续传解析**：兼容完整消息与 delta；支持响应头中的 token 更新；收到事件后重置
   连续重试计数。已有完整最终答案且流已结束时，不再仅因模型支持 thinking 而继续轮询。
6. **控制事件**：`streaming_parent_patch` 不会作为回答文本输出，也不代表生成结束。
   当前界面仍按已有单回答模式展示，没有实现官网多消息重排界面。

## 验证与后续使用

回归测试覆盖：实际新 bundle 的协议识别、初次 SSE 的 delta v1、短键延续、EOF 和
真实 reader 错误后的恢复、问题只提交一次、token 更新、连续重试重置、无 token 限制、
完整消息兼容，以及新增控制事件不污染回答。

```sh
npm run sync-protocol-reference
npm test
npm run lint
npm run verify
npm run build
```

构建后在浏览器扩展管理页重新加载 ChatGPTBox，并刷新专用 `chatgpt.com` 代理标签页，
让新客户端代码生效。需要登录账号才能进一步验证实际发送、长时间思考和断网恢复。

本次本地验证：82 个测试文件、881 个测试通过，lint 和生产构建通过；已生成 Chromium、
Firefox 及各自不含 KaTeX/tiktoken 的四个 ZIP。搜索引擎校验中 Bing、
百度和 Naver 通过，Yahoo 日本的桌面和移动请求因 TLS 连接失败未通过；这项外部
网络校验与 ChatGPT 协议适配无关。

边界：本次没有实现官网 `subscribe_ws_topic` 的完整订阅链路，仍通过 HTTP resume
接续回答；也没有复制 Work、语音、附件、批注和网页 UI 的全部变化。

## 2026-09-24：修复带引号的编码声明

实测错误 `[delta] unknown delta encoding: "v1"` 暴露了上一轮测试的缺口：
测试数据使用裸文本 `data: v1`，实际响应可以是 JSON 字符串 `data: "v1"`。
官网传输层会先 `JSON.parse` 再送给 delta 解码器；本项目的 SSE 回调拿到的是原始文本。

现在共享累积器先解析编码声明，再验证是否为 `v1`，同时兼容旧的裸文本形式。
首个响应与 resume 响应均已加入经过真实 SSE 读取器的回归测试；未知版本和损坏的
声明仍然报错。修复不需要修改模型、账号或 API 地址。

本地安装使用 `npm run build:extension`，构建成功后同步到
`../browser-extensions/chatgptbox/`。更新后需重新加载扩展，并刷新专用 ChatGPT
代理标签页和 API Server 桥接页，确保它们不再运行旧脚本。

## 2026-09-24：对照正常请求，补齐准备流程和思考参数

用户提供的正常请求选择 `gpt-5-6-thinking`、`thinking_effort: max`，同时带有
`client_prepare_state: success` 和 `X-Conduit-Token`。对应 SSE 共 230 个事件，包含
`thoughts`、`reasoning_recap`、工具消息和最终答案；服务端报告思考耗时 164 秒。
用仓库的 SSE 解析器按 37 字节分块回放该样本后，能够完整解码并识别这些状态。
附件中的账号凭证和原始问答没有复制进仓库，也没有重放其网络请求。

对照参考源码与插件，确认并修复两处独立缺口：

1. **准备状态与请求不符。** 之前插件没有调用准备接口，却固定填写 `success`。
   现在专用 ChatGPT 标签页先发 `POST /backend-api/f/conversation/prepare`，携带本轮
   的模型、思考强度、父消息和历史设置，不携带用户消息。成功后把返回的当前
   `conduit_token` 放入正式 `/f/conversation` 请求的 `X-Conduit-Token`，两次请求
   共用 turn trace。失败时按参考客户端逻辑继续提交，但状态如实填写 `failure`；
   未执行准备的旧接口填写 `none`。取消准备不会继续发送问题。
2. **自定义网关接口丢失思考强度。** `/v1/chat/completions` 原本已支持强度参数，
   但 `/chatgpt/conversations` 和 `/chatgpt/conversations/:id/messages` 没有传递它。
   现在网关将 `thinking_effort` 或 `reasoning_effort` 传给扩展 API Server 桥接页，
   桥接页转给后台的创建/续发函数，再写入发送客户端的会话覆盖参数。无效值在提交前
   报错；未传参数时继续使用插件设置。`think: true` 是读取思考记录的选项，不是强度。

例如，自定义创建接口的请求体可明确指定：

```json
{
  "query": "需要回答的问题",
  "model": "gpt-5-6-thinking",
  "thinking_effort": "max"
}
```

该接口原有的 `Idempotency-Key` 要求保持不变。修改了网关脚本，因此使用本地网关时
还需要重启 `npm run api-server`，只重新加载扩展不会更新已经运行的 Node 进程。

**如何核实“没有思考”：** 插件在 max/extended 模式下默认等待最终答案，不展示完整的
官网中间过程。界面只出现最终答案，并不能单独证明服务端没有思考或触发了保护机制。
本次新增 `chatgptWebResponseDiagnostics`，在首个 SSE 和 resume 中记录服务器报告的
模型、思考强度、是否观察到思考事件及耗时，不收集思考文本。开启 ChatGPT Web 模块的
`Debug ChatGPT Web Requests` 后，可在 `ChatGPT Web Debug Viewer` 的 `completed`
日志中查看 `responseDiagnostics`；准备结果在 `conversation-prepare` 日志中。
`reasoningObserved: false` 只表示接收的事件中没有观察到证据，不代表确定没思考；
仅通过历史轮询恢复的消息也可能缺少流中的思考事件。

当前修复经离线样本和模拟请求验证，尚无插件异常响应的对照样本，不能据此宣称已经
消除了账号保护或服务端降级。若重新加载后仍异常，应对照官网同一会话的思考记录、
`conversation-prepare` 状态及 `completed.responseDiagnostics`，再定位实际差异。

本轮验证：82 个测试文件、903 个测试通过；lint、生产构建和安装同步均通过。
新增回归覆盖准备成功/失败/取消、正式提交只发生一次、准备 token 可用于续传、
首流与续传中的思考证据，以及创建/续发接口的思考强度传递与非法参数校验。

## 后续抓包与修复：Sentinel 校验链路

用户反馈上述版本仍有“思考 0 秒直接回答”，并补充了正常网页的 conversation prepare、
Sentinel prepare 和 Sentinel finalize 请求。此前通过的测试证明了已覆盖的请求构造和
流解析行为，不能证明线上请求已获得与官网相同的校验结果。

### 两个 prepare 各有用途

| 接口 | 参考源码中的用途 | 关键关联字段 |
| --- | --- | --- |
| `/backend-api/f/conversation/prepare` | 为会话请求准备路由，可携带输入草稿 `partial_query` | 响应 `conduit_token` → conversation 的 `X-Conduit-Token` |
| `/backend-api/sentinel/chat-requirements/prepare` | 用当前页面提供的 `p` 获取本次校验要求 | 响应 `prepare_token`，以及 `turnstile`、`proofofwork` 等要求 |
| `/backend-api/sentinel/chat-requirements/finalize` | 提交 prepare token 和要求的校验结果 | 请求含 `prepare_token`，按需含 `proofofwork`、`turnstile`；响应合并回校验状态 |
| `/backend-api/conversation/experimental/generate_autocompletions` | 为编辑器生成输入建议，源码会把失败转换为空建议 | 可复用 conduit token；不是已确认的回答前置条件 |
| `.../v1/rgstr?k=client-...` | Statsig / 客户端事件上报 | `k` 属于上报客户端配置，不是会话的 conduit token |
| `/backend-api/conversation/:id/stream_status` | 查询并恢复仍在进行的回答 | `IS_STREAMING` 表示流仍在进行，不能说明思考时长或校验是否通过 |

Sentinel 流程位于 `4813494d-fyc7wvz5e3kse9ep.js` 的 `KYt`、`QYt`、`I2` 等函数。
`KYt` 先获取 prepare 响应，再取得要求的校验结果，然后 finalize；`QYt` 管理预取和
缓存。该快照中缓存期限为 9 分钟，供后续发送取用，并非每个 conversation 都必须在
Network 列表中紧邻一对新的 prepare/finalize。

编排文件 `8b34dbc2-jcq3z9svhxjfed5y.js` 还明确调用 `hee('pageload')`、
`hee('typing_refresh')` 和 `hee('next_turn')`：页面加载、输入刷新以及本轮流启动附近
都可能预取校验材料。`next_turn` 调用尤其解释了为什么可以在 conversation 之后看到
新的 prepare/finalize。部分功能开关还允许拿 prepared 状态先发送，使用
`OpenAI-Sentinel-Chat-Requirements-Prepare-Token`。应关联 token 的来源和用途，
不能只按请求出现顺序判断它属于哪一轮。

### 修复前确认的缺口

- 原 `client.mjs:getRequirements` 调用旧的 `/sentinel/chat-requirements`，未带新版
  prepare 的 `p`，也未实现上述 prepare/finalize 流程。
- 获取 requirements 的失败会被 `.catch(() => undefined)` 吞掉，随后仍可能发送问题。
- 本地 `generateProofToken` 仍采用旧实现；不能把它视为已经对齐这次参考快照。
- `extractChatgptWebTurnstileToken` 只读取现成 token 字段，不执行网页校验流程。
  新提供的正常 finalize 请求确实携带 `proofofwork` 和 `turnstile` 结果。
- 新 prepare 样本还带有 `partial_query`、`client_prepare_dispatch: debounced` 和
  `client_prepare_source: composer_editor_state`。这些说明官网从编辑器预取；参考源码
  将它们作为可选参数，不能据此认定复制这些字段就能消除异常。

这些是静态源码可确认的差异；尚不能将“0 秒回答”确定归因于某一个差异。

### 改为调用当前页面的原生校验实现

本轮修改直接作用于提交前的请求流程：

1. ChatGPT 代理页中的扩展内容脚本向扩展后台请求校验。后台核对扩展来源、
   `chatgpt.com` 顶层页面和文档身份，再在同一页面的 MAIN world 执行桥接函数。
2. 桥接函数只使用页面已经加载的、与参考快照精确匹配的官方模块。调用其 finalized
   requirements 接口，由网页自己的实现消费有效预取，或完成 Sentinel prepare、
   要求的校验和 finalize。移除了插件旧的 requirements 请求和本地 proof 生成代码。
3. 正式请求、conversation prepare 和 resume 均使用页面实际的认证、账号、设备、
   会话和版本信息；校验头仅放入正式提交。不会再用每次生成的 websocket 请求 ID
   代替页面 session ID，也不会重放抓包中的 token。
4. 校验失败、超时、要求重新登录、账号在校验途中变化、返回不完整结果或网页版本
   不匹配时，直接返回错误，禁止提交问题。取消等待也不会继续提交问题。

实现位于 `src/services/clients/chatgpt-web/page-integrity.mjs` 和
`src/background/chatgpt-page-integrity.mjs`。原生函数依赖的模块名及压缩导出名通过
`resources/chatgpt-web/integrity/runtime-contracts.json` 绑定具体快照。
实测发现旧会话仍加载 2026-09-23 的模块，新代理页已加载
`4813494d-ntf51ax9e0u08606.js`；新版本的认证头导出由 `vtt` 变为 `Ctt`。
已从浏览器加载的官方公开资源核对并保存新参考，支持这两个版本；以后发布新版本仍需
重新核对并更新映射，不能盲目套用旧导出名。
桥接只支持官方 `https://chatgpt.com` conversation 地址，不向自定义地址发送页面凭证。
不模拟编辑器输入或遥测，也不自行重写网页挑战算法。网页要求人工验证时需在代理页完成。

验证：83 个测试文件、933 项测试通过，lint 通过。真实浏览器中已确认对应官方模块已加载，
并核对 finalized、proof、turnstile、认证头和校验头接口类型。测试覆盖原生结果不完整、
校验失败、超时、未知版本、账号切换、取消、后台调用来源限制，以及失败时不提交问题。
生产构建需要保留注入函数的原生语法，否则 Babel 引入的扩展辅助函数无法随
`executeScript` 的函数序列化进入页面。已调整构建规则，并从最终生产包提取该函数，
在无扩展辅助代码的独立环境验证两个版本；安装目录与构建产物校验一致。

真实网关测试使用 `gpt-5-6-thinking`、`max`，通过已连接的 18081 网关请求一道计数题，
返回 HTTP 200，耗时 24.7 秒，得到完整答案 70。随后读取同一测试会话的服务端记录，
确认 `reasoning_recap` 的模型及 resolved model 均为 `gpt-5-6-thinking`，强度 `max`，
`reasoning_status: reasoning_ended`，`finished_duration_sec: 9`；最终消息也报告同一模型及强度。
核对过程仅提取 metadata，没有收集思考文本。初次测试遇到未适配的新页面版本时，
正确在提交问题前拦截；核对新版本映射后再测试成功。单次成功不能保证今后所有请求
都不会触发服务端限制。
