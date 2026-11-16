---
name: gemini-web-adapt
description: 维护本项目的 Gemini Web 原生网页适配，在官网运行时、模型或思考档位、提交、历史、续聊、恢复或输出变化影响扩展、API/MCP、Drafts 时使用。不用于 Google Gemini API 接入或其他网页供应商。
---

# Gemini Web 适配

让扩展、API/MCP 和 Drafts 沿 Gemini 网页自己的输入与请求链路工作，并用本次产出的原生身份确认结果。
这是仓库维护 skill，保存在 `.agents/skills/`；不新增扩展内 agent 或运行时技能。

先读 [Gemini 契约](../../../docs/gemini-web.md)、当前代码和本次故障；
产品范围、账号边界与恢复规则仍由该契约拥有。定位入口、生产包与安装验证见
[验证与代码入口](references/validation.md)。遇到相似失败再查
[已验证经验](references/lessons.md)，不把历史编译名当成新版本常量。

## 先区分本地兼容拒绝与网站异常

- 核对浏览器实际加载目录、运行中的编译版本、原生模型和思考档位，以及原始错误来源。
  `This Gemini website version has not been verified` 是适配器发送前拒绝；
  它不等于账号处罚或 Gemini 已拒绝问题。调查本地映射并验证后，可继续尚未使用的授权发送。
- 网站挑战、配额、身份不符与结果不确定分别处理。兼容调查不能绕过网站检查，
  不能换账号、模型或入口重发可能已提交的问题。先声明账号调用量和停止条件。
- 请求链路是页面功能/对话 → provider → 共用 engine runtime → Gemini background owner
  → 专用 Gemini 页的 MAIN 原生输入处理器 → 网站自己的 HTTP/流。
  API 从本地网关经 `ApiServer.html` 到同一 owner；MCP 和 Drafts 是网关客户端。

## 原生适配的方法

1. 沿当前公开脚本核对真实输入组件、非 mock 会话服务、提交处理器、准备与 attestation、
   模型/思考状态、原生 action 和响应行。版本字符串、类名或方法存在只能定位，
   需与当前方法指纹及实际字段职责一起核实。
2. 在 `src/config/gemini-web.mjs` 的已检查 profile 中维护语义映射。未知编译仅在契约规定的
   完整代码重命名等价检查通过后自动派生映射；逻辑改变、映射不唯一或无法确认仍拒绝。
   不用八个入口的去名称 hash 替代完整依赖代码校验。参考生成器先核对全部原始指纹，
   再为明确检查过的公开编译生成 `src/config/gemini-code-references.json`；不在线自学习信任。
   不用泛化 DOM 点击、相似函数或直接 root-service 调用替代完整输入链路。
3. 使用同一顶层 MAIN 文档中已存在的输入实例和原生提交处理器。保留网站输入门控、
   请求组装、内容校验和 transport；不重建 Google HTTP 请求，不搬运 cookie、token 或 attestation。
   一次扩展 handler 调用不保证网站只发一个 HTTP 请求，原生恢复仍由网站拥有。
4. 每次发送重验绑定账号、document、原生模型和思考档位。当前选项从契约和配置读取；
   本地模型选择符不是 Google API 模型 ID。只在符合契约的专用空白 writer 设置可用档位，
   不改用户手工页、不自动降档。异步准备后还需核对实际请求中的选择。

## 提交、结果与恢复的不变量

- Background 是持久提交记录和 hold 的唯一 owner。持久化确认在原生准备前；
  worker 重启、页面丢失、断流或超时不能使旧问题重新获得发送许可。
- 在准备开始时就监听原生 Send；发现意外的用户/网站提交，阻止额外 handler 调用。
  按当前契约保留三个独立执行名额、同一原生会话排他和独立只读通道；每笔未决请求
  只占自己的名额。旧记录仅凭稳定身份合并计数，不把 busy 变成隐式队列。
- 用本次 native request、server turn/response 和成功 terminal action 关联结果，
  从同一原生行读取正文与终态。同文 DOM、旧父回答、用户气泡、idle 或传输结束不能证明成功。
  `started` 与 `finalContent` 各自需要契约规定的证据。
- 精确恢复依赖提交后持久化的 produced-output proof。父 head 只是续聊输入，
  不能冒充新产出；缺 proof 的旧记录或持久化前崩溃保持 unknown。
  成功 action 后无可归属响应的等待边界由契约/代码拥有，不用无限等待或重发代替它。
- 列表/详情使用单独只读 tab 的原生 history service，不刷新或导航 writer。
  重开续聊需重验账号、会话和已完成 server head；不把整个旧 transcript 当作新问题恢复。
  活跃 run 的观察不能抢占其 writer、释放 lease 或提前退休 binding。
- 完整结果在异步 journal 清理前同步发布，Stop 与完成只有一个终态 owner。
  Stop 仅尝试对应原生取消；未知远端结果仍保留 hold。人工允许新工作不改变旧 run 的未知结果。
- 只将支持的原生内容转为静态安全 HTML；未知交互块明确拒绝或按现有契约处理。
  原生响应时间戳和本地 run 耗时分别报告，未经证实不称为官方思考耗时。

## 验证与交付

用实际故障对应的受控回归检查 native 调用次数、账号/document/model、终态与恢复身份、
Stop/重启/收据丢失。历史和 Drafts 改动同时检查分页、Waiting Reply、外部备注和旧 run。
生产 MAIN 函数必须在打包后仍闭包自包含，不能只测试源码函数。

真实试验从就绪检查开始，使用不含私人信息的自然任务，在现有授权和声明预算内发送。
结果不明只观察原请求；本地未发送证明与网站异常分开。没有本轮授权则不为写 skill 制造账号流量。
报告源码、构建、安装/Reload、网关/桥接和 Drafts 副本各层的实际状态。
脚本在 VM 中访问真实网关不等于原生 Drafts、设备或 iCloud 已验收。

遵循 `CONTRIBUTING.md` 的相关检查；本地编译映射修复不自动授权 release。
原始会话、账号标签、捕获、凭据及日志留在 Git 外，只将机制、公开编译事实与合成回归写入仓库。
