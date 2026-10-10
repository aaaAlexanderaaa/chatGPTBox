# 2026-09-25 ChatGPT 新前端兼容

本次依据官网正常发送的数据流和页面实际加载的公开 JS 核对。新前端使用 Rspack 模块，网络请求标识为 `codex_webview`。旧版的两个运行时仍保留，插件根据代理页已经加载的 JS 选择对应实现。

## 主要差异

| 项目       | 原有两版                                                        | 2026-09-25 新版                                                                        |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 页面模块   | `4813494d-…` 的 ESM 导出                                        | `633146.03cad12214.js` 导出的原生 `__webpack_require__`                                |
| 发送方式   | 页面生成原生校验结果，内容脚本发送 HTTP 请求                    | 页面原生网络模块处理身份、登录恢复、请求头和 HTTP 请求，内容脚本接收响应字节           |
| 校验       | 原生 `finalize` 和同一 requirements 对应的 proof/Turnstile 缓存 | 原生完整性模块处理 prepare/challenge，再用原生 Request finalize；正式提交前完成        |
| 会话初始化 | 原发送路径不变                                                  | 发送前调用 `/backend-api/conversation/init`，携带实际会话、选定模型和时区              |
| 预热请求   | `client_prepare_state: none`，无 messages                       | `client_prepare_state: sent`，带 `partial_query`，无完整 messages                      |
| 隐私字段   | `history_and_training_disabled`                                 | `is_do_not_remember`，包括明确的 `false`                                               |
| 首轮父消息 | `client-created-root`                                           | 不发送该占位值；续聊保留真实 parent_message_id                                         |
| 用户消息   | 原有网页 metadata                                               | 新格式的 author、channel、status、recipient 等字段                                     |
| 页面上下文 | 原有页面尺寸等                                                  | `app_surface: codex_browser` 和实际推送能力/权限                                       |
| 返回流     | 兼容旧事件和 v1 delta                                           | 继续使用 v1 delta，保留断流后按 offset 续接                                            |
| 最新会话页 | 单数 `/conversation/:id` 的 mapping                             | 复数 `/conversations/:id?num_turns=10&include_has_versions=true` 的 messages/page_info |

新版仍使用 `/backend-api/f/conversation` 发送。旧配置若指向官方单数发送接口，新版会选择当前页面对应的 `/f/conversation`，旧页面沿用旧配置。

新会话页的 messages 是当前分支的有序列表。适配器转成已有解析器使用的 mapping，并保留 page_info。最新十轮只用于当前生成的状态读取；完整历史读取继续使用官网源码仍保留的单数完整会话接口，不能把十轮快照缓存成完整历史。

## 初始化是否影响发送

实际观察到三类初始化，作用不同：

- `/api/auth/session`：登录身份和会话。新版网络模块使用页面的原生登录状态，在需要时执行自己的令牌刷新和完整性状态恢复。扩展不复制这套恢复算法。
- `/backend-api/bootstrap`：页面启动配置，抓包响应包含 `statsig_user`。页面会自行完成这一步，扩展复用运行中的模块。
- `/backend-api/conversation/init`：按会话、模型、时区读取默认模型、模型限制、禁用功能和横幅信息。抓包及调用处没有显示它向正式请求提供 Sentinel 或 conduit token。此次为新版补上该调用，但不会用返回的默认模型替换用户明确选择的模型。

因此，初始化会影响页面使用的状态，但没有证据证明缺少某一次 init 就必然触发“零秒思考”。本次改动同时对齐原生身份处理、校验流程和请求格式，不把增加一个 init 当作修复全部问题的依据。

`generate_autocompletions`、统计请求及下一轮 Sentinel 预取可以与当前对话交错发生。扩展不通过伪造输入活动或统计事件来模拟人工操作。

## 实现和边界

入口是 `src/services/clients/chatgpt-web/client.mjs`。内容脚本通过现有后台处理器请求向同一个 ChatGPT 顶层文档注入 `page-integrity.mjs`；后台校验扩展 sender、来源和 documentId。新版分支只加载页面已加载的、清单明确匹配的原生运行时。

`page-transport.mjs` 将页面的状态码、允许的响应头和流字节转成标准 Response，供现有 SSE 解析器消费。身份及 Sentinel 凭据留在 MAIN。桥接使用独立通道，限制目的地址、方法和接口，并在结束、取消或页面离开时清理。正式 POST 不自动重试，每个通道仅允许一次；后续恢复只能请求已有会话的 resume。停止生成也使用新页面的原生网络模块和 stop_conversation 格式。

`runtime-contracts.json` 明确绑定运行时文件与模块 ID。未知版本、混合版本、身份切换或校验未完成时停止提交，不尝试给未知版本套用旧的混淆导出名。

`page-integrity.mjs` 被 executeScript 序列化到 MAIN，必须保持闭包自包含。构建已有的 Babel 排除规则需保留。

## 验证记录

已通过扩展网关验证新会话和同会话续聊。此处仅保留验证结论，不保留真实会话内容、标识、请求时间或响应统计：

- 新会话和续聊均成功返回完整答案，读回会话为完成状态。
- 核对了 init、conversation/prepare、Sentinel prepare、Sentinel finalize、conversation 的调用，确认使用新版原生网络模块。
- 验证了正式问题不重复提交，以及会话关联、思考设置、隐私字段和流编码的正确传递。
- 最终回归为 84 个测试文件、946 项测试通过；lint 和生产构建通过。三个受支持版本的生产注入函数均在独立 VM 中验证闭包可序列化。
- `npm run verify` 的 Yahoo 搜索配置检查因外部 TLS 连接失败未完成；这项检查不涉及 ChatGPT 请求代码。

这证明当前观测版本的发送和续聊可工作。服务端如何判定异常请求没有公开的可验证标志，不能据此保证所有后续请求都不会受服务端策略影响。

HAR 仅留在仓库外的本机临时目录。即使 DevTools 标注 sanitized，响应体仍可能含短期校验令牌，因此 Git 忽略所有 HAR 文件和 local-diagnostics 目录。仓库只保留官网公开版本清单和人工构造的测试占位值。

## 2026-09-30 运行时更新

代理页实际加载的运行时更新为 `633146.36cd53e1c6.js`。沿网页自身的 `k29.Request -> NI -> JW -> Pl` 调用关系核对，原生浏览器发送函数已移到 `Wk.c`；原有 `xb` 模块现在处理公告，不能沿用其导出名。

`k29.Request`、`OS` 和 `n9O` 的所需接口仍可用。`Wk.c` 保留 URL、请求选项、请求变换回调、身份检查回调及请求/流类型参数，并继续处理 `expectedIdentity` 与 `retry: never`。此次只增加该运行时对应的准确模块映射，旧版映射和未知版本拒绝机制均保留。

对比旧版公开脚本 `434385.a7f2495691.js` 中的 `xb.c` 与新版 `385910.c123c59539.js` 中的 `Wk.c`，新版增加第六个可选回调：认证恢复后可重新生成请求头和请求体，再检查当前身份并重发。扩展传入 `retry: never`，在进入该恢复重发分支前返回，因此无需提供新回调。

`runtime not supported` 表示扩展拒绝使用尚未核对或无法明确识别的运行时，不等于已证明网页接口无法兼容。当前匹配要求资源文件名完全一致，且只找到一个已知运行时；模块未就绪、模块 ID 不存在或所需导出不是函数时也会拒绝。此策略为 fail closed，单纯的构建哈希变化也需要更新映射；函数类型检查本身不能判断职责是否变化。

已通过 43 项运行时和原生传输相关测试、lint 与生产构建，并更新本机扩展。经本地网关发送一次自然问题，新会话成功返回完整答案，本地轮次状态为 `completed`。
## 2026-09-30 自动识别运行时

已知文件名仍用于快速查找。未知文件名现在触发能力识别，不再直接拒绝请求。
扩展只检查当前 ChatGPT 顶层页面实际加载的官方资源，寻找请求配置、账户方法、
校验准备/请求头函数，以及与请求模块相连且唯一的原生网络函数。
后台解析的是公开函数源码；账户凭据和校验结果留在网页 MAIN。

网络函数检查覆盖扩展实际使用的调用方式：首次 fetch 前有身份检查和断言回调，
`retry: never` 分支返回首次 HTTP 响应，不进入恢复重发。允许增加可选参数、
修改后续恢复分支及迁移模块/导出。连接时再次比对函数，避免检查期间模块变化。
新映射先执行只读 `/models` 检查，成功后按文档缓存；职责缺失、歧义或所需行为变化
仍停止发送。这些检查不能证明未来任意 JavaScript 的全部语义。

页面注入的检查函数与完整性函数均排除 Babel 转换，防止序列化后缺少扩展侧辅助函数。
生产构建的检查函数已在独立 VM 中验证，并对当前官网公开模块图验证了职责匹配。

列表中的占位标题从本地详情缓存补齐；保存详情同时更新两个列表标题字段，
后续占位标题不会覆盖已有真实标题。修复不额外请求官网历史。

### Drafts 发送标识恢复

原来的网关会把初始页面校验失败也记为 ambiguous，尽管正式问题尚未发送。
现在将明确未发送的事实逐层传回网关并释放发送标识。已有操作记录中，只对精确匹配
旧版运行时拒绝文字的 ambiguous 记录在下次使用时释放；断流解析错误、超时等保留保护。

Action 3 保存首次发送的请求参数，重试同一问题时不受之后模型/思考设置变化影响。
若编辑的问题与已成功的旧发送共用标识，网关返回原确认记录；脚本恢复原问题的状态，
将编辑文本留在 Waiting Reply，要求先 Get，不自动再次发送。结果仍不确定时保留标识。
Action 2 在 Get 时同时保留发送标识和对应请求参数。已安装的 Drafts 副本需更新两份脚本。

最终验证：92 个测试文件、1000 项测试通过，lint 和生产构建通过。本机扩展已重新加载，
网关在原有 18081 端口重启且桥接健康。最近两个受影响会话的 list/get 均返回真实标题。
HTTP 集成测试验证了明确未发送的释放、已成功请求的确认恢复、旧版运行时记录修复，
以及不确定结果不会触发第二次发送。

## 2026-10-08 GPT-6 Chat 适配

已登录账号的 Chat 目录新增 `gpt-6`、`gpt-6-instant` 和 `gpt-6-thinking`。
扩展与网关默认改为标准 Chat `gpt-6-thinking`，思考设置默认 `xhigh`。
官网 Chat 页面显示的 Extra High 在实际请求中使用 `thinking_effort: max`；
Chat 目录仍列 `min`、`standard`、`extended`、`max`，因此扩展将配置的 `xhigh`
映射为官网的 `max`。Work 模型继续保留其独立的 `xhigh` 参数。

当前公开运行时为 `633146.67e864aeea.js`。请求、账号、完整性模块分别移到
`Kwu`、`Qd`、`lXE`，原生发送函数移到 `wl.c`。发送函数的参数和身份检查保持兼容，
底层 fetch 现在由 `y3u.a` 包装，以 WeakMap 保存网络诊断；该包装只调用一次 fetch。
`retry: never` 仍返回首次响应，不进入认证恢复重发。此次增加该文件的准确模块映射，
保留原生校验和未知实现的能力检查，不复制账号凭据或校验结果。

验证：1010 项测试、lint 和生产构建通过。最终 Chromium 构建已更新并重载到 Brave；
设置页确认默认引擎为 `chatgptweb/gpt-6-thinking`，Thinking effort 为 `xhigh`。

### GPT-6 原生可视化与真实长任务验证

使用原样问题“整理一下最近5天的值得关注的新闻。可视化”，通过 Brave 扩展发送一次，
生成约 385 秒。实际参数为 `gpt-6-thinking`、`thinking_effort: max`；最终仍发送
`message_stream_complete` 与 `[DONE]`，并产生 `end_turn: true` 的可见合并答案。
简短确认回复不能验证这条链路。

新版答案使用 `metadata.model_dil_v2` 携带组件构造、常量和已解析引用；原始文本混有
`grid`、`box`、`table-row`、`Cite` 等新语法。静态解析组件构造并输出通用 HTML，
保留卡片、网格、事件表、关系图和引用链接，供扩展、网关和 Drafts Markdown Preview 使用。
不运行生成的 JavaScript、hooks 或事件处理器；不支持的组件保留官网 Markdown 回退。

流中的 `is_message_fragment` / `is_visually_hidden_from_conversation` 分片不再覆盖完整
`is_merged_message` 答案。明确 `end_turn: false` 的 `finished_successfully` 消息不视为
整轮完成；Drafts 两份 Get/Send 脚本保留同样的等待判断。

最终构建通过网关读取这次真实新闻会话，返回 HTTP 200、`pending: false` 和完整
可见合并答案。Brave 独立聊天页确认卡片、八行事件表、关系图及答案结尾正常展示；
Drafts Get 脚本使用同一真实响应验证保留 HTML 和结尾内容。本机未安装 Drafts，
因此未在 Drafts 应用中验证 Markdown Preview，已有动作需要替换仓库中的两份脚本。

### 2026-10-09 独立评估后的修复与部署复核

修复两项恢复和输出问题：可视化元数据晚于正文到达时，API 桥接页等待完整答案再
向网关输出，避免已经发送的纯文本被 HTML 替换；`stream: true` 等待期间仍有 SSE
心跳，完成后发送正文、`stop` 和 `[DONE]`。扩展聊天界面仍可接收中间快照。
恢复查询的非终态消息锚点可被当前分支、同一用户轮次的最终答案取代，不跨分支或
跨轮次替换，也保留显式定位已完成答案的行为。

新增 9 项回归，覆盖首流、resume、历史轮询中的晚到元数据，执行真实 API 桥接页
请求处理器，并检查锚点切换边界。全量 1049 项测试、lint 和生产构建通过。
已更新 Brave 实际加载的扩展目录，重载扩展、重新打开桥接页并刷新代理页。
网关和 MCP 沿用原配置重启；复核网关健康及桥接连接、MCP 初始化及 `ask_chatgpt`
工具列表均成功，认证令牌未更换。

通过新运行态只读刷新已有新闻可视化会话，来源为 network，返回 HTTP 200、
`pending: false`、`isFinal: true`，保留网格、八行事件表、引用和答案尾部。
本轮没有发送新的长任务，也没有更新或复验 Drafts 应用中的动作副本。

### 2026-10-10 Drafts Reply Conversation 的运行时识别失败

官网代理页已加载 `633146.4de433ac01.js`。请求、账户、完整性与网络模块仍分别为
`Kwu`、`Qd`、`lXE`、`wl.c`，但账户模块删除了 `isSameBrowserRequestAuthContext`。
旧映射未包含该版本，能力识别又要求已删除的导出，因此在正式发送之前返回
`Could not identify a unique compatible ChatGPT request, account, verification and network transport`。
官网聊天可以正常使用；这条错误不表示账户失效或 Drafts 无法连上网关。

新增该公开版本的准确映射，使用原生 `getBrowserChatGptAuthGeneration` 固定认证状态。
连接及每次发送前仍核对账户、用户、工作区切换、认证版本和当前 token；认证状态改变时
停止提交。旧版本继续使用原来的上下文比较。官网 `wl.c` 仍在首次发送前检查
`expectedIdentity` 并调用传入的断言，传递取消 signal；`retry: never` 直接返回首次响应。
底层 `y3u.a` 包装仍只调用一次 fetch，不放宽未知运行时的识别规则。

新增 11 项合成回归，覆盖新版连接、正式提交一次、账户/用户/token/认证版本变化、
工作区切换、校验期间状态变化与无效版本号。全量 1123 项测试、lint 和生产构建通过；
生产包中的 MAIN 注入函数在独立环境中确认自包含。Brave 实际加载目录已更新并重载，
代理页刷新后通过已安装扩展建立原生通道，只读 `/backend-api/models` 返回 HTTP 200。
原有 18081 网关进程与认证配置保留，API Server 桥接页面已恢复连接且健康。
通过本机 Tailscale 地址访问 18081 的健康接口也返回 HTTP 200，桥接处于 connected。

Drafts 经 Tailscale 访问 18081 时，网关监听所有 IPv4 接口；运行时检查只针对专用
`chatgpt.com/?chatgptbox_proxy=1` 顶层页面，账户请求监听只覆盖该浏览器的 ChatGPT
会话接口，不进行网段扫描。此次未改变 Drafts Action 2/3 契约，没有发送新的用户问题，
也未在用户的 Drafts 设备上验证完整发送流程。
