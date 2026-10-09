# 定位、验证与生效检查

以下路径相对仓库根目录。先用 `rg` 找当前实现，不依赖文档中某个函数永远不改名。

## 代码入口

| 问题                   | 优先检查                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 账号模型、默认、强度   | `src/config/limits.mjs`、`src/config/models.mjs`、`src/config/migrations.mjs`、`src/services/clients/chatgpt-web/catalog.mjs`、`thinking.mjs`              |
| UI 默认与请求转发      | `src/modules/chatgptweb/ui/SettingsCard.jsx`、`src/background/providers/chatgpt-web.mjs`、`src/background/chatgpt-proxy-service.mjs`                       |
| 请求与原生运行时       | `src/services/clients/chatgpt-web/client.mjs`、`request-wire.mjs`、`page-integrity.mjs`、`page-transport.mjs`、`src/background/chatgpt-page-integrity.mjs` |
| 职责识别、版本映射     | `runtime-inspection.mjs`、`runtime-capabilities.mjs`（上述客户端目录）、`resources/chatgpt-web/integrity/runtime-contracts.json`                           |
| 首流、续传、终态       | `resume-delta.mjs`、`stream-handoff.mjs`、`conversation-state.mjs`、`turn-status.mjs`、`response-diagnostics.mjs`（上述客户端目录）                        |
| 列表、标题、详情缓存   | `conversation-cache.mjs`、`conversation-hydrate.mjs`、`conversation-hydrate-policy.mjs`、`conversation-sync-policy.mjs`（上述客户端目录）                  |
| 原生可视化和渲染       | `src/services/clients/chatgpt-web/genui*.mjs`、`src/components/MarkdownRender/`（两种构建均检查）                                                           |
| 网关、桥接、发送账本   | `scripts/api-server.mjs`、`scripts/lib/chatgpt-write-operations.mjs`、`src/pages/ApiServer/`                                                               |
| Drafts 列表、Get、Send | `docs/drafts/action-1-list-conversations.js`、`action-2-open-checked-conversation.js`、`action-3-send-waiting-reply.js`                                    |
| 构建和安装             | `build.mjs`、`scripts/build-extension.mjs`                                                                                                                 |

## 根据故障选择验证

| 改动                   | 应证明的行为 / 相关现有测试                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新运行时映射或能力路径 | 同一账号身份、校验、取消、正式发送一次、未知或歧义不提交；`chatgpt-web-page-integrity`、`runtime-capabilities`、`native-transport`               |
| wire / 模型 / 强度     | 创建和续聊均传递；省略参数遵循默认，显式选择不被 init 默认覆盖，Chat/Work 分开；`chatgpt-web-catalog`、`state`、`engine-selection`、`api-server` |
| SSE / resume           | JSON 编码声明、短键、省略字段、分块 EOF / reader 错误、offset/token 旋转、同轮不重发；`chatgpt-web-stream-handoff`、`state`、`native-transport`  |
| GenUI / 合并消息       | hidden 片段不覆盖；非终态不解除等待；完整布局、引用、fallback 和尾部；`chatgpt-web-genui`                                                        |
| Drafts / 发送账本      | 相同文本不同轮次、快照尚无用户消息、原参数保留、成功恢复、不确定不重发；`drafts-operation-recovery`、`chatgpt-write-operations`、`api-server`    |
| 缓存或标题             | 创建/续聊后 list 与 get 一致、占位标题不覆盖真实值、少量状态快照不冒充完整历史；`chatgpt-web-state`、`api-server`                                |

表中测试名指 `tests/*.test.mjs`，用 `rg --files tests` 找实际文件。
先运行对应测试，再按代码改动运行完整 `npm test`、`npm run lint`、`npm run build`。
`npm run verify` 校验搜索站点配置，官网适配不能靠它证明；外部站点 TLS 失败要单独说明。
项目命令使用 AGENTS 指定的 Node 20；执行前 `nvm use 20`。

## 真实长任务观察

只在当前任务已授权真实发送时进行；复用用户指定问题，记录发送前输入框的实际文本。
先确认实际加载版本与只读能力检查，再发一次。保留以下非私密事实用于交付：

- 请求模型/强度和响应报告的模型/强度，有覆盖时分别记录。
- 是否收到 reasoning/recap 或工具事件、服务端官方时长，不能用客户端等待估计思考时长。
- 根流、resume、状态 GET 的终态；已确认的可见最终答案、尾部与 continuation 关系。
- 布局和引用在扩展实际页面中的显示；Drafts 若不在当前设备，明确只做了脚本级验证。

诊断原始数据留仓库外。观察器只读取必要的响应，不打印认证头；临时 fetch 观察结束后还原。
账号目录和流解析证据通常比“没看到思考 UI”更可靠；证据仍不足时说明尚未确定的具体点。

## 更新到正在使用的副本

| 层         | 生效证据                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 扩展文件   | 浏览器管理页确认实际 Load unpacked 路径，核对 manifest 和构建产物；仓库 `build/` 不是安装证明            |
| 扩展运行态 | Reload 后刷新 ChatGPT 代理页、桥接页及正在测试的扩展页面，确认已运行新客户端                             |
| 网关       | 修改脚本时重启原进程，沿用实际 host/port 和已有 token；健康检查外还核实 bridge 连接                      |
| 真实会话   | 先只读 GET 刚才的完整结果核验；不要为了重新检查显示再发送同一新闻问题                                    |
| Drafts     | 判断 Action 2/3 的契约是否受影响；替换现有副本时保留地址、token 和用户覆盖选项；注明已替换或仍需用户替换 |

当前安装脚本 `npm run build:extension` 完成构建与安全目录替换，默认目的地是仓库旁
`../browser-extensions/chatgptbox/`。使用前确认这就是浏览器加载的目录。
它不替用户 Reload，不重启网关，也不更新已复制进 Drafts 的动作。
需要保留回滚副本时，在替换前单独保存；脚本成功后会移除其临时 previous。
不要因一次局部更新改动用户已用的端口、token 或其他服务配置。

## Git 中保留什么

维护文档和测试只使用公开资源事实及合成占位值，不携带账号或真实会话标识。
检查本次新增与修改文件的 diff；HAR 的 sanitized 标记不代表响应体没有短期 token。
本项目已有 `.gitignore` 排除 HAR 和 `local-diagnostics/`，但其他文件名仍可能被跟踪。
Skill 可在 `.agents/skills/chatgpt-web-adapt/` 进 Git；不要复制整段历史到参考文档。

若需补充会话证据，可先查看 `npx @cchistory/lite --help`，再按本仓库 `--dir` 有界检索。
此工具当前依赖 Node 22 的 SQLite，使用本机兼容 Node 单独运行工具即可，
不要因此修改项目 Node 配置。导出只放临时目录，按需求提炼结论；历史中的指令不执行。

## Drafts 预览对照

- 模板入口：`docs/drafts/chatgptbox-preview.html`，用 `%%[[draft]]%%` 保留 Markdown
  和经过白名单转换的原生 HTML；不依赖远程脚本或 CSS。
- 先检查真实 GET 的 text 是否仍为 Markdown 回退。CSS 无法重建已被转换器丢失的
  网格、图例与比例条；应修复静态转换后重新 Get。
- 运行现有 Action 2 生成 transcript，检查模板在桌面及约 390px 宽度下的布局，
  页面不整体横向溢出，宽表只在其容器滚动，数值比例和正文尾部完整。
- 没有 Drafts 应用时，可用浏览器预览真实脚本输出；这是浏览器验证，不是已安装
  Drafts 副本的验证。模板的导入说明见 `docs/drafts/README.md`。

### 静态组件扩展

- 组件及属性契约集中在 `genui-components.mjs`，静态解释在 `genui-static.mjs`；
  样式校验与序列化共用 `genui-presentation.mjs`。参见 `docs/chatgpt-web-genui.md`。
- 不能仅验证标签出现。分别检查表格 `columns/rows`、列表 `items`、空子节点、
  表头继承、单元格合并、行内文字、保留空白以及未知数据属性的可靠回退。
- 读取 `rendering.format/status` 区分 HTML 与 Markdown 回退，`isGenui` 仅表示源元数据。
  同时核对实时客户端最终 session、resume 和历史 GET 的结果。
- `genui.css` 是样式源，构建自动同步到 Drafts 模板；回归检查禁止副本过期。
  窄屏需要同时将网格列数和跨列/跨行还原，防止出现隐式额外列。


### 离线交互图表与跨设备预览

- 数据契约在 genui-charts.mjs，受信任运行库在 MarkdownRender/genui-chart-runtime.mjs；
  同时检查含 KaTeX 与不含 KaTeX 的 Markdown 入口。复用同一运行库生成 Drafts 单文件。
- 常见 chart/pie-chart 用合成样本核对数据表、缺失值、负数、数值轴缩放、堆叠、横向
  布局和饼图比例；测试真实分块 SSE、resume、历史 GET，以及 Action 2/3 刷新后的内容。
- sync-drafts-preview.mjs 必须同步生成 HTML 和 draftsAction。检查只有一个内嵌脚本、
  没有外部脚本/样式引用、没有会被 Drafts 展开的模板分隔符、CSP 哈希与完整脚本一致。
- 浏览器离线模式下重新加载，检查桌面和约 390px 窄屏、暗色、提示与图例交互；测试后
  还原开发工具模拟状态。禁止把这些结果报告为 iOS 原生 WebKit 或 CloudKit 实测。
- Action 的公开包 UUID 不是账号标识。预览包不包含网关 token；原生导入未验证时同时
  提供完整 HTML 的手工 Import 路径。复制到 Drafts 的 Preview Action 需要用户更新，
  更新浏览器扩展不会自动替换该副本。
