# DeepSeek Harness 完整客户端（扩展内替代 DSH Web）

> 状态：已定稿（待实现）
> 日期：2026-08-18
> 参考：本仓库现有 `src/modules/dsh/`；上游 `tmp/deepseek-harness`（`deepseek-ai/deepseek-harness`）的 Web 客户端与 `/api` 契约

## 一句话

本机继续跑 `dsh`。扩展做成完整客户端：DSH Web（默认 `:3080`）上能做的事，扩展里都能做，使用者不必再打开那张网页。

## 已决

| 项 | 决定 |
| --- | --- |
| 引擎 | 本机 `dsh` 进程仍是手。扩展不执行工具 |
| 客户端 | 原生 Preact 重做全部 DSH Web 表面，不 iframe、不嵌官方 React 插件树 |
| 完成定义 | 与 DSH Web **页面级对等**（A2），外加工作区选择、模式下拉为一等控件 |
| 模式 | Agent Preset：标准 / PTC / 极简 / 创造（host 的 `standard` / `code` 或更新的 PTC id / `minimal` / `cordis`）。以 `agentPreset.list` 的 `id`+`name`+`description` 为准，不写死四项 |
| 信息架构 | 对齐 DSH Web 的地图（工作区、会话、对话、设置、jobs、skills…），换我们自己的 UI |
| 命名 | 对外禁止「驾驶舱 / cockpit / console」。人认的是 DeepSeek Harness |
| 视觉 | 现有全页不保留。安静本地工具，密度接近 DSH Web，跟扩展亮/暗主题。唯一强调控件是模式下拉 |
| 浮窗 / popup | 只做对话 + 审批。完整客户端只在全页 `dsh.html` |
| UI 结构 | 壳 / 页 / 控件 / 适配 分开，后面能换皮 |
| 交付 | 一次交齐最终结果，不按「第一刀 / 第二刀」定义完成 |

## 明确不做

- 不替代本机 harness 进程，不在扩展里跑工具、读盘、起 shell
- 不把 :3080 嵌进扩展当 UI
- 不把 DSH 会话混进扩展浮窗那份「从扩展诞生的会话列表」（D-4 对浮窗仍成立）。全页是引擎侧会话列表的客户端，和 DSH Web 一样展示该实例上的全部工作区与会话
- 不做多 harness 抽象
- 不改 harness 源码。只走已有 `/api` + 两条下行流
- 不为「更稳」去改信任围栏语义：endpoint 仍必须是 loopback；特权方法只在 loopback + 现有 DNR 头改写下调用

## 推翻的旧决策

实现时同步改产品文档，旧条目标记被取代，不删历史。

| 旧条 | 新条 |
| --- | --- |
| D-13 / definition「不替代引擎底层管理；不做 settings/credentials 写」 | 扩展是完整 Web 客户端，读写 settings、credentials、preset 名册、工作区 |
| ui-console「不做 workspaces、jobs 明细、subagents、轨迹、导出…」 | 这些面全部做，行为对齐 DSH Web |
| D-16「中栏是台账不是气泡流」作为组织原则 | 中栏按 DSH Web 对话流（用户气泡 + 可检视工具行 + 审批/提问）。工具仍可展开参数/结果，不用「台账」当产品隐喻 |
| D-18「v1 无第三栏」 | 允许 DSH Web 同款的按需 details（工具检查、子代理转录），默认关上 |
| 用户文案「驾驶舱」 | 删除。设置卡、空态、通知、locale 一律改成 DeepSeek Harness / 打开 DeepSeek Harness |

D-2（模块默认关）、D-5（浮窗长审批卡）、D-6（只在等你时通知）、D-7/D-8（审批同等醒目、每会话自动审批）、D-22（下行走 carrier tab 桥）保留。

## 成功标准

使用者在只开本扩展、本机 `dsh` 已运行的前提下：

1. 能选工作区（系统目录框）、能切模式、能建会话、能对话、能批工具、能停、能 steer/排队。
2. 能配模型与凭据、改通用设置、管插件、管 preset 名册（复制/删除/默认/打开目录）。
3. 能用 jobs、skills、subagents、plan、workflow、轨迹、产出文件、目标——与当时本机 DSH Web 同一实例上能用的能力对等。缺能力时入口隐藏或诚实不可用，不留死按钮。
4. 日常不再需要打开 `:3080`。后台可能仍有一个安静的 harness-origin carrier tab（D-22），使用者不当它是产品表面。

## 架构

四层，只通过明确接口说话。

```
dsh.html
  shell（头 / 侧栏槽 / 主栏槽 / 设置壳）
    pages/*（注册进来的面）
      chrome/*（工作区、模式、权限、模型……纯展示）
        adapter（Port + RPC + 投影，唯一碰网关的 UI 层）
          gateway（已有，扩大方法表）
            client fetch + downlink-bridge
              本机 dsh /api
```

- **壳**只排 DSH Web 那张地图，不写业务、不打 RPC。
- **页**按 id 注册：`conversation`、`settings`、`jobs`、`skills`、`subagents`、`plan`、`workflow`、`trajectory`。换某个面只换注册。
- **控件**只收 props 和回调。
- **适配**拥有 `useGatewayPort`、RPC 封装、把 host/mux 帧折成页要用的 view-model。UI 不依赖网关内部 `GwSession` / fold 形状。
- **token** 集中在一份样式文件。改审美先改 token 和壳。

模块缝不变：`src/modules/dsh/` 只能 import `src/modules/api.mjs`；核心只经 `index.mjs` / `background-services.mjs` / `settings-cards.mjs` 进来。浮窗/popup 继续走 runtime 消息 + 小卡片，不再往 `ConversationCard` 里堆整页。

### 文件（预期）

现有 `Cockpit.jsx` / `Sidebar.jsx` / `Ledger.jsx` / `SessionBar.jsx` / `Composer.jsx` / `dsh.css` 拆进新结构后删除旧装配名。用户可见字符串不得再含 cockpit/驾驶舱。

| 路径 | 职责 |
| --- | --- |
| `src/modules/dsh/ui/app.jsx` | 挂载全页，选主题 |
| `src/modules/dsh/ui/shell/` | 头、三槽布局、窄档（sidepanel）让步 |
| `src/modules/dsh/ui/adapter/` | Port、RPC、工作区/会话/投影的 view-model |
| `src/modules/dsh/ui/chrome/` | 工作区选择、模式下拉、权限、模型、等待药丸 |
| `src/modules/dsh/ui/pages/` | 各注册面（对话、设置各节、jobs…） |
| `src/modules/dsh/ui/tokens.css` | 颜色/字号/密度。禁止在页里写散装品牌色 |
| `src/modules/dsh/background/gateway.mjs` | 扩大 `rpcHandlers`，订阅 workspace / settings / jobs 等帧 |
| `src/modules/dsh/ui/SettingsCard.jsx` | 引擎列表卡：开关、endpoint、诊断、「打开 DeepSeek Harness」 |
| `src/background/providers/dsh-bridge.mjs` | 浮窗薄适配，不膨胀 |

## 信息架构（最终画面）

```
┌─────────────────────────────────────────────────────────────┐
│ DeepSeek Harness  ● 本机 · 版本    设置    [N 个在等你]       │
├──────────┬──────────────────────────────────────────────────┤
│ 工作区   │ 会话标题   模式  模型  权限  自动审批  jobs skills │
│ + 添加   │ [对话] [轨迹]                                     │
│ 搜索     ├──────────────────────────────────────────────────┤
│ ▸ 仓库A  │ 对话流                                            │
│   会话   │                                                  │
│ ▸ 仓库B  ├──────────────────────────────────────────────────┤
│          │ 排队 · todo · 目标 · 上下文          [标准模式 ▾] │
│          │ +  /plan  权限  模型     输入              发送/停│
└──────────┴──────────────────────────────────────────────────┘
```

- 无工作区：中间是选目录入口，输入区不可发（与 DSH Web 空态相同）。
- 新会话：先有工作区 + 模式下拉，再 `session.create({ workspaceId, agentPreset, sessionId })`。
- 会话已开跑：模式只读（host 回 `agent-preset-locked`）。空白会话可用 `agentPreset.select`。
- 侧栏按工作区分组；`origin: 'subagent'` 的会话不出现在侧栏，从父会话 header 的 subagents 目录进。
- 设置从全局头进入同一面板，不进扩展 Advanced 页。

窄于约 520px（sidepanel）：侧栏收成会话/工作区下拉，其余同一套组件。

## 表面与协议（对等清单）

行为以当时本机 harness 的 `/api` 为准。扩展不发明第二套语义。

### 工作区

- `workspace.list` / `create` / `rename` / `delete` / `insertBefore` / `insertSessionBefore` / `archiveSession`
- 添加：`host.pickDirectory`（系统选目录，取消为静默）→ `workspace.create({ path })`。扩展不自己做本机文件夹框。
- 删除工作区只解注册，不删磁盘、不删会话；那些会话落到未分组。
- 归档会话从所有分组表面消失；不做取消归档（上游也没有）。

### 模式（Agent Preset）

- 下拉：`agentPreset.list`。broken 的不出现在选择器，出现在设置名册。
- 新会话芯片：选中值在空白会话上 `agentPreset.select` 或随 `session.create` 带上。
- 设置页名册：`read` / `copy` / `remove` / `openDocument`；复制是唯一创建路径；系统 preset 只读预览；`hasDocument: false` 时展示路径文本，不放死按钮。
- 默认 preset 写 `settings.mutate` 的 `agent-presets.default`（与 Web 相同命名空间）。

### 对话与输入

已有：`session.prompt`（queue/steer）、`cancel`、`rename`、`fork`、`history`、图片块、草稿自动保存、停止。

补齐与 DSH Web 相同的输入面：

- `+` 打开命令：`command.list` / `command.execute`（含 `/plan`、`/permission`、`/compact`）
- skills：`skill.list`；选中插入 `/name `，发送仍走 `session.prompt`（host 注入 skill 内容）
- 权限芯片：读会话 `permissions` 投影；选择执行 `/permission <preset>`；`danger-full-access` 先确认
- plan 芯片：投影为 plan 时显示，点一下执行 `/plan off`；进入只通过命令菜单或手打 `/plan`
- 模型：已有 `session.models` / `selectModel`，座位与 Web 相同（发送键左侧）
- 队列：已有撤回；补纯文本行编辑；空草稿时 Cmd/Ctrl+Enter 对仍排队项做 FIFO steer（与 Web 相同；host 把已关闭窗口的 steer 收成下一条 queue，不报失败）
- todo / 目标 / 上下文占用：读对应投影，空则不渲染
- 思考行、压缩检查点、产出文件、workflow run 节点、消息反馈：按 mux/history 事件与 Web 同款入口渲染，与 Web 同语义

### 审批 / 提问

已有 `/api/respond`、决策卡、通知、badge、每会话自动审批。全页里待决策接管输入区（与 Web 一致）；浮窗/popup 仍用卡片。自动审批只代批 approval，不代答 question。

### 设置

设置面板分节，数据全来自特权配置面（loopback）：

| 节 | 协议 |
| --- | --- |
| 通用 | `settings.describe` / `mutate`（locale、permission 默认、ui-conversation、ui-theme 等已暴露命名空间） |
| 模型与凭据 | `llm.providers` / `llm.models` / `llm.discoverModels`；`credentials.describe` / `set` / `unset`；对应 settings 命名空间 |
| 插件 | host 已暴露的 plugin 节（如 `agent-loop`、`bash`、`web-search-deepseek`）+ 插件清单面（与 Web 的 plugins / inventory 对等） |
| Agent presets | 见上 |
| 打开文档 | `settings.openDocument` / `agentPreset.openDocument` / `host.openPath`（仅 host 允许的目标） |

`settings.describe` 的 schemastery schema 驱动表单，不手写每个字段。未暴露命名空间回 `settings-not-exposed`，不探测枚举。写带 `expectedRevision`，冲突回 `settings-conflict` 后重拉再写。密钥只出不回：describe 无 secret 值，只在 set/mutate/discover 上行。

### jobs

不另开 RPC。网关把 `session/jobs` 折进会话 view-model。会话头在「该会话看得到至少一条 job」时出现入口；列表语义对齐 Web（running/stopping 计数、已结束仍可见直到 registry 丢掉）。只读；不做取消（上游行只读）。

### subagents

- 侧栏隐藏 `origin: 'subagent'`
- 父会话头目录：`subagentsByParent` + 打开子会话
- 续写走 `subagent.list` / `subagent.prompt` / `subagent.interrupt`
- `@` 引用插入字面 `@label `，零额外 RPC

### 轨迹

对话头第二个 view tab。数据来自已有/host 的 trajectory 投影或事件；无投影则不画 tab。

## 数据流

```
UI 手势 → chrome 回调 → adapter.rpc(method, payload)
  → gateway.callRpc → createDshClient POST /api/<method>
  → 结果回 adapter → 页重绘

mux / host 帧 → downlink-bridge → gateway 注册表
  → Port 消息（sessions / session / ledger / workspaces / jobs / connection）
  → adapter 折 view-model → 壳与页
```

`session.create` 必须带调用方选定的 `workspaceId` 与 `agentPreset`（若名册非空）。禁止再发无工作区的「光秃 create」（当前网关如此），否则空态契约破掉。

重连：已有策略（重开两流 + 重拉 list/history）。补 `workspace.list` 与 settings 失效信号（`settings/changed`、`credentials/updated`、`agent-preset/selected`、`commands/change`）的重拉。fold 仍然幂等。

## 错误处理

| 情况 | 使用者看到 |
| --- | --- |
| 模块关 / endpoint 非法 | 全页诚实离线：本机 `dsh` 是否在跑、诊断按钮。无假列表 |
| 403 / fence | 诊断指明 loopback 与头改写，不说「旧 harness」 |
| `host.pickDirectory` 取消 | 无提示 |
| `directory-picker-unavailable` | 说明本机选目录不可用（无桌面/无 zenity 等），不放死按钮 |
| `workspace-invalid-path` / `name-conflict` | 留在添加/重命名对话框 |
| `agent-preset-locked` | 模式下拉变只读，不报崩溃 |
| `settings-conflict` | 重拉后让使用者再存 |
| `settings-not-exposed` | 该节不出现 |
| 审批迟到 `{accepted:false}` | 卡留着，说明已被别处应答 |
| 特权方法在非 loopback | 不会发生：fence 层拒绝非 loopback endpoint 启动网关 |

失败本身可以；静默当成功、假列表、死按钮不行。

## 视觉

- 跟扩展 `data-theme` 亮/暗，不另做一套皮肤品牌。
- 去掉菱形「◆」、仪表盘隐喻、满屏琥珀。
- 模式下拉：名称 + 一句能力说明 + 当前勾选（使用者提供的 DSH Web 交互）。
- 琥珀只用于真的审批/提问。
- 状态点：运行蓝、等你琥珀、闲置中性。不用现有全页的装饰密度。

## 测试

现有网关/fold/downlink/模块缝测试保留并扩展，不测真实 `dsh web`、不测真实目录框。

必须有的纯测试：

- 模块缝：新目录仍不得 import 除 `api.mjs` 外的核心
- 网关：`session.create` 传递 `workspaceId`+`agentPreset`；workspace.* / agentPreset.* / settings.* 代理；未知方法仍失败
- adapter view-model：工作区分组、归档隐藏、subagent 不进侧栏、broken preset 不进选择器、空工作区 ⇒ 不可发送
- 模式下拉：list → 选项；blank 可 select；非 blank 只读
- 设置 mutate：revision 冲突不覆盖
- locale：无「驾驶舱/cockpit」用户串
- 浮窗：仍只通过消息收决策，不 import `pages/`

## 产品文档

实现同一变更集改：

- `docs/product/decisions.md` 追加取代 D-13/D-16/D-18 文案部分的新决策
- `docs/product/definition.md`「明确不承诺」改为「不替代本机引擎进程；完整替代 DSH Web 客户端」
- `docs/product/ui-console.md` 按本文 IA 重写，并去掉「驾驶舱」标题
- `docs/product/roadmap.md` 终验清单改为本文成功标准

## 实现约束

- 瀑布：对照本文清单一次做完。计划里的任务是为了可审可测，不是产品上的「先交付半套」。
- 上游方法名以 `tmp/deepseek-harness/packages/host/apiproxy` 的 `RpcMethodMap` 为准；host 若无某方法，对应入口隐藏。
- 不新增 npm 依赖来搬官方客户端。
- 默认 `dshModuleEnabled: false` 不变；关掉时扩展对其余用户零可见变化。
