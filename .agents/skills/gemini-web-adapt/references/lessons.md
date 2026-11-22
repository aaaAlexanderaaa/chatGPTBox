# 已验证经验

这些是有条件的历史经验，当前行为以 [Gemini 契约](../../../../docs/gemini-web.md)和代码为准。
每次新编译、模型、身份或原生事件改变都需重新核对。

## 2026-11-21 晚间：Closure 原型别名漂移、`=>\n` 断行与 `structuredContent` `nodeType` 枚举整体 +1 移位

1. 同日晚间 Google 推出新构建（公开 `en_US.t2_00FiRTFM.2018.O` 及对应登录态更新）后，Tier 2 `structural-core` 在一次真实的未发出发送（`dispatched: false`）前拒绝了该编译，同时暴露出 4 处耦合假设：
   - Closure 原型别名变量从 `_.aa` 漂移为 `_.ba`（`_.ba=_.SK.prototype; _.ba.WEa=_.ca(781)`），使 `structural-contract.mjs` 与 `code-equivalence.mjs` 中硬编码 `_.aa` 的方法索引漏掉延迟注册的 `history.read` / `attestation`；改为按单元动态跟踪 `_.<alias>=_.<Class>.prototype` 并从运行时 AST 自动识别延迟 stub/registrar 对。
   - `unwrapClosureLines()` 漏掉了 `>` / `<` / `.`，遇到 Closure 在 `()=>\nthis.Ofa()?"Stop response"` 处断行时导致 `generating`/`preparing` 锚点失配。
   - `structuredContent` 转换器新增 `case 97 -> {nodeType: 16}`，导致原有 `nodeType >= 16` 全部 +1（容器 `16→17`、表格 `17→18`、文本 `18→19`、换行 `19→20`、无序列表 `20→21`、空占位 `21→22`）；若仅放宽正则而保留旧 `renderAnswer()` 硬编码 `switch`，会把文本误渲染成 `<br>` 或把新 `nodeType: 16` 误当作容器。现改为从 protobuf 稳定字段号 `switch`（`case 2..91` + `default`）静态唯一抽取并交叉校验全部 20 个 `nodeTypes`（无碰撞、无动态代码），由 `renderAnswer()` 按 `contract.nodeTypes` 渲染并继续拒绝未知 `nodeType: 16`。
   - `runtime-inspection.mjs` / `automatic-contract.mjs` / `native-runtime.mjs` 优先精确匹配唯一 `m=vLefie`（仅在缺失时回退唯一 `/exm=_b/`），并在 `structural-core` 模式下始终比对核心对 URL，避免新 writer tab 在自动发现期间懒加载同版本 chunk 导致误报文档变化。
2. 同次故障同时复现了客户端版本差：若 Drafts 端仍运行旧版 `Get` 脚本（`307ce87` 之前，第 1157 行第 24 列），在包含 `## Unsent request` 且无原生会话 ID 的笔记上再次运行 `Get` 仍会报 `No native conversation identity is available...`；需在安装了 Drafts 的设备上同步更新共享脚本或动作包。
来源：[Gemini 契约](../../../../docs/gemini-web.md#automatic-compatibility-for-identifier-changes)。

## 2026-11-21：登录态多模块两层自动适配、一键离线脚本与旧 `readTab` 自动刷新

1. 11/18–11/21 连续 5 个真实编译表明，Google 几乎每天都在 6 MiB `app.js` 中增改少量非核心代码（甚至在 `prepare`/`history.list` 增减单个字段标志），且登录态页面会懒加载 40+ 个同版本 `m=...` 模块，导致仅支持 ≤4 单元且要求整包逐 token 等价的 Format-4 自动路径在登录态下无法命中。
2. 经用户授权升级为两层自动验证（均不执行网页代码、均仅内存级 document 绑定）：保留 Tier 1 全量 Format-4 证明；新增 Tier 2 `structural-core` 路径——`runtime-inspection.mjs` 对 >4 单元同版本页面抽取唯一核心对（`m=_b` 与 `m=vLefie`/`/exm=_b/`），`structural-contract.mjs` 用 31 项语义/协议锚点唯一解析并校验 8 项核心入口 AST 不变量（禁止动态代码、禁止 `submit` 直连网络、验证 `submit → service.sendRequest` 可达、`prepare` 保留 `bardModeService`/`thinkingLevel`、`attestation` 保留 `botguardResponse`/`botguardSalt`、`thinking` 保留 `routingVariantId`）后直接算出 8 项 SHA-256 指纹。离线用 11/18 `rF38EnUYaoQ`、11/19 `NcE3BnbhJwQ`、11/21 `c3ZkJFn_XPs` 三份真实 6 MiB 包验证：均在 ~0.7–0.8s 内 100% 精确还原全部 31 个符号与 8 个指纹，且 4 项对抗篡改均被拒绝。
3. 配套落地 `Settings → Gemini Web` 公开构建号与 2 URL/命令一键复制、`readImpl` 遇旧 `readTab` 报 `GEMINI_RUNTIME_UNSUPPORTED` 时仅退换一次只读 tab（不碰 writer）、`npm run gemini:adapt` 一键离线适配以及 `npm run build:extension:fast` 单目标 Chromium 快速构建安装。
来源：[Gemini 契约](../../../../docs/gemini-web.md#automatic-compatibility-for-identifier-changes)。

## 2026-11-18：`/_/mss/` 资源路径、`_.da` 延迟注册、`froaSlPXDN0` 升级与 `history.*` / Drafts 状态边界

1. `gemini.google.com/app` 从 `https://gemini.gstatic.com/_/js/...` 迁移到 `https://gemini.gstatic.com/_/mss/boq-gemini-web-uiserver/_/js/k=.../m=...?wli=BardChatUi...` 后，原先仅放行 `/_/js/` 前缀与空 query 的发现及 `automaticProof` 校验都会误拒合法单元；应只放行该已知路径前缀及 `?wli=BardChatUi...` 单参数，继续拒绝任意 query 与 `..` 路径。
2. 新公开构建 `en_US.sVUVnpt2JHE.2018.O`、`en_US.froaSlPXDN0.2018.O` 与登录态英文构建 `en.rF38EnUYaoQ.2018.O`、`en.NcE3BnbhJwQ.2018.O`、`en.c3ZkJFn_XPs.2018.O` 除符号重命名与逻辑指令变化外，均使用 `_.ca(id)` / `_.da(id, fn)` 延迟注册（`c3ZkJFn_XPs` 起 `history.list` 回到 `ConversationApi` 类体直定义，仅 `read`/`attestation` 仍经 `_.da` 注册）：`sVUVnpt2JHE` 的 Closure identity memoizer 为 `_.jTa`/`hTa`/`_.Fe`/`_.gka`/`iTa`、未加载延迟导出为 `iZc`/`mzg`/`VAa`；`froaSlPXDN0` 与 `rF38EnUYaoQ` 共用 `_.iTa`/`gTa`/`_.Ge`/`_.hka`/`hTa`，未加载延迟导出分别为 `WZc`/`mAg`/`UAa` 与 `XZc`/`nAg`/`UAa`；`NcE3BnbhJwQ` 的 memoizer 为 `_.iTa`/`gTa`/`_.Fe`/`_.hka`/`hTa`，未加载延迟导出为 `b_c`/`FAg`/`UAa`；`c3ZkJFn_XPs` 的 memoizer 为 `_.hTa`/`fTa`/`_.He`/`_.cka`/`gTa`（全局对象别名也随版本变为 `_.ka`，`staticAllows` 须核对 `_.ka.JSON.*`），未加载延迟导出为 `O4c`/`kFg`/`LAa`。**注意**：匿名访问 `gemini.google.com/app` 默认返回 `en_US.*`，而登录态英文 Brave 会话返回的是 `en.*`（且活跃页面会按需加载数十个 `m=...` 延迟单元，超出自动发现 4 单元上限）；排查登录态兼容时必须直接核对浏览器实际加载的公开 `gemini.gstatic.com` 单元（核心入口 `m=_b` 与 `m=vLefie`），不能只以匿名 `en_US` 代替。
3. 后台 `invoke()` 的自动发现列表写成了 `'list'`/`'read'`，漏掉了 `readImpl()` 实际使用的 `'history.list'` 与 `'history.read'`，导致只读历史接口直接返回 `GEMINI_RUNTIME_UNSUPPORTED`（`422 OPERATION_NOT_IMPLEMENTED`）而不触发发现；同时 `'review'` 也应纳入重启后的只读发现白名单。新建后台 tab（`active: false`）在 `status === 'complete'` 后仍可能短暂处于 Angular / `SignOutOptions` hydration 阶段，需对新 tab 的首次只读探测留出有限等待预算，避免误触发持久账号暂停（`pauseAccount`）。
4. Drafts 新建 `:g` 笔记若首次 `Send` 以 `dispatched: false`（未提交）失败，笔记已写入 `meta.kind = 'conversation'` 与 `lastUnsent`，但无 `conversationRef` 也无 `nativeConversationId`；随后执行 `Get` / `older`（含升级前已留有 `## Unsent request` 且无 `## USER` / `lastUnsent` 的旧笔记）应提示上一笔请求未发出、尚无原生会话，而不是泛报错 `'No native conversation identity is available...'`；当 `meta.conversationRef` 因绑定过期返回 `CONTEXT_UNAVAILABLE` 且存在 `nativeConversationId` 时，只读刷新可通过 `conversationId` 重新解析引用；当 `Get` 遇到已 settled 但非 `completed` / `not_attempted` 的 run 时应抛出实际错误并保留 `pending`。
5. 同日用户将 Gemini Web 默认模型切换为 `4 Neon / High`（`gemini-4-neon-high`、`THINKING_LEVEL_EXTENDED`、`thinkingEffort: "high"`）。更新 `scripts/api-server.mjs` 后若使用 macOS LaunchAgents，需按原参数重启本地服务；在活跃 Brave 登录态下实测 `4 Neon` 实际原生 `mode.description`、`SignOutOptions`、历史读取与发送前，不把离线检查当作实盘通过。
来源：[Gemini 契约](../../../../docs/gemini-web.md#automatic-compatibility-for-identifier-changes)。

## 2026-11-16：保留页数不等于并发容量

原来的三张 writer 保留上限与公共 descriptor 的单路租约、原生全局 hold 并存，
因此一笔未知就能拒绝其他独立问题。容量要在公共准入、原生 per-request hold 和
writer 分配三个 owner 同时成立；按稳定身份合并记录，缺租约不能抹掉未知占用。
同一原生会话仍排他，完成页需核对文档、完整响应身份、草稿及前台状态后才可回收。

账号 notice 与 Send 的竞态需在最后一次异步 tab 查询后重验。短提交门只覆盖到
浏览器派发，不能等待该文档回复，否则一个卡住的页面又会阻塞其他名额。
受控回归覆盖未知 A 与活跃 B/C、恢复 A 后准入 D、notice/Stop 竞态、旧日志及回滚拒绝；
本机 Reload 后 descriptor 为 3、v2 日志无占用。未提交三笔真实 Gemini 测试问题，
以后更改调度或原生日志时须重验，不能从保留页数或此历史结果推定实时可用性。
来源：[并发交付记录](../../../../docs/plans/2026-11-16-gemini-concurrency.md)。

## 2026-11-14：自动兼容需要完整编译与独立命名域

TX/K 两个构建的八个入口去掉名称后 AST 一致，但完整 app 结构不同；入口形状不能证明
helper 和门控没变。自动路径比较参考 runtime/app 的全部 token、原始字面量和隐式分号决定。
namespace、实例字段和词法 helper 分别建立一致的一对一映射，避免把类 `AM` 与时段字符串
`"AM"` 或其他对象的同名字段混为一谈。namespace 的反射、计算索引、遮蔽以及原型控制键均拒绝。
参考未允许的名称、资源组合、多解和文档变化仍需人工核对，不能在线自学习信任。

还要检查隐式 receiver：`_.method()` 会把 namespace 当作 `this`，仅禁止显式 `_` 逃逸
仍会漏掉 `this.AM`。参考生成审计可调用目标，拒绝 receiver 读取、逃逸和无法解析的调用；
转发只接受已确认不读取 receiver 的回调，Closure identity memoizer 用精确源码证书限定。
当前 TX 的三个延迟入口没有被当作已检查代码；自动路径要求对应 export 不存在且 wiz 未启用。
加载额外模块或这些入口出现时，即使已提交也拒绝继续自动工作，并保留未知结果、不重发。

公开 TX 两个完整单元的离线试验一致改名 20,905 个符号后通过，六项关键 namespace 名称、
提交方法与八项新原生指纹均可对应；只改 runtime 的一个常量、八项入口指纹保持不变时则拒绝。
来源：[自动适配记录](../../../../docs/plans/2026-11-14-gemini-auto-adapt.md)。

## 2026-11-12：本地版本拒绝不是账号异常

初次安装只映射 `VxAhX7iBM_A.2018.O`，刷新后网站加载了 `qGl2D_iBXPk.2018.O`；
Angular view、类与字段职责发生变化。适配器在发送前报未验证版本，实际提交数为零。
早期操作者因此结束试验，误把自身兼容拒绝当成用户要求停止的网站异常。

只读检查公开脚本、真实实例和所需函数指纹后增加独立 profile，保留所有身份/提交保护。
新空白 writer 的思考档位重置为 Low；通过已检查的原生 menu setter 选择可用 High 并复核，
没有改手工页或请求体。随后一个 4 Argon / High 的真实 adapter 回合完成。
这不能证明所有新版本可自动接受，也不能以本地错误证明账号处罚。
来源：[最初交付与后续纠正](../../../../docs/plans/2026-11-12-gemini-web.md#correction-after-the-users-runtime-check-clarification)。

## 2026-11-13—14：原生提交入口与单次效果

直接会话 service 调用会跳过输入上游门控，DOM 合成点击也不能证明完整原生链路。
采用真实输入组件已有提交 handler，让网站保留准备、attestation、请求与原生恢复。
在准备前持久登记，在准备期间也监听意外 Send；稳定原生状态并不授权第二次调用。
生产打包会给注入函数引入外部 helper，因此需检查最终序列化函数，而不只检查源码。
来源：[原生设计与完成修正](../../../../docs/plans/2026-11-12-gemini-web.md#native-runtime-design-review)。

## 2026-11-14：父回答不能证明续聊成功

两次 Argon / High 续聊观察到 success/idle，却没有本次可归属的新响应；均保持 unknown，未重发。
使用旧父 head 或按问题文本查 DOM 会误认旧答案。当前实现用提交后持久化的 produced-output proof
关联 common run、native request 与新 server turn/response；history 中缺旧 client ID 时不猜测。
success/idle 后仍缺响应的观察有明确短边界，保留 hold；MCP 等待器不能抢占活跃 writer 的恢复。

用户后来选择 Hydrogen / Medium，真实续聊经 API/MCP 与新读 native history 得到相同正文和轮次，
Drafts Get 在丢失收据后找到原 operation。此成功未解释早前 Argon 异常，也不把旧 run 改为成功。
来源：[交付与真实观察](../../../../docs/plans/2026-11-13-gap-closure.md#real-gemini-and-drafts-evidence)。

## 2026-11-14：时间来源和客户端验收分别记录

同一 Hydrogen 回答的 live/native-history 时间戳相差约 3.6 秒，正文与轮次一致。
保留来源的时间点；请求到成功事件的间隔和本地 run 耗时均不是官方思考耗时。

四个 Gemini Drafts 脚本已在 VM 中通过真实认证网关验证，包含收据丢失与保留外部笔记。
此证据不覆盖 Drafts 原生导入、设备或 iCloud；维护时也不能由安装扩展推定已更新动作副本。
来源：[时间与脚本证据](../../../../docs/plans/2026-11-13-gap-closure.md#real-gemini-and-drafts-evidence)。
