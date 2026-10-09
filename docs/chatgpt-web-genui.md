# ChatGPT Web 静态可视化

实时回答、resume 和历史 GET 共用静态转换入口。扩展用 Markdown 渲染器显示生成的
HTML，网关转发同一文本，Drafts Action 2/3 把它写入 transcript。
转换不执行官网生成的 JavaScript、hooks 或事件处理器。图表只携带经过验证的数据；
扩展与 Drafts 使用项目打包的同一套 ECharts 渲染代码提供本地交互。

## 扩展入口

| 文件                                                | 职责                                                       |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `src/services/clients/chatgpt-web/genui-static.mjs` | 有界解释静态表达式，生成组件树，识别显式局部 fallback      |
| `genui-components.mjs`                              | 注册组件、允许的属性、数据校验和 HTML 输出                 |
| `genui-presentation.mjs`                            | 布局属性、HTML 转义、URL 检查及共用的动态样式白名单        |
| `genui-charts.mjs`                                  | 原生图表数据契约、版本化描述符与可读数据表               |
| `genui.mjs`                                         | 组织转换、引用和整体 Markdown fallback，保留旧的字符串接口 |
| `src/components/MarkdownRender/genui.css`           | 扩展和 Drafts 共用的样式源                                 |
| `src/components/MarkdownRender/genui-chart-runtime.mjs` | 共用图表配置转换、SVG 渲染与实例清理                   |
| `GenuiChart.jsx`                                   | 扩展图表挂载与主题更新                                   |
| `scripts/sync-drafts-preview.mjs`                   | 打包离线 HTML 模板与 Drafts Preview Action              |

新增组件时，在 `GENUI_COMPONENTS` 中声明属性和适配器。需要命名组件时，补充
`GENUI_NAMED_COMPONENTS`。关键数据属性必须验证并实际渲染，不能仅加入标签白名单。
新增动态几何属性时，同步调整共用样式校验，避免扩展清理 HTML 后丢失布局。
固定样式优先使用 CSS 类。

修改 CSS 后运行 `npm run sync-drafts-preview`；`node scripts/sync-drafts-preview.mjs --check`
检查模板是否过期。模板保持单文件，不依赖远程脚本或样式。维护
`docs/drafts/chatgptbox-preview.source.html`，不要手动修改生成的 HTML 或 `.draftsAction`。
构建内嵌按需打包的 ECharts、共用运行库和第三方许可，使用精确 CSP 哈希允许该脚本。
JavaScript 中的 Drafts 标签与 Markdown 分隔符在保留代码语义的前提下处理，避免导入
模板后脚本被模板引擎改写。

## 当前适配范围

- 文本、行内文字、对齐、保留空白、强调、引用、代码、下划线和删除线。
- box、row、col、card、badge、spacer、grid 和基本 flow，静态网格跨列/跨行。
- 表格子节点及 `columns/rows` 数据形式、表头继承、单元格合并、对齐和空表提示。
- 列表子节点及 `items` 数据形式、编号起始值、标签和描述。
- CodeBlock、WritingBlock、LinkCard，以及 Cite/Citation/Link 的静态内容。
- 已解析引用和来源卡片只激活 safe URL 集合中的 HTTP(S) 链接。

表格最多 64 列、512 行，列表和静态数组 map 最多 512 项。代码长度、解释步数、
渲染步数和嵌套深度均有上限。静态局部变量、条件表达式和模板字符串可以解释；
任意函数调用及动态执行不属于支持范围。

基础 chart/pie-chart 已支持，具体契约见下节。图片资源解析、原生 SVG 组件、地图、
表单和官网动态状态交互尚未适配。
基础组件支持也不代表官网的所有属性已支持，未声明属性会触发 fallback。

## 离线图表

- chart：bar、line、area、scatter，多个系列、堆叠、横向布局、缺失值断点及负数。
- pie-chart：一个数值系列，类别标签、饼图/环形图、占比提示。
- 数据与样式属性集中声明在 `GENUI_CHART_PROPERTIES`。坐标轴支持字符串 dataKey
  或有限对象属性（类型、标签映射、显示、范围、方向、数值格式）。其他原生坐标轴
  属性、函数 formatter、多个 y 轴和动态绑定暂不支持。
- 每图最多 512 个观察、16 个系列，描述符最多 131072 个字符；类别及标签有长度上限。
  未实现的关键属性触发明确回退，不猜测数据，也不把非数值字符串转换成数值。
- 输出包含版本为 1 的 `data-chatgptbox-chart` 描述符和默认展开的数据表。
  Markdown 清理器校验描述符，浏览器运行库再次校验，只从白名单数据创建配置。
  不转发生成的函数、事件处理器、任意 ECharts options 或外部资源 URL。
- 图表运行成功后收起数据表；失败或无 JS 时保留表格。提示、图例切换和启用的
  滚动/缩放都在本地运行，不调用 ChatGPT 或网关。显示动画关闭。
- 扩展随包发布 JS；Drafts Preview Action 内嵌 JS，通过 Drafts 自身同步。
  预览不需要网关凭据，Get/Send 仍按既有认证工作。Mac/iPad 实时预览可另用同一
  单文件模板；iPhone 使用 HTML Preview Action。
- 这是常见数据图表的适配，不保证复现官网全部外观、曲线插值或动态状态行为。

## 渲染结果与回退

`renderChatgptWebGenuiResult(message)` 返回文本和独立的渲染事实。旧的
`renderChatgptWebGenui(message)` 继续只返回字符串或 null。

- `format`：`html`、`markdown`，或无法转换时的 null。
- `status`：`rendered`、`partial`（使用显式局部 fallback）、`fallback`（整体 Markdown）或 `unavailable`。
- `fallbackReason`、`unsupportedComponents`、`unsupportedProperties`：有限的原因及名称，不包含生成代码、数据值或链接。
- `localFallbacks`、`omittedLinks`：局部回退和未激活链接的数量。

历史 GET 的 `message.rendering` 和各 `messages[].rendering`、resume 的消息摘要，以及
实时客户端最终 session 的 `chatgptWebRendering` 使用同一结果。
`isGenui` 保留其“源消息含 GenUI 元数据”的旧含义，判断是否真正生成 HTML 应看 `rendering`。
这些信息用于维护诊断，不写入 Drafts 正文。

只有组件提供了可解释的 fallback，才保留局部替代内容。缺少可靠局部替代时，
使用官网完整 Markdown fallback，避免直接丢弃未知组件导致答案缺失。

## 验证

组件契约回归在 `tests/chatgpt-web-genui-components.test.mjs`，图表与离线包回归在
`tests/chatgpt-web-genui-charts.test.mjs`；既有流、合并消息和
Drafts 恢复回归在 `chatgpt-web-genui.test.mjs`、`chatgpt-web-stream-handoff.test.mjs` 等文件。
合成示例 `tests/fixtures/genui-components.mjs` 可用于桌面、窄屏和深色预览。
真实会话及其原始元数据保留在仓库外。
