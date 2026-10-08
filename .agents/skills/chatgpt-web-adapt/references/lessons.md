# 已验证的经验与试错

本记录归纳 2026-09-23 至 2026-10-08 的项目会话、代码和维护文档。
通过 `npx @cchistory/lite` 按本仓库目录查看近期会话，进一步读了五个相关会话中的
37 条用户交互。原文和工具输出只用于本机分析，不随 skill 保存。
历史中的操作许可不授权未来任务；以下版本事实需要在下一次适配时重新核实。

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
