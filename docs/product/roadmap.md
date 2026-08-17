# 执行计划（Roadmap）

> 状态：**生效中**（A–D 全量实施中，见 D-21；完成一项划掉一项，顺序变更先改本文）
> 日期：2026-08-15（D-21 修订同日）
> 来源：产品定义 → 契约 → UI 设计 → 顺序修正讨论
> 上游：[definition.md](./definition.md) · [contracts.md](./contracts.md) ·
> [ui-console.md](./ui-console.md) · [decisions.md](./decisions.md)（D-1~D-21）

总原则（D-10/D-20）：渐进、每步独立可发布、不大爆炸。**缝与第一个客户
（dsh）同步成型**，不凭空先造抽象；存量清理是收割，放在证明点之后。

执行顺序（D-21）：A → C → B → D 为建议实现顺序（技术依赖：B 复用 A 的
组件与网关；D 的设置侧过滤落在 C1 搬迁之后，避免返工），**不再作为阶段
门**。人工验收合并为一次终验（见文末"终验清单"），在全部实现并完成两轮
review 后由产品负责人执行。

## 现状资产（开工前已知的一切）

- **分支 `feat/deepseek-harness-bridge`**（worktree `chatGPTBox-dsh-bridge`，
  commit `ea986ea`，领先 master 一个提交，测试全绿）：
  - 收编：`src/services/clients/dsh/client.mjs`（传输：RPC 信封 + respond +
    mux WS，零扩展依赖可测）、`src/services/clients/dsh/turn-fold.mjs`
    （幂等事件折叠，内部结构化 blocks 正是台账数据源）、
    `src/background/dsh-bridge-service.mjs`（fence：DNR/webRequest 头改写，
    作用域已收窄）、config 切片、en/zh locale、两个测试文件。
  - 丢弃：`src/services/apis/dsh-bridge.mjs` 的每-prompt 编排（被常驻网关
    吸收）、provider 优先的整体框架（A 路径降为 B 的薄适配）。
  - 顺手修：turn-fold 的 `turnInterrupted` 死文案（interrupted 应有自己的
    消息而非复用 aborted）。
- **dsh 源码**：`tmp/deepseek-harness`（已 git-ignore，上游
  `deepseek-ai/deepseek-harness`，`dsh web` 默认 `127.0.0.1:3080`）。
  可本地跑真实实例做验收。协议事实速查见文末附录。
- **popup 现状**：纯设置面板（PopupNew tabs）；聊天在页面浮窗
  （content script）。popup 加回聊天是 D-19 的产品变更，落在 Phase B。
- **既有先例**：vite 多入口（ApiServer.html、IndependentPanel.html）、
  providers/registry、manifest 已有 sidePanel + DNR 权限
  （**缺 `notifications` 权限，Phase A 需加**）。

## Phase A · dsh 模块首建（✅ 已实现，待终验）

**目标**：核心闭环可日喝——全页驾驶舱里看台账、答审批、发 prompt、收通知。
**验证对象**：模块缝的形状、网关设计、ui-console 全部契约。

任务分解：

- **A1 模块骨架**：`src/modules/dsh/`（module.mjs 清单 + background/ + ui/ +
  tests/）；最小缝 = `registerModule({ id, background, uiEntries, configSlice })`
  + vite 入口 `dsh.html`；lint 规则强制边界（模块只准 import `src/modules/api.mjs`）。
  缝的 API 只提取 dsh 实际用到的，不做通用化。
- **A2 网关**（`src/modules/dsh/background/`）：单条 mux + 单条 host 流常驻
  订阅；重连退避 500ms×2 封顶 10s，重连后重拉活跃会话 history 尾页 +
  projections 基线（fold 幂等保证不重复）；会话注册表
  （summary + 结构化 blocks + 投影存储高 seq 胜出 + queue/jobs 快照）；
  UI 经 runtime Port 订阅扇出；pending 审批/问答按 rpcId 索引（重放稳定），
  应答统一走 `/api/respond`；保活仅在任一会话 running 时发 host.describe。
  fence 规则收编为 `fence.mjs`。
- **A3 全页驾驶舱**（按 ui-console.md 实现）：全局头（身份+健康点+等待药丸）、
  侧栏（session.list + host 流实时 + 搜索）、会话栏（标题/模型/自动审批开关）、
  台账三语域（散文/机器行/决策卡 + turn 结尾注记）、composer
  （queue/steer/图片/上下文芯片/停止/排队撤回）、状态设计（空/空白/离线）。
- **A4 OS 通知 + badge**：审批/提问到达且无 UI 附着时 `chrome.notifications`
  + action badge 计数；turn 完成默认不通知（D-6）。manifest 加
  `notifications` 权限。
- **A5 设置入口**：引擎列表里一张默认关闭的卡片 + 端点 + 诊断
  （复用分支的 diagnose），注册进新缝，**不进 AdvancedTab**。

**验收**：并入终验清单（见文末），不再单独设门。

## Phase B · 表面扩展（✅ 已实现，待终验）

- sidepanel 档（同组件窄档）；popup 档（聊天回到 popup + **草稿自动保存**，
  等待卡钉顶）；浮窗审批卡（D-5，浮窗对 L3 长器官、对 L1 保持纯净）；
  A 路径薄 provider（划词/右键派活 → 网关会话，上下文芯片兑现
  "上下文即所见"）；steer 露出与排队撤回打磨；D-12 换引擎披露一行提示
  （契约判例，随本阶段浮窗改动顺手兑现）。
- **验收**：并入终验清单。

## Phase C · 存量收割（✅ 已实现，待终验）

每步一个纯搬运提交，目标 IA = 三概念（引擎/集成/指令）+ 外观 + 数据：

- **C1 ChatGPT Web 冻结搬迁**（第一刀，验证缝的"搬迁"半边）：端点配置、
  历史同步、备份、调试视图整体归入模块，行为零改动（D-3）。
- **C2 Engines 抽取**：General 的 Provider Settings + Advanced 的
  Providers & Models 矩阵 → 统一引擎解剖图（状态/能力徽章/凭据/诊断）。
- **C3 ApiModes 归 Sites**（D-14 落地）：按站点引擎指定并入站点规矩。
- **C4 Tools 独立**：Selection Tools、Search Engine Queries 归位。
- **验收**：并入终验清单（行为零改动逐项比对）。

## Phase D · 首启体验（✅ 已实现，待终验）

- D-15 落地：检测到已登录 ChatGPT 会话直接开聊，但先取账号模型列表再定
  默认；设置侧模型选择器按账号可用性过滤（遗留项关闭）。
- **验收**：并入终验清单。

## 终验清单（D-21：全部实现 + 两轮 review 通过后，由产品负责人一次执行）

**A · 核心闭环**（对着本地真实 dsh web）：
1. 能选工作区（系统目录框）、能切模式、能建会话、能对话、能批工具、能停、能 steer/排队。
2. 能配模型与凭据、改通用设置、管插件、管 preset 名册（复制/删除/默认/打开目录）。
3. 能用 jobs、skills、subagents、plan、workflow、轨迹、产出文件、目标——与当时本机 DSH Web 同一实例上能用的能力对等。缺能力时入口隐藏或诚实不可用，不留死按钮。
4. 日常不再需要打开 `:3080`。后台可能仍有一个安静的 harness-origin carrier tab（D-22），使用者不当它是产品表面。

**B · 表面扩展**：
6. 从任意浏览器状态应答审批 ≤3s ≤2 操作（通知/popup/浮窗/DeepSeek Harness 四路）。
7. popup 草稿失焦不丢字；quick ask 在被排除站点落 popup。
8. 浮窗对 L3 长审批卡、对 L1 保持纯净；换引擎出现一行记忆语义提示（D-12）。
9. 页面上下文 prompt 占比可度量（"浏览器成为 agent 的眼睛"开始成立）。

**C · 存量零回归**：
10. ChatGPT Web 端点配置、历史同步、备份、调试视图行为与搬迁前逐项一致。
11. 引擎/集成/指令三概念设置可寻性：定位任一设置的试错次数 ≤ 1。
12. 存量用户升级后无设置丢失（迁移兜底）。

**D · 首启**：
13. 无任何 API key 且已登录 ChatGPT：60 秒内得到第一个答案，默认模型取自
    账号真实可用列表。
14. 设置侧模型选择器不再展示账号用不了的档位。

## 附录 · dsh 协议事实速查（执行 A2 时需要）

- **两条下行流**：`/api/events.mux`（session 帧：session/event、
  approval/requested|resolved、question/requested|resolved、session/queue、
  session/jobs、session/projection、stream/error）与 `/api/events.host`
  （session-added/removed/status、workspace 变化、agent 错误）。
  纯下行，客户端发帧即 1008 断开。所有帧广播给所有订阅者。
  浏览器侧**必须**由 harness origin 上的内容脚本发起（D-22）：扩展上下文
  的 WS 握手恒带 `Origin: chrome-extension://…`，被 trust fence 拒绝，且
  Chromium DNR 无法改写 WS 握手头（remove/set 均无效，Chrome for Testing
  151 实测）。下行走 downlink-bridge 的 carrier tab 桥接。
- **RPC**：`POST /api/<method>`，`{type:'client-request',rpcId,method,payload}`
  → `{type:'server-response',rpcId,result:{ok,value|error}}`；业务错误
  HTTP 200。**应答审批/问答**：`POST /api/respond`
  `{type:'client-response',rpcId,result}`；先答先得，迟到得
  `{accepted:false}`。pending 重放带原 rpcId（mux 重开时），无超时。
- **A 阶段用到的方法**：session.list（updatedAt 降序，含 running/blank 标志）、
  session.search、session.create（客户端预分配 uuid 幂等；cwd 冲突报
  session-conflict）、session.history（`beforeSeq` 向前翻页；缺省=尾页含
  在飞 chunk 与 projections 基线）、session.prompt（mode: queue|steer；
  content 支持 text 与 image 块；leading `/` = 命令；带 clientTimeZone）、
  session.cancel、session.models/selectModel、host.describe。
- **turn/end reason**：completed | aborted | blocked | error | max-tokens |
  interrupted——台账结尾注记的六种形态。
- **信任围栏**：Host 须 loopback；`sec-fetch-site: cross-site` 拒绝；
  Origin 若存在须同 host:port，缺失则放行。扩展经 DNR 剥 Origin +
  置 Sec-Fetch-Site:none 通过（分支 fence.mjs 已实现并通过测试）。
  特权方法（settings.*/credentials.*/llm.discoverModels/host.openPath 等）
  钉死 loopback——我们不走这些（D-13）。
- **重连语义**：`since` 增量未实现；官方客户端策略 = 重开两流 + 重拉
  history，即 A2 采用的策略。
