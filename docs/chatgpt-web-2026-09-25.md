# 2026-09-25 ChatGPT 新前端兼容

本次依据官网正常发送的数据流和页面实际加载的公开 JS 核对。新前端使用 Rspack 模块，网络请求标识为 `codex_webview`。旧版的两个运行时仍保留，插件根据代理页已经加载的 JS 选择对应实现。

## 主要差异

| 项目       | 原有两版                                                        | 2026-09-25 新版                                                                        |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 页面模块   | `4813494d-…` 的 ESM 导出                                        | `633146.03cad12214.js` 导出的原生 `__webpack_require__`                                |
| 发送方式   | 页面生成原生校验结果，内容脚本发送 HTTP 请求                    | 页面原生网络模块处理身份、登录恢复、请求头和 HTTP 请求，内容脚本接收响应字节           |
| 校验       | 原生 `finalize` 和同一 requirements 对应的 proof/Turnstile 缓存 | 原生完整性模块处理 prepare/challenge，再用原生 Request finalize；正式提交前完成        |
| 会话初始化 | 原发送路径不变                                                  | 发送前调用 `/backend-api/conversation/init`，携带实际会话、选定模型和时区              |
| 预热请求   | `client_prepare_state: none`，无 messages                       | `client_prepare_state: sent`，带 `partial_query`，无完整 messages                      |
| 隐私字段   | `history_and_training_disabled`                                 | `is_do_not_remember`，包括明确的 `false`                                               |
| 首轮父消息 | `client-created-root`                                           | 不发送该占位值；续聊保留真实 parent_message_id                                         |
| 用户消息   | 原有网页 metadata                                               | 新格式的 author、channel、status、recipient 等字段                                     |
| 页面上下文 | 原有页面尺寸等                                                  | `app_surface: codex_browser` 和实际推送能力/权限                                       |
| 返回流     | 兼容旧事件和 v1 delta                                           | 继续使用 v1 delta，保留断流后按 offset 续接                                            |
| 最新会话页 | 单数 `/conversation/:id` 的 mapping                             | 复数 `/conversations/:id?num_turns=10&include_has_versions=true` 的 messages/page_info |

新版仍使用 `/backend-api/f/conversation` 发送。旧配置若指向官方单数发送接口，新版会选择当前页面对应的 `/f/conversation`，旧页面沿用旧配置。

新会话页的 messages 是当前分支的有序列表。适配器转成已有解析器使用的 mapping，并保留 page_info。最新十轮只用于当前生成的状态读取；完整历史读取继续使用官网源码仍保留的单数完整会话接口，不能把十轮快照缓存成完整历史。

## 初始化是否影响发送

实际观察到三类初始化，作用不同：

- `/api/auth/session`：登录身份和会话。新版网络模块使用页面的原生登录状态，在需要时执行自己的令牌刷新和完整性状态恢复。扩展不复制这套恢复算法。
- `/backend-api/bootstrap`：页面启动配置，抓包响应包含 `statsig_user`。页面会自行完成这一步，扩展复用运行中的模块。
- `/backend-api/conversation/init`：按会话、模型、时区读取默认模型、模型限制、禁用功能和横幅信息。抓包及调用处没有显示它向正式请求提供 Sentinel 或 conduit token。此次为新版补上该调用，但不会用返回的默认模型替换用户明确选择的模型。

因此，初始化会影响页面使用的状态，但没有证据证明缺少某一次 init 就必然触发“零秒思考”。本次改动同时对齐原生身份处理、校验流程和请求格式，不把增加一个 init 当作修复全部问题的依据。

`generate_autocompletions`、统计请求及下一轮 Sentinel 预取可以与当前对话交错发生。扩展不通过伪造输入活动或统计事件来模拟人工操作。

## 实现和边界

入口是 `src/services/clients/chatgpt-web/client.mjs`。内容脚本通过现有后台处理器请求向同一个 ChatGPT 顶层文档注入 `page-integrity.mjs`；后台校验扩展 sender、来源和 documentId。新版分支只加载页面已加载的、清单明确匹配的原生运行时。

`page-transport.mjs` 将页面的状态码、允许的响应头和流字节转成标准 Response，供现有 SSE 解析器消费。身份及 Sentinel 凭据留在 MAIN。桥接使用独立通道，限制目的地址、方法和接口，并在结束、取消或页面离开时清理。正式 POST 不自动重试，每个通道仅允许一次；后续恢复只能请求已有会话的 resume。停止生成也使用新页面的原生网络模块和 stop_conversation 格式。

`runtime-contracts.json` 明确绑定运行时文件与模块 ID。未知版本、混合版本、身份切换或校验未完成时停止提交，不尝试给未知版本套用旧的混淆导出名。

`page-integrity.mjs` 被 executeScript 序列化到 MAIN，必须保持闭包自包含。构建已有的 Babel 排除规则需保留。

## 验证记录

已通过扩展网关验证新会话和同会话续聊。此处仅保留验证结论，不保留真实会话内容、标识、请求时间或响应统计：

- 新会话和续聊均成功返回完整答案，读回会话为完成状态。
- 核对了 init、conversation/prepare、Sentinel prepare、Sentinel finalize、conversation 的调用，确认使用新版原生网络模块。
- 验证了正式问题不重复提交，以及会话关联、思考设置、隐私字段和流编码的正确传递。
- 最终回归为 84 个测试文件、946 项测试通过；lint 和生产构建通过。三个受支持版本的生产注入函数均在独立 VM 中验证闭包可序列化。
- `npm run verify` 的 Yahoo 搜索配置检查因外部 TLS 连接失败未完成；这项检查不涉及 ChatGPT 请求代码。

这证明当前观测版本的发送和续聊可工作。服务端如何判定异常请求没有公开的可验证标志，不能据此保证所有后续请求都不会受服务端策略影响。

HAR 仅留在仓库外的本机临时目录。即使 DevTools 标注 sanitized，响应体仍可能含短期校验令牌，因此 Git 忽略所有 HAR 文件和 local-diagnostics 目录。仓库只保留官网公开版本清单和人工构造的测试占位值。

## 2026-09-30 运行时更新

代理页实际加载的运行时更新为 `633146.36cd53e1c6.js`。沿网页自身的 `k29.Request -> NI -> JW -> Pl` 调用关系核对，原生浏览器发送函数已移到 `Wk.c`；原有 `xb` 模块现在处理公告，不能沿用其导出名。

`k29.Request`、`OS` 和 `n9O` 的所需接口仍可用。`Wk.c` 保留 URL、请求选项、请求变换回调、身份检查回调及请求/流类型参数，并继续处理 `expectedIdentity` 与 `retry: never`。此次只增加该运行时对应的准确模块映射，旧版映射和未知版本拒绝机制均保留。

对比旧版公开脚本 `434385.a7f2495691.js` 中的 `xb.c` 与新版 `385910.c123c59539.js` 中的 `Wk.c`，新版增加第六个可选回调：认证恢复后可重新生成请求头和请求体，再检查当前身份并重发。扩展传入 `retry: never`，在进入该恢复重发分支前返回，因此无需提供新回调。

`runtime not supported` 表示扩展拒绝使用尚未核对或无法明确识别的运行时，不等于已证明网页接口无法兼容。当前匹配要求资源文件名完全一致，且只找到一个已知运行时；模块未就绪、模块 ID 不存在或所需导出不是函数时也会拒绝。此策略为 fail closed，单纯的构建哈希变化也需要更新映射；函数类型检查本身不能判断职责是否变化。

已通过 43 项运行时和原生传输相关测试、lint 与生产构建，并更新本机扩展。经本地网关发送一次自然问题，新会话成功返回完整答案，本地轮次状态为 `completed`。
