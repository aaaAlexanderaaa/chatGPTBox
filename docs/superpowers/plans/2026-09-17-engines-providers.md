# Engines = custom providers + 上游洞修复

> **状态：** 已落地在 `feat/engines-providers`（2026-09-17）。Grok 3–8 仍是站位；`ApiModes.jsx` 已从 Engines 拿掉但仍留死文件。
> **日期：** 2026-09-17
> **来源：** 上游 200+ commit 学习 → 可行性评估 → 用户逐条拍板 → Settings/Provider 产品改写
> **对话：** [上游学习与引擎改写](ebad1ced-8dd6-40ac-8f07-9436a71bb3cc)
> **产品约束：** 不合并上游树；不搬 `proxy-generation-state`；社区 fork 不上商店；Chromium 优先。

本文是执行清单。压缩上下文之后 **以本文为准**，不要凭记忆把 `chatgptApi5_4`、硬编码目录、旧厂商卡、debug 脱敏再捡回来。

---

## 0. 用户原话（不得再解释歪）

1. 输入、站点、右键 Side Panel：**去修**。
2. `getChatGptAccessToken` / cookies：Safari 没 API 会炸；只用 Chrome 内核，**问题不大，不做**。
3. 流式（SSE parser + Stop）：**可以修**。
4. GPT-5.4 / 5.5 / GPT-5 latest / 官方 GPT-5：**已退役或马上退役。不为它们做 streaming / token / matcher 改造。退役模型直接不支持，不浪费时间。**
5. Claude temperature：**修**（发出去 clamp 0–1）。
6. 死代码 FETCH / `fetch-bg.mjs`、危险 leftover `store-publish.yml`：**修掉**。
7. Node 升级：**同意**（20 → 22）。
8. Debug 脱敏：**不做**。本地开关，不外发，上游没有这套；不要当 must-fix。
9. 引擎设置：不要一排 API provider 卡。L1 是 **custom provider + custom model**；厂商只是预填模板。
10. 特殊格式只有：**GPT Completions、Anthropic、Ollama**（其余按 OpenAI 兼容）。
11. Kimi 网页版：**关掉**。L2 = ChatGPT Web + Grok（未成熟）。L3 = DeepSeek Harness。
12. Custom 默认模型原先要从 `gpt-4.1` 改成 `deepseek-v4.1-flash`；后来默认 L1 是 TokenDance，这条变成 TokenDance 预启用模型。
13. 只有 L2 / L3 需要 **滑动确认启用**；L2 / L3 有自己的选项面；ChatGPT 的 history 等必须折叠进该引擎，不要散。
14. L1 用 **加号自己加**，加一条出现在 `+` 上面。默认只有一条 L1：TokenDance.space。
15. 顺序：L1 → L2 ChatGPT / Grok → L3 Harness。
16. API Bridge 留在 Advanced（马上会给 Grok 用）；ChatGPT Web 和 Grok Web 选项面要能跳过去。
17. URL 只收到 **`/v1`**，不要逼用户写死 `/chat/completions`。配好 URL + Key 后 **GET `{v1}/models` 拉模型**；失败就告诉用户自己填。鼓励手填。TokenDance / ChatGPT 用它们自己的方式 fetch，**禁止硬编码模型目录当产品表面**。
18. **不兼容**旧的「每家单独 URL+model = 一个 provider」配置。对话/设置仍可导出，provider 请重新配，否则不要升级。不要背迁移债。
19. 工具必须落到模型：provider 下面 **启用的模型** 变成可选组合，例如 `tokendance/deepseek-v4.1-flash`。

默认列表（用户画的）：

```
TokenDance
  - deepseek-v4.1-flash
  - somemodel
+ Provider
ChatGPT Web          ← 滑开才启用
Grok Web             ← 滑开才启用
DeepSeek Harness     ← 滑开才启用
```

---

## 1. 本文填充的默认（用户没逐字说；做错会偏产品）

若要改，先改本节再动手，不要在代码里临时发明。

| 项 | 默认 |
|---|---|
| ChatGPT Web 新装 | **默认开**（零配置 L2）。Grok / Harness **默认关**。控件是滑动确认，不是再藏一层 checkbox。 |
| 新装「当前引擎」 | **ChatGPT Web**（没 Key 也能用）。TokenDance 是最上的 L1 行，不是当前引擎。 |
| L2 / L3 配置家 | **左侧 Settings 独立选项卡**（2026-09-17 与用户确认，推翻「Engines 内钻取」）。见 §4。 |
| L1 行 | 点开就地展开凭据 + 模型列表（字段少，不要子页）。 |
| Azure | 加号里的第四种格式，不当成厂商卡。 |
| 工具 | **不**给每个划词工具单独加模型下拉。工具继续用「当前引擎 / 站点覆盖」；那些下拉的选项变成 `providerId/modelId`。 |
| OpenRouter 归因头 | **不做**（「应该做但是小」，用户拍板时没点头）。 |
| cookies guard | **不做**。 |
| 扩展 version | **不擅自 bump**。 |
| 旧会话 `modelName` | 当废标签展示；新消息必须选当前启用的组合。不写 `chatgptApi5_4` → 某默认的迁移表。 |
| ChatGPT Web 本地 history / 会话缓存 | **保留**。切断的只是旧 API provider 配置。 |
| 未成熟 Grok | **不实现** history 同步 / 探针等后端。选项卡必须有与 ChatGPT **同一套块的站位**，文案「尚未启用」，不要做成只有登录的矮卡。 |

---

## 2. 禁止（做着做着最容易记错）

- 不为 GPT-5.4 / 5.5 / GPT-5 latest / 官方 GPT-5 写 streaming、`max_completion_tokens` helper、matcher 例外、Responses `max_output_tokens` 共用 helper。
- 不把 `models.mjs` 的厂商目录（`chatgptApi*`、`deepseek_*`、OpenRouter、AIML、ChatGLM、Moonshot API、旧 Web 预设）继续当选择器数据源。退役模型直接不出现。
- 不迁移 `enabledProviders` 厂商开关、`customApiModes` 目录、`apiKey` / `customModelApiUrl` / `deepSeekApiKey` 等分槽到新结构。
- 不做 debug `requestBodyRawJson` 脱敏。
- 不做温度 opt-in checkbox；不解冻 API Modes；不加回 GET_COOKIE。
- 不整文件替换 SSE parser；不搬上游 `proxy-generation-state.mjs`。
- 不给 FETCH 写「只允许 http(s)」假硬化——是 **删掉** 这条 IPC。
- 不做 `useConfig` cancelled、Brave 超时改 5000ms、SHA pin Actions、`pretty:check`、coverage badge。
- 不合上游、不改 ChatGPT Web / Grok / DSH **会话协议**（本计划只改模型从哪来、设置住哪、以及列出的 bug）。
- 不把 API Bridge 搬出 Advanced（ChatGPT / Grok 选项卡只放跳转）。
- 不把 Kimi Web 留在引擎列表。
- 不要在实现中途又加回「ChatGPT API / DeepSeek / OpenRouter」独立 provider 卡。

---

## 3. 新数据与路由

### 3.1 可选单位

全产品选择器（默认引擎、对话切换、站点覆盖、划词所用引擎）只认：

```
{providerId}/{modelId}
```

例：`tokendance/deepseek-v4.1-flash`、`chatgptweb/gpt-5-6-thinking`。

没有启用模型的 L1 provider **不能**出现在这些选择器里。

### 3.2 `l1Providers`（名字可在实现时定，语义不许变）

```js
{
  id: 'tokendance',          // 稳定 id；预设用固定 id，用户自建用 uuid
  name: 'TokenDance',
  format: 'openai-compat',   // openai-compat | anthropic | ollama | completions | azure
  preset: 'tokendance',      // 或 null
  baseUrl: 'https://tokendance.space/gateway/v1',
  apiKey: '',
  models: [
    { id: 'deepseek-v4.1-flash', enabled: true, source: 'manual' | 'fetched' }
  ]
}
```

- 存储 **`/v1` base**，请求 chat 时拼 `{base}/chat/completions`（已有 `normalizeCustomChatCompletionsUrl`）。
- Fetch：`GET {base}/models`，`Authorization: Bearer`，读 `data[].id`。已有 `src/services/model-lists.mjs` 的 `fetchV1Models` / `deriveV1BaseUrlFromEndpoint`，**接到 UI**，不要再写一套。
- 失败文案：这个端点没有标准模型列表，请自己填。**禁止**失败后回落硬编码名单。
- Anthropic / Ollama / Completions：各走自己的 list 或手填；失败同样手填。
- 新装预置一条 TokenDance，预启用 `deepseek-v4.1-flash`。Key 空。Keys 链接：`https://tokendance.space/keys`。

L2 / L3 不是 `l1Providers` 里的行：它们是固定产品引擎，带 enable 滑条。ChatGPT / Grok 的启用模型来自 **它们自己的 catalog fetch**（ChatGPT：已有 `GET /models` + `GET /tpp/models/`；Grok：已有 probe），用户勾选子集。最多保留「目录里若存在则优先」的 slug（现 `gpt-5-6-thinking`），那不是目录。

### 3.3 升级切断

- 加 schema 标记（如 `providerSchemaVersion: 2`）。旧配置 **不读入** 厂商 provider 字段。
- 升上来的引擎列表 = TokenDance + ChatGPT Web + Grok + Harness。
- Engines 页一句说明：旧的 API provider 配置不会读入，请重新添加；导出在 Advanced。
- **保留：** 外观、行为、工具 prompt、站点开关、ChatGPT Web 本地会话/history 缓存。
- **丢弃不迁移：** `enabledProviders` 当厂商清单、`activeApiModes`/`customApiModes` 当目录、各家 `*ApiKey`、`customModel*` 单槽、`chatgptApi5_4` 这类 key。

### 3.4 后台路由

L1 只走：`custom-api`（openai-compat）、`claude-api`、`ollama-api`、`gpt-completion-api`（+ azure 若选了该格式）。

L2/L3：现有 `chatgpt-web`、`grok-web`、`dsh-bridge`。

从 `PROVIDERS` **注销**（文件可删，避免死债）：`chatgpt-api`、`deepseek-api`、`openrouter`、`aiml`、`chatglm`、`moonshot-api`、`moonshot-web`。Kimi Web 不再 match。

`Models` / `ModelGroups` / `DefaultEnabledProviderGroups` / `DefaultActiveModelKeysByGroup` 不再充当 L1 选择器。选择器从 `l1Providers` + L2/L3 启用模型组装。

---

## 4. 设置放哪（2026-09-17 已确认，勿再改成 Engines 内钻取）

职责拆开：

| 表面 | 管什么 |
|---|---|
| **Engines** | L1 provider 树 + `+ Provider`；L2/L3 **一行 + 滑动启用**；L2/L3 行链到对应选项卡。不在这里堆 History / Debug。 |
| **左侧「ChatGPT Web」** | 该引擎全部配置。新装默认启用 → 此项默认就在导航里。 |
| **左侧「Grok Web」** | 与 ChatGPT **同一套块**。滑动启用后才出现在导航。未做的功能留站位，不留空页、不省略块。 |
| **左侧「DeepSeek Harness」** | L3 自己的选项卡（滑动启用后出现）：endpoint、诊断、打开 `dsh.html`。不复制 cockpit。 |
| **Advanced** | API Bridge 本体 + 导入导出重置。 |

左侧顺序：`General → Appearance → Engines →（已启用的 ChatGPT Web / Grok Web / DeepSeek Harness）→ Behavior → Tools → Sites → Advanced`。

深链：`options.html?tab=chatgptweb` / `grokweb` / `dsh`。Engines 行上「打开设置」切到对应 tab。未启用引擎没有左侧项；从深链进来应回到 Engines 并提示先滑动启用。

### 4.1 Engines 列表（只到这一层）

```
TokenDance
  - deepseek-v4.1-flash
  - somemodel
+ Provider
ChatGPT Web          [slide]   → 打开 ChatGPT Web 选项卡
Grok Web             [slide]   → 打开 Grok Web 选项卡
DeepSeek Harness     [slide]   → 打开 DeepSeek Harness 选项卡
```

L1 的启用模型挂在 provider 下（选择器数据源）。L2 的启用模型挂在 **该引擎选项卡的「模型」块**，不在 Engines 列表下再长一截。

### 4.2 ChatGPT Web / Grok Web 选项卡：同一套目录

块顺序固定。ChatGPT 用现有实现填满；Grok 同样出块，没有后端的写「尚未启用」，**禁止**因此删块。不要提前造一堆 `grokWebHistorySync*` storage 空字段，站位是 UI。

| # | 块 | ChatGPT Web（搬进来，现在散在 Engines 模块卡 / Probe） | Grok Web |
|---|---|---|---|
| 1 | 账号与登录 | 账号可用模型由 catalog 刷新；登录态来自现有代理/cookie | 现有：打开 grok.com、档位、已登录模型列表 |
| 2 | 模型 | Fetch `GET /models` + `/tpp/models/`，勾选启用 → `chatgptweb/<slug>` | Fetch/probe 现有目录，勾选启用 → `grokweb/<slug>` |
| 3 | 官网历史 | `disableWebModeHistory`（是否留在 chatgpt.com 列表） | **站位**：v1 对话会留在 grok.com，暂不可关 |
| 4 | History 同步 | 现有整块：开关、自动同步、RPM、归档、idle、full sync、hydrate、失败列表、导入导出 | **站位**：本地列表同步尚未启用（规格 v1 明确不做；占位是为以后对称） |
| 5 | 请求与轮询 | poll interval / result timeout；**把现在没有 UI 的 `chatgptWebThinkingEffort` 放到这里** | **站位**：轮询 / thinking 尚未暴露 |
| 6 | Endpoint | `customChatGptWebApiUrl` / Path | **站位**：自定义 grok.com 基址尚未启用 |
| 7 | Debug | 现有 Debug Viewer（本地，不外发） | **站位**：Grok 请求调试尚未启用 |
| 8 | 协议探针 | 从 Engines 根上挪来的 `ProtocolProbeSection` | **站位**：Grok 协议探针尚未接入 |
| 9 | API Bridge | 跳转 `?tab=advanced#api-server-bridge` | 同样跳转（Bridge 已有 `/grok/conversations*`） |

块在选项卡内可再折叠。History 默认可收起。

**不要留在 ChatGPT 选项卡之外：** 现在挂在 `EnginesTab` 根上的 `ChatgptWebSettingsCard`、`ProtocolProbeSection`。Grok 的矮 `SettingsCard` 整卡并进 Grok 选项卡第 1 块，Engines 上不再重复渲染。

### 4.3 API Bridge

仍在 Advanced。文案改为网页引擎本地端点，不要只写 ChatGPT。ChatGPT-only 项（如 keep history in ChatGPT）标明仅 ChatGPT。

### 4.4 拿掉

Engines 上的 Model Directory / `ApiModes` 矩阵。厂商十三张卡。Kimi Web。

---

## 5. 任务清单

做完一项勾一项。**A 与 B 不要混在一个「顺便」里忘记。** A 不依赖新 provider，可先合；B 是破坏性产品改写。

### A. 上游洞 / 卫生（用户已点头）

- [x] **A1 IME InputBox**  
  `src/components/InputBox/index.jsx`：macOS `isComposing`（及必要的 `keyCode === 229`）时 Enter 不发送、不 Stop。Windows 229 现有路径已挡。点按钮 `click` 仍发送。抽小纯函数 + vitest。

- [x] **A2 IME DSH 队列编辑**  
  `src/modules/dsh/ui/Composer.jsx` 队列项裸 Enter（约 195 行）：同样忽略 composing。Cmd+Enter 发送不要动。

- [x] **A3 focusAfterAnswer 空 ref**  
  同一 InputBox：`getUserConfig().then` 之后 `inputRef.current?.focus()`。不要做 `useConfig` cancelled。

- [x] **A4 GitHub pathname**  
  `src/content-script/site-adapters/github/index.mjs`：`isPull` / `isIssue` 用 pathname，不要 `href` 带 `?`/`#` 时当成 commit patch。不要匹配 `/files`。

- [x] **A5 limitedFetch 4xx**  
  只在 `status ∈ [200, 300)` resolve。GitLab raw / GitHub patch 错误页不再当正文。

- [x] **A6 Bilibili null 字幕**  
  `src/content-script/site-adapters/bilibili/index.jsx`：`content == null` 不拼进 prompt。

- [x] **A7 DDG insertAtTop**  
  `src/content-script/site-adapters/duckduckgo/index.mjs`：等待节点（不要 5ms 就放弃），找到后 `return true`，让后面的 `mountComponent` 重试还能跑。**不要**把 Brave 超时改成 5000ms。

- [x] **A8 Side Panel 手势**  
  `src/background/menus.mjs`：`onClickMenu` 里 `tabs.query().then` 丢掉用户手势。Open Side Panel 必须在手势栈里同步调 `chrome.sidePanel.open`（用 click 带来的 `tab`，不要先 await query）。快捷键路径不是这个问题。

- [x] **A9 SSE parser**  
  `src/utils/eventsource-parser.mjs`：增量 `TextDecoder`、CRLF、`position + startingPosition`。**保留**本地 `feed(Uint8Array)` 和 `meta`/`extra`（ChatGPT Web WS 按字节喂）。不要整文件换成上游。**先写测试再改**。影响：ChatGPT Web websocket + 所有 `fetchSSE`。Grok / DSH / Bridge 不用这份 parser。

- [x] **A10 Stop**  
  不要搬 `proxy-generation-state.mjs`。  
  1. `src/services/wrappers.mjs` `registerPortListener`：每条 port 一个 `runId`；无 session 的 `{stop:true}` 立刻 `{done:true}` 并作废当前 run；带 session 的新请求（含 retry）bump id；过期 `answer`/`done`/`error` 不再 post 到 UI。  
  2. ChatGPT Web / Grok：pending 表 **一创建** 就监听 UI stop，不要等 `*-proxy-response:*`。  
  3. Grok abort 不要画成 error（画成 done）。

- [x] **A11 Claude 温度**  
  `src/services/apis/claude-api.mjs`：请求里 clamp 到 0–1。滑条仍 0–2。**不要**做温度 checkbox。

- [x] **A12 删 FETCH**  
  删 `RuntimeMessage.Fetch`、`src/utils/fetch-bg.mjs`、`handleFetchMessage` 接线。保留 `fetch-proxy-service.mjs` 里 API Bridge 仍用的 `isExtensionPageSender`（或挪走再删死代码）。改 message-contract 测试。

- [x] **A13 关商店发布**  
  删除或 disable `.github/workflows/store-publish.yml`。

- [x] **A14 Node 22**  
  `pr-tests.yml`、`pre-release-build.yml`、`tagged-release.yml`、`verify-configs.yml`：`node-version: 22`。`pr-tests` 加 `permissions: contents: read` + checkout `persist-credentials: false`。`package.json` 补 `engines`。README 若写死 20 一并改。不要 SHA pin 官方 Actions，不要 `pretty:check`。

**A 组来源（不是「上游有个感觉」）：** 每条都对过 `upstream/master` 的 commit **和** 我们树上仍在的洞。实现时读我们的文件，不要合他们的树、不要搬 `proxy-generation-state.mjs`。

| 任务 | 上游来源 | 我们树上的洞 | 关系 |
|---|---|---|---|
| A1 IME | `3f2b748` / `162ca0f` Keep IME… (#1038)：`shouldHandleInputAction`，`isComposing` 或 `keyCode===229` 则不发/不停 | `InputBox` 仍 `keyCode===13` 就 submit/stop | **同类洞**。评估收窄：Windows 229 我们已经要求 13，真洞在 macOS `isComposing`。可抽同样的纯函数，不要照搬他们的测试路径。 |
| A2 DSH Enter | 无（上游没有 DSH） | `Composer.jsx` 队列编辑裸 Enter | **把 A1 的同一条规则套到我们的产品上** |
| A3 空 ref | 启发自 `aebf799` Ignore stale config after unmount (#1079) | `focusAfterAnswer` 的 `getUserConfig().then(() => inputRef.current.focus())` | **不是照抄**。他们修 unmount setState；我们评估后只修空 ref。`useConfig` cancelled **不做**。 |
| A4 GitHub | `c74af9a` Recognize GitHub thread URL variants (#1039) + `4bbfcec` (#1046) | `isPull`/`isIssue` 用 `location.href` 锚定 `$`，query/hash 时假阴性，HEAD `.patch` 仍 200 → 当 commit 摘要 | **同类洞**。他们抽了 `path-matching.mjs`；我们改 pathname 即可，不要匹配 `/files`。 |
| A5 limitedFetch | `8862bd4` Reject HTTP error pages…：XHR 4xx 走 `onload` | `src/utils/limited-fetch.mjs` 的 `onload` 无 status 检查，与上游修之前同一文件 | **几乎是同一补丁** |
| A6 Bilibili | `1fd07ff` filter out null subtitle content | `bilibili/index.mjs` 仍拼接 `subtitles[i].content` | **几乎是同一补丁** |
| A7 DDG | `fc6944a` Wait longer for search result containers (#1016) + 更早的 `5929a18` | `duckduckgo/index.mjs` `waitForElement…(..., 5)` 且失败 `return false` | **同类洞，不能照抄超时数字**。评估：要对齐 Brave「等到了 return true」，Brave 自己不必先改 5000ms。 |
| A8 Side Panel | `f3fed11` open side panel synchronously (#963) 修 #857 | `menus.mjs` `onClickMenu` 先 `tabs.query().then` 再 `sidePanel.open` | **同类洞**。快捷键路径评估过不是这个问题。 |
| A9 SSE | `adaab98` (#1036) 跨 chunk；`5911812` (#1068) 增量 decode；`df0bc7e` (#1069) reset metadata | vendored `eventsource-parser.mjs` 仍是旧行为；ChatGPT Web WS 还依赖本地 `feed(Uint8Array)`/`meta` | **同类洞，禁止整文件替换**。先写测试再改。 |
| A10 Stop | `745fdf5` Fix UI stuck on Stop (#995)：`_sessionRequestGeneration`，stop 先 ack | `registerPortListener` `if (!session) return` 丢掉 `{stop:true}`；ChatGPT/Grok pending 要等 response port | **问题同源，做法不能照搬**。他们加了 `proxy-generation-state.mjs` 和 Bing/Claude-web。我们用 port `runId` + pending 一创建就监听。 |
| A11 Claude 温度 | 不是上游这条。上游 `6ffbc14` 是温度 **opt-in checkbox**（我们明确不做） | `claude-api.mjs` 把 0–2 滑条原样发给 Anthropic（只要 0–1） | **我们自己对照 Anthropic 文档** |
| A12 删 FETCH | 不是「抄上游补丁」。上游仍有 FETCH；有人提过协议校验 | Bing 删后 `fetch-bg.mjs` **零调用**，`RuntimeMessage.Fetch` 仍是特权 IPC | **我们自己的死代码结论**（评估否决了「只允许 http(s)」假硬化） |
| A13 store-publish | 当前 `upstream/master` workflows **已无** 此文件 | 我们还留着 tag 后可能打 CWS 的 workflow | **我们仓库的 leftover**，不是上游最新树里的补丁 |
| A14 Node 22 | `edebfa2` Upgrade Node.js requirement from v20 to v22 | 我们 CI 仍是 20 | **同类卫生**。`persist-credentials: false` 是评估加的，不是该 commit 的主体。 |
| （不做）cookies | `413f3dd` guard `Browser.cookies` (#965) | Chrome 有 cookies API | 你已否决额外兼容 |


### B. Provider / Settings 改写（用户已点头）

- [x] **B1 schema + 新装默认**  
  `l1Providers` 默认 TokenDance；`providerSchemaVersion`；旧厂商字段忽略；升级提示文案。

- [x] **B2 路由**  
  L1 → custom / claude / ollama / completions（+ azure）。注销厂商 API 与 moonshot-web。会话 `modelName` 改为 `providerId/modelId`（或等价结构，选择器显示必须是这种组合）。

- [x] **B3 Fetch models**  
  接上 `model-lists.mjs`。URL = `/v1`。失败手填。ChatGPT Web / Grok 用现有 catalog/probe，不写死目录。

- [x] **B4 Engines 列表 UI**  
  按 §4.1：L1 树 + `+ Provider` + L2/L3 滑条和「打开设置」。去掉 `ENGINE_CARDS` 十三张平铺、根上的 ApiModes、模块卡、Protocol Probe。

- [x] **B5 左侧 L2/L3 选项卡**  
  `SettingsCenter.jsx` 按启用动态加入 `chatgptweb` / `grokweb` / `dsh`。ChatGPT：把 `ChatgptWebSettingsCard` + thinking effort + Protocol Probe 按 §4.2 九块排好。Grok：同一九块，1–2 用现有登录/模型，3–8 站位，9 跳转。Harness：endpoint / 诊断 / 打开 cockpit。未启用无左侧项。

- [x] **B6 API Bridge 跳转**  
  Advanced 锚点 + ChatGPT / Grok 选项卡第 9 块。文案不再写「仅 ChatGPT」。

- [x] **B7 选择器**  
  `engine-options.mjs`、`ConversationCard`、`QuickSettingsTab`、`FeaturesTab` 站点覆盖：只列出启用的 `providerId/modelId`。去掉 `customModel` 幽灵项和厂商目录展开。

- [x] **B8 砍硬编码目录**  
  `models.mjs` 不再导出给选择器用的 `chatgptApi5_4` 等。ChatGPT Web 内部 key（`chatgptWeb56Thinking`）能收成就收成 slug；不要为退役模型留 picker。删/改依赖这些 key 的测试，**不要**写迁移把它们救活。

- [x] **B9 文档**  
  `docs/product/definition.md`：L2 例子改为 ChatGPT Web + Grok，去掉 Moonshot Web；「明确不承诺」里与 D-23 打架的「不完整替代 DSH Web」改成已替代客户端、不替代本机进程；产品名用 DeepSeek Harness，不用驾驶舱。README：改掉 popup=General/Sites/Advanced、全页=General/Features/Modules；补 Grok（未成熟）和 DSH；不要再把十三家 API 写成产品故事。

- [x] **B10 预设加号**  
  TokenDance / 常见 OpenAI 兼容 URL 只作为加号表单预填，不在主列表占行。

- [x] **B11 文案债（本改写顺手）**  
  默认引擎下拉不要再标 `API Mode`。CAPTCHA 错误不要再走 `Bing CaptchaChallenge`（`wrappers.mjs` + locale）。`ApiModes.jsx` 里残留的 `chatgptWeb51Thinking` 默认项随目录一起删。

### C. 配置默认值 / Sites / 中英（2026-09-17 已同意）

- [x] **C1 L1 生成默认值（DeepSeek-V4.1-Flash）**  
  `maxResponseTokenLength` 默认 **384000**；`MAX_RESPONSE_TOKEN_LENGTH_LIMIT` 与 `NUMERIC_FIELDS` 上限 **256000 → 384000**。`maxConversationContextLength` 默认 **9 → 64**。Temperature 默认仍 **1**。Behavior 文案写明三项 **仅 L1 API**；当前引擎为 L2/L3 时提示网页引擎忽略。ChatGPT Web / Grok **仍然不读**这三项。  
  Claude：`max_tokens` 发送时按 Anthropic 可接受上限再 clamp，**禁止**把 384k 原样丢给 Messages API（温度 0–1 仍是 A11）。

- [x] **C2 cropText 解耦**  
  `crop-text.mjs` 裁剪预算 **不再减去** `maxResponseTokenLength`。开关保持默认开。不换 tokenizer。

- [x] **C3 Sites 全部可关**  
  `site-adapters/index.mjs` 里有、但 `siteAdapters` / Sites UI 没有的：bing, yahoo, duckduckgo, startpage, baidu, kagi, yandex, naver, brave, searx, ecosia, neeva, presearch。全部列入 `siteAdapters` + `SITE_DISPLAY_NAMES` + 默认 `activeSiteAdapters`（现网继续注入，但 **必须能关**）。修 Kagi「UI 有、关不掉」。新站点名进 en/zh-hans。

- [x] **C4 设置中心 + L2 选项卡 i18n**  
  约 110 条 `t('英文当 key')` 补进 `en/main.json` 与 `zh-hans/main.json`（General / Appearance / Engines / Behavior / Tools / Sites / Advanced / ChatGPT / Grok 选项卡）。没有「只有中文没有英文」的设置项要补英文。

- [x] **C5 DSH 全页 + ApiServer i18n**  
  `dsh.html` 设置页、SessionHeader（Allow once / Reject / auto-approve 等）、`ApiServer.html` 现写死英文 → `t()` + en/zh-hans。不译外观色名/代码主题名（另开）。


---

## 6. 文件地图（防漏改）

**A：**  
`InputBox/index.jsx` · `dsh/ui/Composer.jsx` · `site-adapters/github` · `gitlab`（吃 limitedFetch）· `utils` limitedFetch · `bilibili` · `duckduckgo` · `background/menus.mjs` · `eventsource-parser.mjs` · `fetch-sse.mjs`（若测）· `wrappers.mjs` · ChatGPT/Grok proxy pending 监听 · `grok-proxy-handlers` abort 文案 · `claude-api.mjs` · `protocol/messages.mjs` · `fetch-bg.mjs` · `fetch-proxy-service.mjs` / `message-router.mjs` · `store-publish.yml` · CI yml · `package.json`

**C：**  
`limits.mjs` · `numeric-config.mjs` · `storage.mjs` · `BehaviorTab.jsx` · `claude-api.mjs`（max_tokens clamp）· `crop-text.mjs` · `FeaturesTab.jsx` · `site-adapters` 名单 · `en/main.json` · `zh-hans/main.json` · DSH `SettingsPage.jsx` / `SchemaForm.jsx` / `PresetRoster.jsx` / `SessionHeader.jsx` / `Conversation.jsx` · `pages/ApiServer/App.jsx`

---

## 7. 验证（做完不能只看截图）

- [ ] macOS IME 选词 Enter 不发、不 Stop；点发送按钮仍发。
- [ ] GitHub issue URL 带 query 时是 issue 摘要不是 commit patch。
- [ ] DDG 顶部插入最终能挂上。
- [ ] 右键 Open Side Panel 能打开。
- [ ] 生成中立刻 Stop：UI 离开 Generating；ChatGPT/Grok 开代理 tab 期间 Stop 不再把请求打出去；Grok abort 不是红错误。
- [ ] Claude temperature=2 请求体是 1。
- [ ] 新装 Engines 只有 TokenDance + 三个 L2/L3 行；没有 DeepSeek/OpenRouter/Kimi 卡。
- [ ] TokenDance 手填 / fetch 模型；启用后选择器出现 `tokendance/<id>`。
- [ ] ChatGPT Web 模型来自账号 fetch，列表里没有 5.4 API 那种硬编码项。
- [ ] 旧配置升级后厂商 key 不出现；导出仍可用；ChatGPT history 缓存还在。
- [ ] 新装左侧有 ChatGPT Web 选项卡，九块都在；Grok 滑动启用后左侧出现，3–8 块是「尚未启用」站位不是空页。
- [ ] ChatGPT / Grok 选项卡能跳到 Advanced Bridge；Bridge 不出现在这两张选项卡里当本体。
- [ ] `RuntimeMessage.Fetch` 不存在；`store-publish.yml` 不在；CI Node 22。
- [ ] Behavior：新装 Token 384000、Context 64；ChatGPT Web 对话长度不变。Claude 请求 max_tokens 不是 384000。
- [ ] 升 Token 后 GitHub/Bilibili 摘要不会被裁没（crop 已解耦）。
- [ ] Sites 能关掉 DuckDuckGo / Bing / Brave / Kagi。
- [ ] 简体设置中心、DSH 全页、ApiServer 页不再大面积英文回退。

---

## 8. 刻意不在本计划里的东西

- 把 Grok 的 History 同步 / 探针 **做出来**（本计划只留 UI 站位）。
- 多 agent harness。
- 把 Bridge 做成 ChatGPT 私产。
- 兼容 Safari cookies。
- 商店发布流水线。
- 为官方 GPT-5 系列调 token 字段。
- OpenRouter HTTP-Referer 归因头。

---

## 9. 承诺审计（2026-09-17，[承诺功能](f3d84366-2d06-44d7-be80-ca84e6dece54)）

对照 definition / decisions / README vs 现树。配置默认值和中英翻译由另一路评估，本节省略。

**已经和这次 Engines 改写对齐、不要漏：**

- 现 IA 不是「引擎/集成/指令」，是 7 个左侧 tab + Engines 填埋场。这次用左侧 ChatGPT/Grok/Harness 选项卡 + Engines 只留列表，就是在还这笔债。
- `chatgptWebThinkingEffort` 有配置、无设置控件 → 已写入 §4.2 第 5 块。
- Protocol Probe、ChatGPT Debug 是维护者表面，进 ChatGPT 选项卡，不要留在 Engines 根上。
- 划词在 Tools、藏右键在 General、工具贴输入框在 Behavior：本次不重排这三处，除非配置评估认为要搬。

**文档已过时（B9 必须改，不要只改 definition 一行 L2）：**

- L2 仍写 Moonshot Web；代码默认关，已决定关掉。
- 「扩展不完整替代 DSH Web」已被 D-23 和 `dsh.html` 推翻。
- 驾驶舱作为产品名已被 D-23 禁止；测试已禁用户文案，注释还在用。
- README 仍是旧 popup 分栏，不提 DSH/Grok，把十三家 API 当卖点。
- Grok spec 头还写「待实现」，代码已在。
- `roadmap.md` A–D 标完成，DSH 窄侧栏、popup 里答提问、设置可寻性并未达标。

**现树缺口，默认不进本次 A/B（另拍板）：**

| 项 | 现状 | 建议 |
|---|---|---|
| 站点开关清单 ≠ 适配器 | DuckDuckGo/Bing/Baidu/Brave 等会注入，Sites 的 `SITE_DISPLAY_NAMES` 没有，关不掉 | **本次做**（C3） |
| DSH `side_panel` | manifest 默认 IndependentPanel；没有任何调用把 path 设成 `dsh.html` | 不做三宽度客户端补完 |
| DSH popup 提问 | 只能 Dismiss / 打开 DSH，不能在 popup 里答 | 不做 |
| 通知点进审批 | 新开 `dsh.html` 再点，超过「≤2 次操作」 | 不做 |
| 首启 60s | 默认手动触发；未登录错误仍推 API key | 不做测量 |
| 全局系统提示词 | definition 有「指令」，设置里没有 | 不做 |
| 工具级换引擎 / 站点级 agent | 没有 | 不做 |
| DSH 全页 / Bridge 页大量英文写死 | SessionHeader `Allow once` 等；ApiServer Enable | **本次译**（§10 已同意） |

**不要对外再承诺：** 60s 首答已测量、90% 不用设置、陌生人一次能找到任意设置、Grok 有 ChatGPT 同级 history、DSH 三宽度同一客户端、用户永远不用 `:3080` 却能用 L3。

---

## 10. 配置与中英（2026-09-17，[配置与中英](b23942cf-640e-4466-938f-a9641aa0df49)）

核对过：`maxResponseTokenLength` / `maxConversationContextLength` / `temperature` 只进 OpenAI 兼容、Azure、Claude、Ollama 等 **L1 API**。ChatGPT Web / Grok / Moonshot Web **不读**这三项。`chatgptWebThinkingEffort` 默认 `'max'`，设置里没有控件（已在 §4.2）。

`crop-text.mjs`：默认预算 8000；再减去 `clamp(maxResponseTokenLength, …)`。C2 **必须**解开，否则 C1 的 384k 会把页面摘要裁没。

### 已同意纳入本次（2026-09-17）

官方 DeepSeek-V4.1-Flash（`deepseek-flash`）：**context 1M，max output 384K**（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)）。采样建议 temperature 1.0。

Token / Context / Temperature **只发给 L1 API**。ChatGPT Web / Grok Web **请求体里没有它们**。

| 项 | 决定 |
|---|---|
| Max Response Tokens | 默认 **384000**；上限 **384000**。仅 L1。Claude 发送再 clamp。 |
| cropText | 保持开；预算不再减 Max Token。 |
| Context Length | 默认 **64** 轮（Q&A 对，不是 1M token）。仅 L1。 |
| Temperature | 默认 **1**。仅 L1；Claude 0–1。 |
| thinking effort | 默认 `max`；ChatGPT 选项卡加控件。 |
| i18n | 设置中心 + L2 选项卡 + **DSH 全页** + **ApiServer.html** → en + zh-hans。 |
| Sites | 全部适配器进列表且能关；默认仍注入（与现网一致）。 |
| 不要删 | History 同步、`disableWebModeHistory` 默认 true、crop/siteRegex、runtime token、Bridge、Grok 登录态、DSH endpoint。 |

### 本次不做

- 外观色名 / 代码主题名硬编码英文。
- 把 Temperature / Token 搬进每个 L1 provider 卡片。
- 重写 gpt-3-encoder 裁剪。

