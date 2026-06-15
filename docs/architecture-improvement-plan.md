# chatGPTBox 架构治理计划（Architecture Improvement Plan）

> 状态：待实施（handoff 文档）
> 来源：两份独立 architecture review 合并、去重、校准后形成
> 日期：2026-06-15
> 实施方式：瀑布式，按依赖与 ROI 排序，每步独立可交付

本文档是自包含的。接手的会话应先读「第 1 节 总体判断」和「第 4 节 执行顺序与依赖」，再从第 1 步开始逐项实施。所有文件引用均已对照源码核实（行号基于本计划编写时的 master 分支 `ed15d1b`）。

---

## 1. 总体判断

项目**不是乱写代码**，而是"功能持续叠加 + 重构进行到一半"的典型中间态。近期 P0~P3.5 提交（拆 config、提取 provider registry、收敛 chatgpt-web、建立 vitest）方向正确，但只完成约 60%。

当前真实形态是 **5 个系统揉在一个浏览器扩展壳里**：

1. **扩展壳**：content-script 注入 + 多入口 UI（popup / sidepanel / independent window / options / api-server page）
2. **多 provider runtime**：web + api 两路，约 17 家供应商
3. **页面注入系统**：site-adapters（Google/GitHub/YouTube 等 18 个）+ selection-tools + 浮窗
4. **本地 API Server Bridge**：OpenAI 兼容端点 + WebSocket proxy
5. **实验性 agent runtime**：assistants + ZIP-imported skills + MCP（内置 + 外部 HTTP/SSE JSON-RPC）

**核心病灶**：这 5 个能力没有被组织成清晰的「内核 / 适配器 / 用例 / UI」四层，而是各凭本事长出来，导致边界穿透、概念散落、命名歧义、文档与实现脱节。

**体检数据**：

| 维度 | 数据 |
|---|---|
| 源码文件 | 191 个（.js/.jsx/.mjs） |
| 总代码量 | ~30,300 行 |
| 测试文件 | 7 个 / 191 源文件（~3.7%，严重不足） |
| 超大文件 | 6 个 >1000 行，最大 1359 行 |
| 最大文件 | `services/clients/chatgpt-web/client.mjs`（1359）、`background/index.mjs`（1329）、`components/ConversationCard/index.jsx`（1307） |

---

## 2. 问题清单（按严重度分级）

### 🔴 P0 — 文档承诺与默认构建不一致（发布/信任风险）

**最高优先级，外部可见的信任问题。**

- `README.md:27` Features 把 "Agent runtime with assistants, ZIP-imported skills, MCP..." 当正式功能列出。
- 但 `package.json:14` 的 `build`/`dev` 默认 `enableAgents=false`（`build.mjs:17`），agent 模块会被 `src/stubs/*.stub.mjs`（`build.mjs:115-135` 的 5 处 `replaceModuleWhenAgentsDisabled`）替换成 no-op。
- 后果：用户按 README 装 release 包发现 agent 功能不存在；贡献者读代码读到的是 stub。发布包、文档、源码三者预期错位。

### 🔴 P1 — core 入口职责过度集中（系统边界穿透）

`background/index.mjs`（1329 行）同时是 6 个系统的入口：
- 消息路由：`onMessage` 21 个 case（`index.mjs:624`）
- provider 执行入口：`executeApi`（`index.mjs:599`）
- ChatGPT proxy tab 生命周期 + session lock（`index.mjs:85-540`）
- FETCH 安全代理（`index.mjs:742`）
- header rewrite / declarativeNetRequest 规则（`index.mjs:872-1067`）
- API bridge WebSocket proxy（`index.mjs:1166`、`index.mjs:1230`）

更糟：**provider 通过 `ctx` 反向回调 background 内部函数**（见 `background/providers/chatgpt-web.mjs` 的 `ctx.acquireChatgptWebSessionLock` / `ctx.ensureChatgptProxyTab` / `ctx.sendChatgptProxyRequest`）。本该是叶子模块的 provider 反向依赖 background 内部，导致 background 无法拆分。

`components/ConversationCard/index.jsx`（1307 行）同样 UI + 状态机 + transport client 三合一，管 session/port/错误展示/Bing 前台执行/ChatGPT Web 快照/模型选择/agent 选择/页面上下文采集/归档导出。多入口一致体验的最大阻力。

### 🔴 P1 — config 是 god object

`defaultConfig`（220+ 字段，`config/storage.mjs:141`）同时是存储 schema + 默认 UI 状态 + provider 密钥 + agent 内置资产 + 站点适配清单 + 迁移基准。`getUserConfig()`（`storage.mjs:364`）承担全量迁移修复，其中 ~90 行手写 `numericFix`/`needsFix`/赋值回写，每个数值字段要在 **3 处**重复登记。

### 🔴 P1 — provider/model 扩展是"多表联动"

加一个供应商要改 6~7 处：`config/models.mjs`（key 数组 + group + Models 表）→ `config/predicates.mjs`（isUsing*）→ `background/providers/<x>.mjs`（match+run）→ `background/providers/registry.mjs`（顺序敏感，测试 pin 顺序）→ `services/apis/<x>.mjs`（HTTP）→ 可能 `services/clients/<x>/`（SDK）→ UI 可见性 + 默认激活。极易漏。

### 🟠 P2 — 命名歧义（bard vs gemini）

同一东西两套名字贯穿全栈：
```
services/apis/bard-web.mjs          ← Bard
services/clients/bard/               ← Bard
background/providers/gemini-web.mjs  ← Gemini
config/models.mjs: bardWebModelKeys / bardWebFree('Gemini (Web)')
config/predicates.mjs: isUsingGeminiWebModel()
```
找 Gemini 相关代码要同时 grep 两个词。Google 改名 Gemini 已两年。

### 🟠 P2 — Agent/MCP runtime 协议与编排未分层

`services/mcp/tool-loop.mjs`（1225 行）同时做：内置工具目录 + MCP catalog + OpenAI Chat/Responses/Anthropic 三种协议转换 + 工具执行 + agent memory 更新。下一种协议进来继续膨胀。

### 🟠 P2 — 消息协议是散落的裸字符串

background / content-script / popup / API bridge 之间大量裸 `type` 字符串，无集中 schema。且**大小写不一致**：background `onMessage` 用大写 `CHATGPT_WEB_LIST_CONVERSATIONS`，content-script 用小写 `chatgpt_web_list_conversations`。改发送端忘接收端的高发区。

### 🟠 P2 — 权限和安全边界偏宽

- `manifest.json` content_scripts.matches：`https://*/*`、`http://*/*`、`file://*/*`（注入所有页面）
- host_permissions 含 `<all_urls>`
- CSP `connect-src 'self' http: https: ws: wss:`（放开所有 http/https/ws）
- background 提供 `FETCH` 代理（`index.mjs:742`）并按用户配置扩展 allowlist

目前有防线（allowlist + scoped header rewrite），但权限未与 feature profile 绑定——只用 ChatGPT API 的用户仍被注入所有页面、持所有 host 权限。

### 🟡 P3 — feature-flag stub 机制过度复杂

为 `enableAgents=false` 不含 agent 代码，引入 5 个 stub + 5 处 build 映射 + 契约测试 + README 一整节解释。而 `defaultConfig.enableSkills: ENABLE_AGENT_FEATURES` 已是运行时开关——两套机制并存。

### 🟡 P3 — 文档与实现偏离

- `docs/enhancement/` 两份文档自标"历史/项目收口日志"，但仍显眼放置。
- `task-review-log.md` 53 任务全 "Passed" 指文档审计非代码测试，措辞误导。
- 两套 manifest（MV3 + MV2）手工同步，permissions 完全不同，迟早漂移。

### 🟡 P3 — 测试覆盖严重不足

7 个测试 / 191 源文件。核心路径（chatgpt-web 1359 行 client、ConversationCard runtime、API bridge）无单元测试覆盖。重构无安全网。

---

## 3. 九步治理路线（瀑布式）

每步含：目标 / 范围 / 具体任务 / 验收标准 / 风险 / 依赖。

---

### 第 1 步：对齐 release profile（解决 P0）★ 最高优先级

**目标**：让 README / 构建脚本 / 发布包 / 截图 四者预期一致。

**范围**：`README.md`、`README_CN.md`、`package.json`、`build.mjs`、`docs/`。

**具体任务**：
- [ ] 定义显式 release profile：`core`（默认，无 agent）/ `agents`（含 agent runtime）/ 可选 `api-bridge`、`minimal`。在 `docs/` 写一份 profile 说明。
- [ ] README Features 区分"默认可用"与"实验性（需 `--agents` 构建）"。或在第 8 步决定 agent 默认开启后删 stub（二选一，需在此步先做产品决策）。
- [ ] `package.json` 增加显式 script：`build:agents`（带 `--agents`），让默认 `build` 行为与 README 字面一致。
- [ ] 校对截图与 Features 描述：截图里出现 agent UI 的，标注仅在 agents profile 下可用。
- [ ] 若决定 agent 转为默认开启：跳过本步的"区分实验性"分支，直接进入第 8 步删 stub，并相应更新 README。

**验收标准**：
- 默认 `npm run build` 的产物行为与 README Features 字面描述一致（要么 README 标注实验性，要么产物真的含 agent）。
- 存在文档明确列出各 profile 及其构建命令。
- 贡献者按 README 操作不会遇到"功能不存在 / 代码是 stub"的错位。

**风险**：产品决策（agent 是否默认开启）会影响后续第 8 步方向。若不确定，推荐先按"README 标注实验性"做（成本最低、不改变构建产物）。

**依赖**：无。独立可做，应立即执行。

---

### 第 2 步：建立 message contract 层（解决 P2 散落协议）

**目标**：消除"改发送端忘接收端"和大小写不一致；为第 3 步拆 background 提供前置依赖。

**范围**：新建 `src/protocol/messages.mjs`，迁移 `background/index.mjs`、`content-script/index.jsx`、`popup/*`、`pages/ApiServer/App.jsx` 的裸字符串。

**具体任务**：
- [ ] 新建 `src/protocol/messages.mjs`：集中定义所有 runtime message 的 `type` 常量（按命名空间分组，如 `ChatgptWeb.ListConversations`、`Runtime.Fetch`）、payload validator（轻量，可用 zod 或手写 guard）、response shape 注释。
- [ ] 全量替换裸字符串：把 `background/index.mjs:624` 的 21 个 case、`content-script/index.jsx`（小写 case 与 `message.type ===` 分支）、popup、ApiServer 的 type 字符串改为导入常量。
- [ ] 统一大小写：建议全大写蛇形（`CHATGPT_WEB_LIST_CONVERSATIONS`），与 background 现有惯例一致；content-script 的同名小写全部改为引用同一常量。
- [ ] 新增测试 `tests/message-contract.test.mjs`：静态扫描发送端（`{type: X}` / `postMessage({type: X})` / `sendMessage({type: X})`）与接收端（`case X` / `message.type === X`）的常量集合，断言两者匹配且无裸字符串残留。

**验收标准**：
- `grep -rn "case '" src/` 在 background/content-script 中无残留裸字符串（全部走常量导入）。
- message-contract 测试通过，且能抓出"发送端加了 type、接收端没加"的情况。
- 大小写统一，同名 type 在全仓库只有一个常量定义。

**风险**：迁移面广，需保证运行时行为不变。每改一处用常量替换，保持值不变即可。建议分 provider/子系统小步迁移并随时 `npm test` + 手动冒烟。

**依赖**：无（独立）。但它是第 3 步的前置——没有集中的 message 定义，拆 background 会进一步分散协议。

---

### 第 3 步：拆 background（解决 P1 入口集中）

**目标**：`background/index.mjs` 只剩 listener 注册，1329 行拆成按系统边界的子模块。

**范围**：`src/background/index.mjs` 及新建子模块。

**具体任务**：
- [ ] `background/message-router.mjs`：`onMessage` 调度（依赖第 2 步的 contract），把 21 个 case 的处理函数收敛进来。
- [ ] `background/chatgpt-proxy-service.mjs`：proxy tab 发现/创建/注入/等待完成（`index.mjs:345-540`）+ session lock（`acquireChatgptWebSessionLock`，`index.mjs:551`）+ `sendChatgptProxyRequest`/`sendChatgptProxyControlRequest` + debug log（`appendChatgptWebDebugLog`，`index.mjs:325`）。
- [ ] `background/fetch-proxy-service.mjs`：FETCH 安全代理（`index.mjs:742`）+ allowlist 管理（`getFetchAllowedOrigins`，`index.mjs:1040`）+ `getFetchTargetOrigin`。
- [ ] `background/api-bridge-proxy-service.mjs`：API bridge WebSocket proxy（`index.mjs:1166`、`1230` 两处 `onConnect`）。
- [ ] `background/webrequest-rules.mjs`：declarativeNetRequest / header rewrite（`index.mjs:872-1067`：`getScopedHeaderRewriteRules`、`syncScopedHeaderRewriteRules`、`addWebRequestListenerWithFallback`）。
- [ ] **解开 ctx 反向依赖**：provider 不再通过 `ctx` 回调 background 内部。`chatgpt-proxy-service` 暴露普通 export，`background/providers/chatgpt-web.mjs` 直接 import 调用。`executeApi` 的 `ctx` 参数可保留少量纯诊断函数，但 proxy/lock 必须改为正向依赖。

**验收标准**：
- `background/index.mjs` 行数大幅下降（目标 <300 行），只剩 `Browser.runtime.onInstalled/onStartup/onMessage/onConnect/alarms` 等注册语句和薄分发。
- provider 模块不再接收 `ctx.acquireChatgptWebSessionLock` 等内部回调（grep 无 `ctx.acquire`）。
- 现有测试（`provider-registry.test.mjs` 等）通过；手动冒烟：ChatGPT Web 对话、FETCH 代理、API bridge、selection tool 各跑一遍。
- chatgpt-proxy-service 有独立单元测试覆盖 lock 竞争与 proxy tab 复用。

**风险**：proxy tab 生命周期和 session lock 是最容易引入回归的区域（并发、tab 关闭、Brave 兼容）。拆分时保持逻辑等价，先搬移不改逻辑，再补测试。`registry.mjs` 注释明确"顺序 load-bearing"，拆分不得改动 provider 顺序。

**依赖**：第 2 步（message contract）。

---

### 第 4 步：拆 ConversationCard（解决 P1 组件集中）

**目标**：组件只做渲染，状态机和 transport 抽出，使 popup/sidepanel/independent window 三入口共享同一 runtime。

**范围**：`src/components/ConversationCard/index.jsx`（1307 行）及新建 hooks/controller。

**具体任务**：
- [ ] 抽 `src/hooks/useConversationRuntime.mjs`（或 `src/controllers/conversation-controller.mjs`）：封装 session 管理、port 生命周期、错误状态、Bing 前台执行、ChatGPT Web 快照、模型/agent 选择、页面上下文采集、归档导出。
- [ ] ConversationCard 改为只消费 runtime 暴露的 `state` + `actions`，删除内部的 transport/状态机代码。
- [ ] 检查 `pages/IndependentPanel/App.jsx`、`content-script` 浮窗、popup 三处是否各自重复了会话逻辑；若有，统一接到 `useConversationRuntime`。
- [ ] runtime 暴露的 action 命名稳定，便于后续多入口对齐。

**验收标准**：
- ConversationCard 行数显著下降（目标 <400 行纯渲染）。
- 三入口（popup/sidepanel/independent window）会话行为一致：新建/切换/删除/导出/模型切换/agent 选择走同一 runtime。
- `useConversationRuntime` 有针对状态机的单元测试（发送 → 流式接收 → 错误 → 重试）。

**风险**：Bing 前台执行和 ChatGPT Web 快照逻辑复杂且与 background 强耦合，抽离时注意 port 边界。建议先抽"纯状态"部分，transport 调用暂留接口，逐步内化。

**依赖**：可与第 3 步并行（互不阻塞），但建议第 3 步先完成以明确 port 契约。

---

### 第 5 步：建 provider adapter contract（解决 P1 多表联动）

**目标**：加一个供应商从"改 6~7 处"降到"实现一个接口 + 注册一行"。

**范围**：`config/models.mjs`、`config/predicates.mjs`、`background/providers/`、`services/apis/`、新建 contract 定义。

**具体任务**：
- [ ] 定义 adapter 接口（JSDoc typedef + 运行时校验）：`{ id, match, route, buildRequest, send, parseStream, finalize, supportsTools }`。
- [ ] 让 agent / tool-loop 依赖接口（`supportsTools`、`parseStream`）而非具体协议细节——为第 7 步铺路。
- [ ] 合并 `background/providers/<x>.mjs`（match+run）与 `services/apis/<x>.mjs`（HTTP）为一个 adapter 模块，消除"两层薄包装"。`services/clients/` 保留给真正复杂的 SDK（websocket/GraphQL/auth）。
- [ ] 让 model key 数组 / group / predicate 从单一数据源派生（models.mjs 一张表 → 自动生成 predicates + registry 注册项），消除多表手写。
- [ ] 加 `tests/provider-adapter-contract.test.mjs`：每个 adapter 必须实现接口的全部必需方法。

**验收标准**：
- 新增一个 mock 供应商只需：写一个 adapter 文件 + 在 registry 加一行 + models 表加一条。不再手动写 predicate。
- predicate 函数由 models 表生成，无手写重复。
- adapter contract 测试通过。

**风险**：合并 providers/apis 两层会触碰所有 17 家供应商，工作量大。可分批：先建接口 + registry 改造，再逐家迁移。`registry.mjs` 顺序保持不变。

**依赖**：无硬依赖，但第 7 步依赖本步的 `supportsTools`。

---

### 第 6 步：config 去 god object（解决 P1 配置膨胀）

**目标**：defaultConfig 不再吸收所有概念；迁移逻辑声明式。

**范围**：`src/config/storage.mjs`（893 行）及拆分。

**具体任务**：
- [ ] 拆 `config/` 为：
  - `schema.mjs`：字段定义 + 类型 + 默认值
  - `catalog.mjs`：模型/provider 内置清单（从 models.mjs 抽取静态目录部分）
  - `secrets.mjs`：密钥字段（apiKey/claudeApiKey 等）归类
  - `preferences.mjs`：用户偏好/UI 状态（themeMode/triggerMode 等）
  - `migrations.mjs`：迁移规则（已存在，强化）
- [ ] 把 `getUserConfig` 的 ~90 行手写 numeric clamp 改成**声明式表驱动**：定义 `NUMERIC_FIELDS = { maxResponseTokenLength: {min:100, max:MAX, default:D}, ... }`，循环生成 clamp / 比较 / 赋值回写。每加字段只登记一处。
- [ ] 保留 `config/index.mjs` barrel 作兼容 shim（现有大量 `from '../config'` 导入）。

**验收标准**：
- `defaultConfig` 不再混装密钥、UI 状态、agent 资产、迁移基准（按上述分类拆开）。
- 新增一个数值配置字段只改 1 处（表里加一行）。
- `config-migrations.test.mjs`（现有）扩充覆盖新迁移路径，全绿。

**风险**：barrel shim 必须保持向后兼容，避免破坏大量现有 import。建议先建新文件，老 storage.mjs 改为从新文件 re-export，再逐步迁移调用方。

**依赖**：无。独立可做，随时插入。

---

### 第 7 步：Agent/MCP runtime 分层（解决 P2 协议编排混杂）

**目标**：`tool-loop.mjs` 不再承载三种协议转换。

**范围**：`src/services/mcp/tool-loop.mjs`（1225 行）及新建 protocol-adapters。

**具体任务**：
- [ ] 抽 `services/mcp/protocol-adapters/`：`openai-chat.mjs`、`openai-responses.mjs`、`anthropic.mjs`，各自负责该协议的工具调用格式转换、流解析、错误映射。
- [ ] `tool-loop.mjs` 只保留编排循环 + memory 更新，通过第 5 步的 `supportsTools` + adapter 选择对应 protocol-adapter。
- [ ] 下一种协议（如 Gemini function calling）进来只加一个 adapter 文件。
- [ ] 复用 `services/apis/openai-responses-shared.mjs`（已存在）减少重复。

**验收标准**：
- tool-loop.mjs 行数显著下降，无协议特定细节。
- 三种协议各有独立 adapter + 单元测试。
- 新增协议不动 tool-loop 主循环。

**风险**：协议转换细节多（工具调用 schema、流式 token、stop reason）。抽离时保证每种协议的 happy path + error path 行为等价。

**依赖**：第 5 步（provider adapter contract 的 `supportsTools`）。

---

### 第 8 步：收敛 feature-flag 与命名（解决 P2/P3）

**目标**：消除命名歧义，评估 stub 机制，整理文档。

**范围**：命名统一、`src/stubs/`、`docs/`、`src/manifest.v2.json`。

**具体任务**：
- [ ] **bard→gemini 命名统一**（纯机械操作）：
  - 重命名 `services/apis/bard-web.mjs` → `gemini-web.mjs`、`services/clients/bard/` → `clients/gemini/`。
  - 旧路径保留一个 re-export 文件做一版本兼容，之后删除。
  - 统一 `config/models.mjs` 的 `bardWebModelKeys` → `geminiWebModelKeys`、`bardWebFree` → `geminiWebFree`，predicate 改名 `isUsingGeminiWebModel`（已是此名，对齐 model key）。
  - 全仓库 grep `bard`/`Bard` 清理残留。
- [ ] **重新评估 stub 机制**：若第 1 步决定 agent 默认开启，则删 `src/stubs/`（5 文件）+ `build.mjs` 的 5 处 `replaceModuleWhenAgentsDisabled` + `tests/feature-flag-contract.test.mjs`，降级为运行时门控（`defaultConfig.enableSkills` 已够用）。若 agent 仍为实验性，保留但精简文档。
- [ ] **docs 分层**：`docs/enhancement/`（两份历史文档）→ `docs/history/`；`task-review-log.md` 顶部加更明确的"非测试覆盖"声明；只留 `docs/agents-runtime-v2.md` 作当前运行时参考。
- [ ] **MV2 manifest 退役**：除非仍需支持旧 Firefox，删 `src/manifest.v2.json`，减少一份手工同步。确认 `build.mjs`/safari 构建不再引用。

**验收标准**：
- 全仓库无 `bard`/`Bard` 残留（除兼容 re-export 的过渡期）。
- 若删 stub：`build --agents` 与默认 build 产物差异仅由运行时 flag 决定，无编译期模块替换。
- docs/history 明确隔离历史文档；当前参考唯一指向 agents-runtime-v2。
- manifest 单一来源（MV3）。

**风险**：重命名是高频冲突区，建议单独一个 PR 只做重命名 + re-export。删 stub 需确认默认产物体积可接受（agent 代码进 bundle）。

**依赖**：第 1 步的产品决策（agent 是否默认开启）决定 stub 去留。

---

### 第 9 步：补集成测试（解决 P3 测试不足）

**目标**：为核心路径建立安全网，使后续重构可验证。

**范围**：`tests/`，随各步增量补充。

**具体任务**（按优先级）：
- [ ] message contract 测试（第 2 步产出）。
- [ ] ConversationCard runtime 状态机测试（第 4 步产出）。
- [ ] API bridge happy path：发送 → 流式响应 → 缓存写入 → follow-up。
- [ ] content-script lifecycle：注入 / 选中触发 / site-adapter 激活 / 清理。
- [ ] provider adapter contract 测试（第 5 步产出）。
- [ ] chatgpt-web client 纯函数（conversation-state/history-transfer/thread-state）——`chatgpt-web-state.test.mjs` 已起步，扩充。
- [ ] 目标：核心路径覆盖率达到可安全重构的水平（粗估 40%+ 关键模块）。

**验收标准**：
- 上述各路径有对应测试文件且在 CI（`.github/workflows` PR workflow）跑通。
- 覆盖率报告（`@vitest/coverage-v8` 已装）可生成，核心模块数值达标。

**风险**：无。纯增量，越早做越为前面各步兜底。建议从第 1 步起就伴随补充。

**依赖**：无；应贯穿全程。

---

## 4. 执行顺序与依赖

```
第 1 步 (对齐 release profile)   ←── 独立，立即做（含产品决策）
第 2 步 (message contract)       ←── 独立，可与第 1 步并行
         │
         ▼
第 3 步 (拆 background)  ──▶  第 4 步 (拆 ConversationCard)   [两者可并行]
         │
         ▼
第 5 步 (provider contract)  ──▶  第 7 步 (agent 协议分层)
         │
         ▼
第 6 步 (config 拆分)        ←── 独立，随时可做

第 8 步 (命名/stub/docs 收敛)  ←── 独立，低风险；stub 去留依赖第 1 步决策
第 9 步 (补测试)              ←── 贯穿全程，伴随每步增量
```

**最低成本"立即见效"组合**（若想先快速降低混乱感）：
- 第 1 步（对齐 release profile）
- 第 8 步的 bard→gemini 命名统一
- 第 6 步的 numeric clamp 表驱动抽取

三者均为低风险机械操作，能立刻消除可见的"混乱/不一致"。

---

## 5. 给实施会话的注意事项

1. **先验证再动手**：本计划基于 `ed15d1b`。接手后先跑 `git log --oneline -5` 与 `npm test` 确认基线，行号可能已漂移，按概念 + grep 定位。
2. **registry 顺序 load-bearing**：`background/providers/registry.mjs` 的顺序不得改动（`isUsing*` 谓词在边缘 model 上有重叠），`provider-registry.test.mjs` 会 pin 这个顺序。
3. **MV3 service worker 不保活**：模块级状态在 SW 重启后丢失，`services/` 根目录的 session helper 必须保持无状态或 storage-backed（见 `services/README.md`）。
4. **stub 契约**：若第 8 步前 agent 仍走 stub，任何给 real agent 模块加 export 的改动必须同步 stub，否则 `feature-flag-contract.test.mjs` 失败。
5. **每步独立成 PR**：便于 review 与回滚。第 3/4/5 步内部可再分批（如第 5 步逐家迁移 provider）。
6. **验收以测试 + 手动冒烟为准**：核心路径（ChatGPT Web 对话、API bridge、selection tool、site adapter、agent tool loop）每步后手动跑一遍。
7. **不要在治理期间加新功能**：架构治理与功能开发混在一起会放大风险。

---

## 6. 一句话总结

> 代码质量不差，差在没有稳定分层来承接持续叠加的功能。当务之急：(1) 先把 README 和构建对齐（P0 信任问题），(2) 立 message contract 和 provider contract 两个接口骨架，(3) 沿这两个骨架把 background 和 ConversationCard 拆开。做完这三件，后续每个新功能都会自然落到正确的层，而不是继续堆在 god module 里。
