# Grok Web 引擎（v1）

> 状态：已定稿（待实现）
> 日期：2026-08-17
> 分支：`feat/grok2api-integration`
> 参考：[chenyme/grok2api](https://github.com/chenyme/grok2api) 的 Grok Web 协议事实；本仓库 ChatGPT Web 的代理页模型

## 一句话

复用用户在 **grok.com** 已登录的浏览器会话，做成一张 **L2 文字引擎**，并在 API Bridge 上暴露同一套模型和 conversation 面。不运行 grok2api 进程。

## 账号安全优先（对标 ChatGPT Web）

**功能可以坏，用户的真实账号不能坏。** 浮窗没答出来、Bridge 报错、代理页挂了，都比把 grok.com 会话打成 429、并发打爆、或把同一句 prompt 自动重打一遍更可接受。

和 ChatGPT Web 同一条线：

- **写请求 at-most-once。** `POST /rest/app-chat/conversations/new`（以及跟帖的写）一旦发出去，超时、断连、代理页死、Bridge 没收到回执，都**不准自动再打一遍**。对用户报错（Bridge 用 `ambiguous_dispatch` / `retryable: false`）。重试是人的决定，不是客户端的循环。
- **429 / 配额 / 反爬 = 停。** 原文抛出，不换模型，不隔一秒再试，不并行补打。同 session 本就串行；全局也不准为“多开几个代理页加快”而打。
- **探针只读。** 登录/档位只用 GET（`/api/auth/session`、`/rest/rate-limits`）。探针失败就当没登录或只开 fast，**绝不**为了“再确认一下”去 POST。
- **不为探测开标签、不后台刷。** v1 没有历史同步，也就没有 ChatGPT 那种 429 锁；同时也不准发明轮询、预热对话、保活 POST。
- **读和写分开。** list/get/refresh 是读，失败可再读。写过之后的“不确定”只能报不确定，不能当成没写再写一次。

实现时如果“让功能更稳”和“可能多打一次 grok.com”打架，选前者停、选后者报错。

## 已决范围

| 项 | 决定 |
| --- | --- |
| 形态 | Grok Web 会话引擎（对标 ChatGPT Web），不是本地 grok2api 网关 |
| 能力 | 只做文字对话。不出图、不出视频 |
| 站点 | 只认 `https://grok.com`。不认 x.com / i/grok |
| 可见性 | 检测到 grok.com 已登录才出现在引擎选择器 |
| 传输 | 专用 grok.com 代理页（方案 A） |
| grok.com 历史 | 接受对话落在 grok.com（1a） |
| 429 / 配额 | 只报错，不自动降档、不自动重试（2a） |
| 账号 | 功能可坏，真实 grok.com 账号不可坏（对标 ChatGPT Web 写路径） |
| API Bridge | `grok-chat-*` 映射 + `/grok/conversations*` |

## 明确不做（v1）

- 不嵌入、不启动、不依赖 grok2api Go 服务
- 不接 Grok Build / Grok Console
- 不接 x.com
- 不抄 ChatGPT 的 Arkose、WS resume、conduit、历史同步缓存、`force_sync`（没有同步，也就不抄那把 429 锁；**写路径的 at-most-once 和 429 即停要抄**）
- 不把 grok.com 原生对话推进扩展自己的会话列表（D-4 / D-13）
- 不在扩展里执行工具
- 不默认改用户当前引擎（登录后只是出现在列表里）
- API Bridge 默认模型仍是 ChatGPT 的 `gpt-5-6-thinking`
- 自动化测试不准碰真实浏览器、真实 cookie、真实 grok.com 账号（见「测试」）

## 架构

运行时留在 core。设置只盖模块屋顶（对标 `modules/chatgptweb/`）。

四块：

1. **登录探针** — 判断 grok.com SSO 是否有效，写入档位和可用模型。
2. **代理页** — 专用 `https://grok.com/?chatgptbox_proxy=1`。对话和 conversation 控制请求只从这页的 content script 发出。
3. **Web 客户端** — 在代理页里读 session、打 `/rest/app-chat/*`、把 SSE 折成现有 port 协议。
4. **Provider** — `{ route: 'grok-web', match, run }`：会话锁、确保代理页、把 UI / Bridge port 接到代理页。登记在 `registry.mjs`，紧挨 ChatGPT Web。

```
浮窗 / 划词 / API Bridge
  → background grok-web provider
  → grok.com 代理页 content script
  → POST /rest/app-chat/conversations/new（或 list/get）
  → SSE / JSON 折回 port
```

协议事实跟 grok2api Web catalog，不抄它的 egress / FlareSolverr / 多账号池。扩展的优势是真浏览器上下文（cookie、Cloudflare、页面里的 Statsig）。

### 文件（预期）

| 路径 | 职责 |
| --- | --- |
| `src/background/providers/grok-web.mjs` | `{ route, match, run }` |
| `src/background/grok-proxy-service.mjs` | 代理页生命周期、会话锁、请求转发 |
| `src/utils/grok-proxy-tab.mjs` | `isLikelyGrokTabUrl` / `isDedicatedGrokProxyTabUrl` |
| `src/services/clients/grok-web/` | 协议客户端（session、chat、conversation、stream） |
| `src/services/apis/grok-web.mjs` | 薄适配，转调 client |
| `src/config/models.mjs` 等 | `grokWebModelKeys`、Models、predicate |
| `src/config/storage.mjs` | `grokWebSignedIn`、`grokWebAccountModels`、`grokWebAccountTier` |
| `src/modules/grokweb/` | 设置卡屋顶 |
| `src/pages/ApiServer/App.jsx` | slug 分流 + grok control actions |
| `scripts/api-server.mjs` | `/grok/conversations*`、`/v1/models` 追加 slug |
| `src/protocol/messages.mjs` | Grok 代理 / 控制消息 |

Content script 已对所有 https 注入，只加 Grok 代理消息处理。`cookies` 和 `<all_urls>` 已有，不新开权限模型。

## 模型

组名：`grokWebModelKeys`。公开 slug 与 grok2api Web catalog 一致。

| 引擎 key | slug（`Models[key].value`） | 最低档 |
| --- | --- | --- |
| `grokWebFast` | `grok-chat-fast` | Basic |
| `grokWebAuto` | `grok-chat-auto` | Super |
| `grokWebExpert` | `grok-chat-expert` | Super |
| `grokWebHeavy` | `grok-chat-heavy` | Heavy |

高档继承低档：Heavy 能用全部四个；Super 能用 fast/auto/expert；Basic 只能 fast。

**账号默认（用户第一次选 Grok，或 Bridge 省略 model）：**

- Basic → `grok-chat-fast`
- Super → `grok-chat-expert`
- Super Heavy（Heavy）→ `grok-chat-heavy`

`grok-chat-auto` 始终可选（档位够的话），不当 Super 的默认。

## 登录与可见性

**已登录** = `GET https://grok.com/api/auth/session` 成功，且 `status` 不是 `unauthenticated` / `blocked`，且能读到 `userId` 或 `email`。解析规则对齐 grok2api `sessionidentity.Parse`。Token 来自浏览器 cookie，不粘贴、不长期存 JWT。

探针顺序：

1. `cookies.getAll({ url: 'https://grok.com/' })` 没有会话 cookie → 未登录。
2. 在 grok.com 页（已有标签或即将打开的代理页）请求 `/api/auth/session`。
3. 通过后再探档位（grok2api 用 `/rest/rate-limits` 映射 Basic / Super / Heavy）。档位失败 → 只开放 `grok-chat-fast`。

写入：

- `grokWebSignedIn`: boolean
- `grokWebAccountTier`: `'basic' | 'super' | 'heavy' | ''`
- `grokWebAccountModels`: 可用 slug 数组；未知目录用 `[]`，选择器按「目录未知则只显示 fast」处理，避免把 Super/Heavy 亮给 Basic

触发：service worker 启动、grok.com cookie 变化、grok.com 标签 `complete`。不轮询。

**什么时候开代理页：** 启动探针**不准**为了探测就新开标签。

- 没有 grok.com 会话 cookie → 未登录。
- 已有 grok.com 标签 → 在那页打 `/api/auth/session`（和档位）。
- 有 cookie、没有 grok.com 标签 → `grokWebSignedIn` 先乐观为 true，选择器出现；第一次真正对话时再开代理页做硬确认。硬确认失败则清掉并报登录错误。

**选择器：** `grokWebSignedIn !== true` 时不进 `buildEngineOptions`。例外：当前正在用的 Grok 项不藏。不把 `enabledProviders.grokWebModelKeys` 当作这张引擎的主开关。

**设置卡：** 一直在 Engines 里。未登录：矮卡 +「打开 grok.com 登录」。已登录：档位 + 可用模型。打开的是普通 `https://grok.com/`，不是代理页。

**登出：** 不改 `modelName` / `apiMode`。下一次发送报「请先登录 grok.com」。

## 对话流（浮窗 / 划词）

与 ChatGPT Web 同构：

1. UI `runtime.connect()` → `executeApi` → `grok-web` provider。
2. 同 session 串行（会话锁）。
3. `ensureGrokProxyTab()`；失败则报登录/代理页错误。
4. content script 取 session，`POST /rest/app-chat/conversations/new`。这一下是写：发出去之后禁止自动重放。
5. SSE 折成 `{ answer, done, session }`。`session` 必须带上 grok2api Web 续聊用的两个 id：`conversationId` 和 `previousResponseID`（上游若用别的字段名，在 client 里译成这两个）。流中途断了：把已收到的文本留下并报错，不拿同一句再 POST 一次。
6. `pushRecord` 写本地 `conversationRecords`。`saveGrokWebSessionSnapshot` 只服务扩展自己发起的线程。

续聊：已有 `conversationId` 时跟到同一 grok.com 对话。新浮窗/新 session 开新对话。

v1 接受这些对话出现在 grok.com 历史里。扩展会话列表只收扩展发起的绑定，不导入用户在 grok.com 里自己开的对话。

流里若有 reasoning / thinking，按 ChatGPT Web 的方式附在答案旁展示；没有就不编。

## 错误

| 情况 | 行为 |
| --- | --- |
| 未登录 / session 无效 | 明确提示去 grok.com 登录；探针把 `grokWebSignedIn` 清掉 |
| 代理页起不来 | 说明需要专用 grok.com 代理页（对标 ChatGPT Web 的 Brave 文案） |
| Cloudflare / Statsig / 反爬 | 提示刷新或重开代理页；把上游状态码/原文带到浮窗；**不**自动重打写请求 |
| 429 / 配额用尽 | 原文抛出，**不**换模型、**不**隔秒重试、**不**换代理页再打 |
| 写已发出后超时 / 断连 | 报不确定（功能坏了）；**不**当失败重发 |
| 选了账号没有的档 | 发送前拦下，或把上游拒绝原文抛出；不静默改档 |

停止按钮走现有 abort controller；断开代理 port 即停。停止不得再补发一条“取消用”的写（除非 grok.com 有单独的、明确是取消的接口；v1 没有就只断流）。

## API Bridge

### 模型映射

`POST /v1/chat/completions` 的 `model`：

1. 精确匹配四个 `grok-chat-*` → Grok Web session，`executeApi` 走 `grok-web`。
2. 否则保持今天的 ChatGPT `slugToModelKey`（未知 slug 仍回落到 `gpt-5-6-thinking`）。

Grok 请求不套 ChatGPT 的 thinking 续聊、`chatgptWebModelSlugOverride`、`chatgptWebHistoryDisabledOverride`。

`GET /v1/models`：ChatGPT 列表照旧；`grokWebSignedIn` 时追加该账号能用的 `grok-chat-*`。未登录不加。Node 侧 fallback `AVAILABLE_MODELS` 也列入这四个 slug，仅在 bridge 连着但列表拉取失败时用。

默认 `model` 仍是 `gpt-5-6-thinking`。要 Grok 必须显式传 slug。

### `/grok/conversations*`

与 `/chatgpt/conversations*` 动词对齐，前缀分开。`/chatgpt/*` 一行不改。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/grok/conversations` | 经代理页现场 `GET /rest/app-chat/conversations` |
| `GET` | `/grok/conversations/:id` | 经代理页 `GET /rest/app-chat/conversations/:id/response-node?includeThreads=true`（若 grok.com / grok2api 已换路径，跟现行 Web adapter，只换这一处） |
| `POST` | `/grok/conversations` | 新开对话，尽快返回 `conversationId` |
| `POST` | `/grok/conversations/:id/messages` | 跟一条 |
| `POST` | `/grok/conversations/:id/refresh` | 再 get 一次快照 |

写操作必须带 `Idempotency-Key`（接受 `X-Idempotency-Key`），账本与 ChatGPT 写路径同一套 at-most-once 语义，key 空间用路径前缀分开，避免和 `/chatgpt/*` 撞。

`model` 用 `grok-chat-*` 表；省略则用账号默认档。

响应尽量同构：`conversationId`、`title`、`query`、`messages`、`pending`、`defaultModel`。Grok 没有的字段（`thinking`、`asyncStatus`、`resume`、conduit）省略，不编造。

v1 不做本地 history-sync 缓存，没有 `force_sync`，没有 429 锁。`refresh` 不是 ChatGPT resume。

Bridge 页 control action 与 `RuntimeMessage` 成对新增（`grok_web_list_conversations` 等），经代理页执行，不在 service worker 里直连 grok.com。

## 测试

**硬约束：自动化测试不得接触真实账号。** 写坏一条测试就可能对 grok.com 打出 429 或突发并发，把登录态打残。这比漏测更糟。

禁止（`vitest` / CI / 任何默认会跑的脚本）：

- 访问正在使用的浏览器配置（真实 cookie、真实 grok.com 标签、真实扩展存储里的 SSO）
- 对 `https://grok.com`（及其 API 主机）发真实网络请求
- 打开、复用、或驱动用户已经登录的 grok.com 页
- 用用户的 SSO / `sso` cookie 当夹具
- 并发打真实上游，或在测试里“顺便试一下真会话”

允许：注入的假 `cookies`、假 `fetch`、假代理页、内存里的假 session JSON、录好的 SSE 文本。覆盖：

- 探针：无 cookie、unauthenticated、有效 session、档位失败只开 fast
- 选择器：未登录隐藏；已登录按档过滤；当前选中不藏
- 默认模型：Basic/Super/Heavy 三档
- 客户端：SSE → port；带 `conversationId` 续聊
- 写已发出后断连 / 超时：假 fetch 只见到一次 POST
- 429 / 未登录错误原文，不降档、不重试（429 也是假响应）
- Bridge：`grok-chat-expert` 分到 Grok 而不是 ChatGPT 默认；未知 slug 仍回落 ChatGPT；`/grok/conversations` 路由与 Idempotency-Key；Grok 和 ChatGPT conversation 路径互不干扰

没有 `GROK_WEB_LIVE=1` 这类显式开关，就不存在“打真 grok.com”的测试入口。v1 不写这条 live 测试。

## 验收

下面 1–6 是**人在自己的浏览器里、自己点**的终验，不是自动化、不是 agent 代开你的 grok.com。实现过程中默认不跑它们。第 7 条才是每次提交要绿的自动化。

1. 浏览器已登录 grok.com：引擎列表出现 Grok，档位对，默认 Expert 或 Heavy 符合上表。
2. 未登录：选择器没有 Grok；设置卡能点去 grok.com。
3. 任意页面划词/浮窗能流式文字回答，同一扩展会话能续聊；grok.com 上能看到对应对话。
4. 登出后再发：明确登录错误，不改用户默认引擎。
5. `curl` `POST /v1/chat/completions` 且 `model=grok-chat-expert` 走 Grok；省略 model 仍走 ChatGPT。
6. `GET/POST /grok/conversations*` 能列、开、跟、再拉；`/chatgpt/conversations*` 行为不变。
7. 现有测试（含 ChatGPT Web / API Bridge）全绿，且没有一条测试打到真 grok.com。
