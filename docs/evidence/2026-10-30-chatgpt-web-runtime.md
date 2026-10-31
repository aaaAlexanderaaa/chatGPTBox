---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-30
---

# 2026-10-30 ChatGPT Web runtime compatibility

刷新专用 ChatGPT 代理页后，现有安装版已能识别新版官网脚本，并完成真实发送和历史读取。
本次没有修改生产传输代码、放宽身份检查或新增精确版本映射；新增的是合成回归和本记录。
这证明当前版本能够工作，不证明原文档的运行时可发现性已经修复。

用户本次要求先暂存已有变更，再适配官网新脚本。原有 51 个文件的变更已放入 Git 暂存区，
本次测试和证据变更保持未暂存。收尾核对确认原暂存内容的摘要一致。

## 公开版本事实

当前文档的 `modulepreload` 声明包含公开运行时
[`633146.02c5d2c641.js`](https://chatgpt.com/cdn/assets/633146.02c5d2c641.js)。
独立下载的公开文件大小为 230603 字节，SHA-256 为
`4ffe38e46ec414f53e77f15fc134b52c13949b0cbfb6598ba011ac7357025a3b`。
通过该文档的原生模块实例只读取公共工厂/函数代码，观察到：

| 职责 | 当前模块/导出 |
| --- | --- |
| Request 与浏览器/原生 profile | `Kwur.Request`、`Kwur.getChatGptRequestProfile` |
| 账号快照、认证代次、工作区切换状态 | `QdUF` |
| 原生完整性 prepare / headers | `lXEa.f` / `lXEa.b` |
| 原生网络函数 | `wl0r.d` |
| 单次 fetch 与私有 WeakMap 记账 | `y3uJ.a` |
| Request 到网络模块的实际依赖路径 | `Kwur -> HFSu -> GDNt -> KthI -> wl0r` |

这些名称是此次公开版本的观察值，不是新的固定契约。现有
[能力识别器](../../src/services/clients/chatgpt-web/runtime-capabilities.mjs)
无需修改就唯一匹配了该组合。profile 仍将传入账号、同一 headers 对象的语言和 `oai-did`
与浏览器/原生分支绑定。网络函数在首次 fetch 前的 `for-of` 初始化表达式中检查
`expectedIdentity` 和同步 `assertCurrent`，传入取消信号；`retry: never` 阻止后续认证重试。
403 响应检查读取原响应的副本；包装器仍只执行一次 fetch，并返回或抛出原结果。
MAIN 的连接与逐请求源码/身份核对没有变化。

## 原始失败与恢复边界

初始、长期开着的代理文档报 `CHATGPT_WEB_RUNTIME_UNSUPPORTED`，没有提交新问题。
当时可读取的 script、modulepreload 和 Resource Timing 集合没有提供可识别的运行时。
本次没有确定这些资源引用何时、为何变得不可见。

同一登录环境的只读 HTML GET 提供了公开脚本 URL 线索；它不能证明旧文档已经加载了
该运行时。正常刷新专用代理页后，新文档重新提供了运行时声明，既有发现/连接路径成功。
没有把新 HTML 的模块猜测注入旧文档，也没有跨文档拼接身份或模块。
无法可靠发现当前文档运行时的页面仍须拒绝提交，按现有错误提示刷新后再操作。

## 实际验证

真实链路为本地 HTTP/MCP 客户端，经现有 API Server 桥接页、扩展后台和专用代理页，
到官网 HTTP API。验证使用用户正在使用的 Brave 安装版；浏览器管理页确认其加载的是
项目旁的 `browser-extensions/chatgptbox` 安装目录。

- 原 18081 网关和桥接为 healthy / connected。通过该网关读取项目列表返回 HTTP 200。
  只记录项目数量，没有将项目内容写入本记录。
- 只发送了一次有实质内容的工程复核请求，没有覆盖用户的模型/强度。
  请求 Payload 显示 `gpt-6-thinking`、`thinking_effort: max`；MCP 返回 `completed` 和完整回答，
  服务端报告思考时长为 240 秒。网络面板对应的最新 conversation 请求为 POST / HTTP 200，
  显示约 4.3 分钟；这个网络耗时与服务端思考时长是不同观测。
- 对该会话强制只读 GET 返回 HTTP 200，只有一条 user 和一条 assistant 消息；
  `pending: false`，assistant 为 `finished_successfully`、`endTurn: true`，回答尾部与 MCP 一致。
  没有为核对尾部再发问题。此处证明文本发送、完整消费和历史读取，不证明原生可视化、
  所有模型、真实取消或断线恢复已在新版官网逐项实测。
- 同期网络面板也有其他会话请求，未把面板总数当作本次逻辑操作的提交数。
  本次调用量为一次正式 MCP 调用；未做全账户重复写入审计。
- 新增 7 项合成回归：新版四字符模块及四跳调用关系、`for-of` 初始化检查、403 前置分支中
  身份/断言/禁止重试/额外 fetch 的反例、不同 runtime 的角色不得拼接、无候选时不得读取
  新 HTML 或猜测 import。样本不含账号、真实完整性实现或原始会话。
  相关 7 个测试文件共 267 项通过，全量 122 个文件的 1512 项测试通过；`npm run lint`、
  `npm run docs:check`、`git diff --check` 通过。文档检查仍有 4 条既存历史链接提示、0 错误。
  运行环境遵循当前 package/Contributing 的 Node.js 22；技能参考中的旧 Node 20 指引
  未作为项目运行时依据。全量网关测试在允许本机临时 HTTP/WebSocket 端口的环境运行。

独立 ChatGPT 复核只收到项目必要事实和公共代码形态；它建议保留现有发现策略，并区分
刷新恢复、结构识别和动态发送证据。它不拥有本地仓库或原始抓包，不能视为对这些事实的
独立复现。复核之后的只读 GET 补充了本轮最终消息与尾部证据。

诊断期间，网络面板把认证请求头合并为一行，输出过滤条件曾误输出该行；已向用户说明。
此后只提取有长度限制的模型/状态字段；请求头未写入仓库或交给复核者。

## 各交付层状态

用户随后确认期望重新 build 并加载；按该要求补做构建、安装和重载。上述正式长请求
发生在本次重构建之前；以下重构建后验证只执行只读请求，没有再次提交问题。

- 源码：生产客户端未变；本次新增回归和公开证据。
- 构建：Node.js 22 下 `npm run build:extension` 成功，生成 Chromium/Firefox 的正常包
  和不含 KaTeX/tiktoken 包，共四种生产包。构建使用当前工作区，包括用户先前暂存的源码；
  暂存区内容的摘要仍一致。构建只有 Browserslist 数据过期提示，没有编译错误。
- 生产注入：从四种包的 background 提取两段 MAIN 函数，在没有扩展辅助函数的 VM 中
  执行来源拒绝分支成功。这是序列化与该分支的检查，不是完整登录/校验路径测试。
- 安装/重载：实际安装目录的 29 个构建文件与 `build/chromium` 逐一 SHA-256 一致。
  Brave 管理页确认目录并显示 `Reloaded`；重载后扩展大小显示 6.5 MB。刷新专用代理页，
  重新打开新版本 API Server 桥接页；它显示 Connected / healthy。浏览器自行生成的规则
  `_metadata` 不属于构建源文件。
- 网关/桥接：沿用现有进程、18081 端口和认证配置，未修改或重启服务。重载后健康检查
  HTTP 200、桥接 connected/websocket、pending 为 0；通过新加载客户端读取项目列表
  HTTP 200，用时约 2.48 秒。
- Drafts：发送/读取/输出契约未变，Action 2/3 无需更新；未修改用户的已安装副本。

维护入口仍为[适配技能](../../.agents/skills/chatgpt-web-adapt/SKILL.md)、
[API 恢复契约](../api-server.md#at-most-once-writes-and-bounded-recovery)与当前实现。
