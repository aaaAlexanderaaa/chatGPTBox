# 已验证的经验与试错

本记录归纳 2026-09-23 至 2026-10-08 的项目会话、代码和维护文档。
通过 `npx @cchistory/lite` 按本仓库目录查看近期会话，进一步读了五个相关会话中的
37 条用户交互。原文和工具输出只用于本机分析，不随 skill 保存。
历史中的操作许可不授权未来任务；以下版本事实需要在下一次适配时重新核实。

## 2026-11-18：补齐拆分诊断路由的自动能力发现与最新映射

11-16 留下的精确映射在工作区又被补充了 `633146.fca4831b46.js` 与当前首页公开资产
`633146.332c5da428.js`；但未知构建自动发现仍会失败，因为官网从 11-16 起将遥测路由从
`maGL` 拆入 `KZHh`。核对 `633146.af31399bc4.js`、`633146.fca4831b46.js` 与
`633146.332c5da428.js` 公开启动 chunk 后确认：

- `Kwur` 与 `lXEa` 位于 `7078.*`，`QdUF` 与 `KZHh` 位于 `337882.*`，`y3uJ` 与
  `maGL` 位于 `646436.611d2d0d1b.js`（旧版在 `7078.f7d405f05f.js`），`HFSu` 与
  `wl0r` 位于 `76629.*`；两份新版的 `Kwur`、`QdUF`、`lXEa`、`wl0r.d`（仅 `auth_retry`
  变量名重命名为 `G`/`K`）保持原有身份、取消和 `retry: never` 行为。
- `maGL` 只含 `ces_diag_id` 而不再含 `/ces/v1/rgstr`；`KZHh` 只导出同源遥测路径匹配
  `c(pathname)`（仅允许 `/ces/v1/rgstr` 与 `/ces/v1/%72gstr`）。此外 Rspack 将
  `maGL.c` 的首次请求观察门控与 `!u || !f` 合并为一条 `IfStatement` 的 `SequenceExpression`
  （共 5 条顶层语句），且局部 `let s`、`let u` 遮蔽了外层 `KZHh` 导入和 `u(url)` 守卫函数。

本次修复同时覆盖自动发现与快速路径：

1. [runtime-inspection.mjs](../../../../src/services/clients/chatgpt-web/runtime-inspection.mjs)
   的 `delegateRole` 改为匹配 `'ces_diag_id'` 或 `'/ces/v1/rgstr'`，继续作为候选线索。
2. [runtime-fetch-capabilities.mjs](../../../../src/services/clients/chatgpt-web/runtime-fetch-capabilities.mjs)
   新增 `hasCompatibleChatgptWebTelemetryRoute` 与拆分代理校验，支持 5/6 语句形态与词法作用域
   遮蔽检查（`mutatesScoped`），保留 10-31 合并形态并拒绝放宽路径、源站、POST 门控、
   参数/选项/响应/异常篡改或额外 `fetch`/`send` 调用的变体。
3. [runtime-capabilities.mjs](../../../../src/services/clients/chatgpt-web/runtime-capabilities.mjs)
   将 `y3uJ`、`maGL`、`KZHh` 三层一起写入 `capabilityCheck.fetchWrappers`，由 MAIN 在连接前和
   每次请求前继续比对三者工厂与导出源码。

在从 `633146.332c5da428.js` 公开启动资源静态提取的全部 8,121 个模块上运行
`resolveChatgptWebRuntimeCapabilities` 可唯一解析整套角色与三层包装。核心运行时回归 210 项、
ChatGPT Web 与适配器相关 23 个文件 704 项通过；四个生产压缩包构建后提取的两段序列化 MAIN
函数在无外部辅助函数的 VM 中通过源站拒绝与拆分遥测发现。随后执行 `npm run build:extension`
替换本机 Chromium 安装目录（29 个文件逐一与 `build/chromium` SHA-256 一致，`background.js`
哈希为 `b2bc7e731b71a831da044b217c3682558451f8521917f755cb37f256e4ec90b0`），用户在 Brave 重载扩展并刷新代理页与桥接页后，通过既有 `18081` 网关完成只读核验：`GET /health` 为 `200`（`healthy`、`websocket`、`pending_requests: 0`）、`GET /engines` 为 `200`、`GET /v1/models` 为 `200`（770 ms，刷新返回 25 个 `chatgptweb` 模型）、`GET /chatgpt/projects` 为 `200`（2,341 ms，3 条）。本次未向真实 ChatGPT 账号发送正式提问。

来源：[版本映射](../../../../resources/chatgpt-web/integrity/runtime-contracts.json)、
[能力识别](../../../../src/services/clients/chatgpt-web/runtime-fetch-capabilities.mjs)、
[能力回归](../../../../tests/chatgpt-web-runtime-capabilities.test.mjs)。

## 2026-11-16：诊断职责拆分后，分别核对刷新前后的版本

发送前兼容拒绝复现于 `633146.7f86ed336a.js`。其原生请求、认证和完整性职责仍在
`Kwur`、`QdUF` 和 `lXEa`，网络入口仍为 `wl0r.d`；但跟踪包装器 `y3uJ.a`
转交 `maGL.c`，诊断路由常量又移到 `KZHh`。原发现器要求诊断模块同时包含
`ces_diag_id` 与 `/ces/v1/rgstr`，因此漏掉新的代理；代理函数结构也已改变。
不能仅扩大文本候选就宣称未知版本的能力校验已经适配。

核对公开调用关系后，确认诊断分支仅处理同源、无 URL 凭据的
`/ces/v1/rgstr` 与 `/ces/v1/%72gstr`；conversation 请求直接经过传入的 fetch，
两条分支各只有一次网络调用，响应与异常透传。本次只增加已核对版本的精确映射，
未知版本仍保留原有拒绝边界；未改身份、取消、校验或重试策略。

刷新代理页后实际运行时变为 `633146.af31399bc4.js`，第一次完整检查仍明确返回
`not_attempted`，没有提交新问题。该版本的诊断包装器和路由模块与刷新前一致，
网络函数的导入及局部名称有所变化，身份、取消和 no-retry 检查仍通过。
两份版本的原生只读 `/models` 均返回 HTTP 200；刷新后的版本也纳入精确映射和
受控单次发送回归。已加载文档、刷新后文档和真正发送的后台路径必须分别确认，
旧文档只读成功不能代替重载后的完整发送验收。

最终在刷新后版本经 MCP 正式提交一条项目审查问题并完成，总等待约 145 秒，
服务端思考 119 秒。精确轮次的强制网络 GET 确认唯一用户消息、完整最终回答、
引用尾部和 `pending: false`；run 为 `accepted/completed`，模型为 `gpt-6-thinking`，
会话默认模型一致。本次没有记录 wire 思考强度，也未对旧文档版本做真实写入。
审查基于所提供事实，未直接读取本地源码；其指出的真实发送证据缺口由该次完成与
后续 GET 补齐，不能把审查回复本身当作所有本机效果的独立证明。

180 项相关回归通过，完整套件 2,232 项通过，仍有两项既有 Drafts 测试失败；
lint 与文档检查通过。四种生产包已构建并更新本机安装，后台文件哈希一致，扩展
Reload 和代理页刷新已执行；原网关进程的桥接恢复 healthy。Drafts 动作契约未改，
没有替换其副本，也未在 Drafts App 中运行 Send。

来源：[版本映射](../../../../resources/chatgpt-web/integrity/runtime-contracts.json)、
[原生传输回归](../../../../tests/chatgpt-web-native-transport.test.mjs)。

## 2026-11-16：未读状态不是仍在生成

Drafts Send 拒绝下一问时，原轮次的精确 user/assistant 身份和最终回答已经存在，
但统一快照把所有非空 `async_status` 都标为 pending。当前官网公开模块
`200429.b3f88f116c.js` 的常量对象声明 `STREAMING: 3`、`UNREAD: 4` 和实时状态 5–7；
完成恢复单独接受 UNREAD。旧参考还将 2 命名为 DEPRECATED_FINISHED。
把数值 2/4 当成非运行状态，继续要求精确轮次、非空最终正文和非过期网络证据。
未读本身不能证明完成；未知数值、字符串和冲突的运行状态仍受保护。

先遇到的 `Failed to fetch` 是另一层问题：刷新空闲专用代理页后网络读取恢复，
但 pending 误判仍复现。因此不能只刷新页面就宣布故障修好，也不能凭旧缓存清锁。
源码回归覆盖 UNREAD 的精确恢复、非终态片段、Get 保留下一问并解除已完成轮次等待。
当前打包格式已不保留 DEPRECATED_FINISHED 名称；DevTools 在已加载脚本中区分大小写
搜索 UNREAD 可找到常量及恢复调用。不要依赖旧文件名前缀或某个旧枚举名定位新模块。
本机四个生产包构建并安装，Reload 后原执行经只读精确恢复变为 completed，旧占用释放。
同一新鲜网络响应经当前 Get 脚本在 VM 中验证：完整回答可收取、等待身份清除、下一问保留；
这不等于在用户的 Drafts App 中运行了该笔记。没有提交新问题。
相关六组测试 207 项通过，完整套件 2,230 项通过；原有一项/两项版式失败分别保留，
不是本次新增失败。源码 lint 与文档检查通过，文档检查仍有六项既有历史链接提示。
来源：[统一快照与恢复语义](../../../../docs/api-server.md#get-chatgptconversationsid)。

## 参考文件移动，不等于协议被删除

9 月 23 日 `delta_encoding` 和 `resume_conversation_token` 从小 transport bundle
移动到共享 bundle。只搜旧文件会误判官网删除协议；只更新参考 JS 又不会修复客户端。

沿稳定标记和调用关系找职责，更新协议检测与真正消费协议的代码。
对当前参考文件验证识别，而不是只用人为字符串证明检测器“通过”。

来源：[9 月协议迁移记录](../../../../docs/chatgpt-web-2026-09-23.md)。

## 测试数据与真正 SSE 读取器之间还有一层

9 月 24 日线上报 `[delta] unknown delta encoding: "v1"`。
旧测试传裸 `v1`，实际 `data` 可以是 JSON 字符串 `"v1"`；官网先 JSON 解码。
修复共享累积器并经过 SSE 读取器回放，兼容裸文本及 JSON 声明，损坏和未知编码仍报错。

首流和续传都可能使用 `c/p/o/v` delta 短键，省略键沿用前值。
断线保留解码状态；完整 handoff 后新跟随流从 offset 0 和新解码器开始。
HTTP event offset 与 WebSocket topic offset 不可混用；控制事件不当作答案或完成事件。
“没有 token 一定只能轮询”的旧结论不准确：观测版本允许 offset 0 无 token 尝试，
非零 offset 缺 token 时不继续重试。

来源：[stream/resume 语义](../../../../docs/chatgpt-web-stream-resume.md)。

## 增加诊断不能代替修正异常请求

9 月 24 日用户反馈不思考直接回答，强调目标是修复请求而非确认是否显示思考。
第一轮修正 conversation prepare 和强度传递仍未满足目标；进一步对照发现旧校验、
吞掉 requirements 错误和缺失 Sentinel 原生 prepare/finalize 的实际缺口。
最终复用当前页面原生校验及网络实现，校验失败时停止正式发送。

两个 prepare 各有用途：conversation prepare 返回 conduit 路由材料；Sentinel prepare
获取校验要求，再 finalize。它们与 `/conversation/init`、bootstrap、auth session
不能互相替代。下一轮预取可能在 conversation 之后出现，应按材料归属和调用关系理解，
不能用抓包的时间相邻关系判断一定漏调，也不能复制某个字段后宣称解决“降智”。

`reasoningObserved: false` 只表示没有接收到证据；官网过程、wire 模型/强度和服务端
recap 时长帮助判断。经模拟测试或一个成功请求都不能证明彻底消除服务端异常判定。

来源：[9 月 24 日准备与校验修复](../../../../docs/chatgpt-web-2026-09-23.md)。

## 模块名称、类型检查和文件哈希的局限

9 月 25 日新前端改用原生模块系统与网络函数，旧版仍可能在其他页中运行。
用户要求新增兼容层，保留可能切回的旧版；不要全局替换成单一实现。
最新十轮的复数会话接口只用于状态快照，不能冒充单数接口的完整历史。

9 月 29–30 日旧网络模块 ID 已改为公告模块，类型相似也不证明用途相同。
精确哈希清单又会在兼容改名后过度拒绝，因此加入按已加载官方资源识别职责的能力路径。
能力路径要证明扩展所用分支在首次 fetch 前检查身份，`retry: never` 返回首次响应，
允许与使用分支无关的可选参数变化。识别结果先做只读 `/models` 检查，连接时再核对。

10 月 8 日新增 fetch 包装，原有 AST 识别器未覆盖。
沿调用关系确认包装只调用一次 fetch，并增加已核对版本的精确映射；
未把无法识别的包装统一放行。未知、歧义或职责改变需要定位后再处理。

MAIN 注入曾因 Babel 产生扩展辅助函数而失去自包含，源码测试不能发现这一点。
保留构建排除规则，并从生产包提取函数在无扩展辅助环境中验证。

来源：[新前端、自动识别与后续版本](../../../../docs/chatgpt-web-2026-09-25.md)。

## 默认模型是跨入口的契约

9 月 27 日用户发现 Drafts 仍硬编码旧模型，指出这是项目层面的不一致。
当前设计让 Action 3 的 `MODEL_OVERRIDE = null` 委托网关：新会话用扩展默认，
续聊用会话模型；显式覆盖仍由用户控制。默认变化不应要求再修改每份客户端副本。

10 月 8 日实际账号目录确认标准 Chat `gpt-6-thinking` 可用。
本轮用户要求非 Pro、`xhigh`；官网 Extra High 的实际 Chat 参数为 `max`。
Work 的 `xhigh` 仍独立。此处记录一次观测，不把所有模型的 xhigh 都映射成 max。
`think: true` 是读取思考记录的选项，不是请求的思考强度。

来源：[Drafts 默认与覆盖](../../../../docs/drafts/README.md)、
[GPT-6 请求观察](../../../../docs/chatgpt-web-2026-09-25.md)。

## 会话可 GET、不可 LIST：先查缓存写入

9 月 27 日用户通过 Drafts 新建后按 ID 可以读回，缓存列表却漏项，需要手动 Full Sync。
创建/续聊/详情读取后的快照应进入相应详情缓存和列表，不能靠提高同步频率掩盖写入缺口。
9 月 30 日标题又变成 New Chat 加时间戳；真实详情标题应补齐列表占位字段，
后续占位标题不覆盖已有真实标题。标题修复无需额外读取全部官网历史。

比较具体会话的 list/get 与缓存更新，明确“复现了什么、修复了哪条写入路径”，
不要只宣布“同步恢复”。列表刷新和生成状态查询是不同任务。

入口：`conversation-cache.mjs`、`conversation-hydrate*.mjs` 与网关会话路由；
代码路径见 [验证与代码入口](validation.md)。

## 不确定发送不能靠换 key 或编辑内容重试

9 月 30 日校验前拒绝也被记为 ambiguous，修改等待文本后触发
`Idempotency-Key was already used with a different request`。
明确 `dispatched: false` 的失败才可释放标识；旧记录只修复精确已知的发送前错误，
不是把所有 runtime 字样、超时或解析失败都当作未发送。

Action 3 在发送前保存标识与原参数，同一问题重试沿用原参数，防止默认设置变化改变请求。
若标识已对应成功的旧问题，恢复旧确认，将编辑文本留在 Waiting Reply，先 Get 再继续。
Get 也保留标识与参数；用户等待的具体消息即使尚未进入快照也不能被丢弃。

来源：[Drafts 操作恢复](../../../../docs/drafts/README.md)、
[9 月 30 日发送标识修复](../../../../docs/chatgpt-web-2026-09-25.md)。

## 原生可视化改变了内容、消息关系和完成判断

10 月 8 日原样新闻可视化任务约 385 秒完成，服务端工作时长约 352 秒。
仍观察到 `message_stream_complete` / `[DONE]`，但同时出现 finished 的隐藏分片、
可见 `is_merged_message` 和最后的隐藏 continuation。按最后消息覆盖会丢掉完整答案，
按任意 finished 状态结束会过早解除等待。

`metadata.model_dil_v2` 包含组件构造、常量、引用解析结果和官方 fallbackMarkdown；
原始文本混有 `grid` / `box` / `Cite` 语法。此次样本的 fallback 不包含完整事件表，
只返回回退文本不足以验证完整内容。静态解释支持组件后检查头部、表格、关系图及尾部，
同时比较实时消息和历史 GET。引用仅使用解析结果允许的 HTTP(S) 地址。

扩展、网关和 Drafts 统一返回可移植 HTML。Drafts 源码中的等待判断同步更新，
实际应用是否替换及 Markdown Preview 是否可用需单独验证。
尚未实现任意互动组件或官网完整多消息界面，不应把静态布局验证报告成全面功能等价。

来源：[真实长任务与展示验证](../../../../docs/chatgpt-web-2026-09-25.md)。

## 2026-10-09：Drafts 模板不能恢复已经回退的原生布局

一篇既有长回答在官网包含指标卡片、图例和比例条，bridge GET 却只返回完整的
Markdown 回退。完成状态和正文获取都正常，缺口是静态数组 `.map`、`list` /
`list-item` 与已解析的 `Link` 未被支持，导致整个组件树回退；背景色、横向 box、
尺寸与数值 flex 也需要一起保留。

只解释有界静态数组和回调的返回表达式，字段访问限定为静态数据的自有属性；
不执行回调、任意函数、hooks 或原型访问。引用和 Link 仍须匹配解析结果的 safe_urls。
GenUI box 在扩展 Markdown 清理之后仅保留有界尺寸、比例与纯色，不能开放任意 style。

用 bridge 的真实 GET 响应运行仓库 Action 2，再经 Markdown 转换和独立 HTML 模板
在浏览器对照桌面与窄屏。此验证不要求安装 Drafts；仍要说明使用的是浏览器预览，
不能声称验证了用户设备上的 Drafts 副本。原始响应与预览留在仓库外。
模板使用 Drafts 的 `%%[[draft]]%%`，离线内嵌样式，窄屏网格需要覆盖 HTML 的
inline 列数，宽表放入独立滚动容器。已有回退文本必须在更新扩展后重新 Get。

来源：[Drafts HTML Preview 与更新说明](../../../../docs/drafts/README.md)。

### 2026-10-09：组件名称支持不等于数据契约支持

- 官网表格既可接收子节点，也可直接接收 `columns/rows`；仅保留 table 标签会让后一种
  输出空表而不触发整体 fallback。列表 `items` 也应单独验证，空子节点按静态视图语义处理。
- 将基础组件、关键属性校验和输出适配器注册在一起。未知数据属性必须显式回退，
  不能静默忽略内容；有可靠的组件 fallback 时保留局部视图，否则使用完整 Markdown。
- 渲染事实与源消息类型分开记录。诊断只保留有限的组件/属性名称和原因，不包含数据值。
- 新解释器曾把原生 wrapper 中未使用的模型数据绑定 hook 当作必需表达式，导致真实答案
  回退。允许忽略该已识别的未使用声明；实际依赖动态绑定的视图仍需回退，不执行 hook。
- 扩展和独立预览共用样式源及动态样式校验。网格变成单列时必须同步取消 item 跨度；
  实际约 390px 预览证明页面宽度不扩张、宽表仅内部滚动，静态数值和来源保留。


### 2026-10-09：跨设备离线预览把可信运行库放进 Action

- Drafts 的 Action 随 CloudKit 同步，Library/Templates 文件通过 iCloud Drive 另行同步。
  iPhone 没有 Mac/iPad 的独立实时预览窗口；三端共同入口应是完整 HTML Preview Action。
  内嵌图表运行库与 CSS 后，已同步的内容无需 CDN、自托管服务或额外资源下载。
- HTML、Action 包从同一源模板、共享 CSS 和受信任的图表运行库生成。只解释静态图表
  数据，不执行模型生成的函数或处理器；扩展与预览再次校验描述符，并保留数据表兜底。
- Drafts 的模板替换会扫描 script 内的 [[tags]] 和 %%Markdown%%。打包时按 JavaScript
  token 保护字符串与相邻括号，保持运行语义；用完整内嵌脚本计算 CSP 哈希。插入脚本
  应使用 replace 回调，避免库源码中的美元替换序列改写最终内容。
- 数值轴缩放需要实际坐标范围，不能把观察的行号作为日期、大数值或负数的坐标。
  空值保持断点，负数保持符号；未知原生属性明确回退，避免宣称完整官网功能等价。
- 浏览器中已检查常见图表、图例切换、提示、暗色和窄屏离线显示；扩展实际 Markdown
  组件也需独立检查。浏览器模拟不证明 Drafts 原生导入或两台设备的同步，交付必须
  单独说明尚未在安装了 Drafts 的 iOS/macOS 设备上验证。

来源：[Drafts Preview 安装与范围](../../../../docs/drafts/README.md)、
[组件契约](../../../../docs/chatgpt-web-genui.md)。

## 2026-11-06：资源入口消失不等于网页运行时不兼容

实际代理页正常登录并显示，但 script、modulepreload 与 resource timing 中都没有
官网运行时 JS，原发现器因此返回 `CHATGPT_WEB_RUNTIME_UNSUPPORTED`。同一 MAIN
文档的 `__reactRouterManifest.entry` 和 `routes.root` 仍声明启动 module/imports。
尚未确认具体是哪段页面代码清除了其他入口，不能把清理机制当成已知事实。

只读取 entry/root 的有界公开资产列表，并在发现与连接两处同时支持它；继续校验
HTTPS、官网域名、JS 路径、唯一职责、身份、取消与单次请求。不要扫描私有 bootstrap，
也不要因为某个 URL 在清单中就跳过能力校验或导入任意未加载路由。
两处来源顺序保持一致；同路径的 query/hash 不同仍是不同模块身份，遇到冲突就停止。
文件名前缀只能用于优先排序，未知完整文件名应先只读核对公开 webpack 导出再导入。

先在同一未刷新文档上对照更新前拒绝、更新后原生连接成功，再刷新代理页和桥接页
复核。生产包中的两段序列化函数也需自包含。实际网络 Get 可证明读取链路，但不能
冒充未安装在本机的 Drafts App 交互。手机动作转圈在用户重启 Drafts 后恢复，用户
结束了该分支，不能把它的原因也归到本次运行时发现缺口。

来源：[11 月 6 日调查与部署证据](../../../../docs/evidence/2026-11-06-gateway-process-exits.md#follow-up-runtime-discovery-and-deployment)。

## 2026-11-14：原生发送正常，Box 的消息 ID 格式仍可能无效

官网原生通知改写返回 HTTP 200，同一登录环境的 Box `Rewrite draft` 返回 HTTP 422
及 `Invalid conversation body`。旧交付记作 HTTP 400，本次保留实际状态码，不把两次
观察合并成同一请求。错误来自官网正文校验；仅凭这一字符串不能确定官网协议改变。

统一适配器直接将 `run-...` 公共运行编号放进 `messages[0].id`，破坏了原生 UUID 格式。
在适配器边界稳定映射为 UUID，已有 UUID 保持原值；turn 索引和恢复使用原生 ID，
公共 run/ledger 仍用原编号。受控回归复现后修正，真实修复请求返回 HTTP 200，
日志 owner 中同时保留原 opaque run 与已接受的 UUIDv5。未知旧运行没有重发或改写。
这也说明正常 MCP/网关请求不能替代每种入口的验证：它们给运行编号的形状可能不同。

首个成功回答又暴露消费端问题：静态 GenUI 包装被当作改写文字。只解开本机已知
渲染包装，使用惰性模板取得正文，保留段落、BR 和实体；普通 HTML 及围栏中的 HTML
仍是字面文本。最终真实预览与回填通过，官网 Cmd+Z 恢复原文；扩展 Undo 按钮因
输入变化保护拒绝，未放宽该保护，也没有宣称它通过当前富文本编辑器验收。

重载后曾有一次发送前兼容拒绝，记录为 not_attempted。去掉临时 fetch 包装并做
只读原生握手后恢复，最终用 PerformanceObserver 记录 HTTP 状态而不替换 fetch。
本轮没有证明拒绝由包装器引起。未来先区分本地准备、实际写入和结果采用；若诊断
需要临时拦截请求，检查观察器是否影响原生识别，并在结束时清理。

来源：[原生改写修复与安装验收](../../../../docs/plans/2026-10-30-chatgpt-native-input.md#november-14-request-body-repair-and-installed-rewrite-verification)。

## 2026-11-24：合并回答的显示节点与续聊节点不同

新鲜 GET 中的最终可视化回答，其 `currentNode` / `messageId` 可以与
`continuationMessageId` 不同。流客户端已保存后者，统一适配器只与前者比较，
因此同一 head 也会误报 `BINDING_CHANGED`。历史导入和旧续聊入口还会选错发送父节点。

统一从当前显示节点上完整的最终回答取得 continuation。只在这次新鲜核验中
证明的两个身份之间兼容旧绑定；不能用旧轮次的锚定结果或未完成回答解除冲突。
用合成样本同时验证误报消失、发送使用原生父节点、真实变化仍被拒绝。
原故障会话只读核验即可，不为验证父节点关系向用户会话追加临时问题。

本次新目录加入 GPT-6.2 Chat / Work，保留现有默认。新模型不仅要检查 slug，
还要分别读取 Chat 与 Work 的思考档位；同一 Work slug 在嵌入的 Chat 目录中
可以只有四档，而 `/tpp/models/` 仍有含 `xhigh` 的五档。

来源：[11 月 24 日修复与验证](../../../../docs/evidence/2026-11-24-chatgpt-continuation-models.md)。
