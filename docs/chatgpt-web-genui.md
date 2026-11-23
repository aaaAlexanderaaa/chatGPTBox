---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-11-23
---

> The 2026-10-22 review classified this existing interface document and
> checked its source ownership. It did not repeat live-account validation
> of every protocol claim. Verification remains partial.

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
| `genui-native-chart.mjs`                            | 客户端 recharts-json 格式到共用描述符的有界转换          |
| `genui-client-widgets.mjs`                          | 客户端引用的静态视图与可读源内容回退                     |
| `genui.mjs`                                         | 组织转换、引用和整体 Markdown fallback，保留旧的字符串接口 |
| `src/components/MarkdownRender/genui.css`           | 扩展和 Drafts 共用的样式源                                 |
| `src/components/MarkdownRender/genui-chart-runtime.mjs` | 共用图表配置转换、SVG 渲染与实例清理                   |
| `GenuiChart.jsx`                                   | 扩展图表挂载与主题更新                                   |
| `scripts/sync-drafts-preview.mjs`                   | 打包离线 HTML 模板与 Drafts Preview Action              |

新增组件时，在 `GENUI_COMPONENTS` 中声明属性和适配器。需要命名组件时，补充
`GENUI_NAMED_COMPONENTS`。关键数据属性必须验证并实际渲染，不能仅加入标签白名单。
新增动态几何属性时，同步调整共用样式校验，避免扩展清理 HTML 后丢失布局。
固定样式优先使用 CSS 类。

修改 CSS 或预览脚本后运行 `npm run sync-drafts-preview`；`node scripts/sync-drafts-preview.mjs --check`
检查模板是否过期。模板保持单文件，不依赖远程脚本、样式或字体。维护
`scripts/drafts/chatgptbox-preview.source.html`、`src/components/MarkdownRender/drafts-math-runtime.mjs`、
`drafts-code-diagrams.mjs` 与 `drafts-preview-runtime.mjs`，不要手动修改生成的 HTML 或 `.draftsAction`。
构建内嵌按需打包的 ECharts、KaTeX（离线 MathML 输出，`trust: false`，不嵌入外部字体）、Mermaid、DOMPurify、共用运行库和第三方许可，使用精确 CSP 哈希允许该脚本。
JavaScript 中的 Drafts 标签与 Markdown 分隔符在保留代码语义的前提下处理，避免导入
模板后脚本被模板引擎改写。

## Drafts 数学公式

用户于 2026-11-23 报告循环隐状态公式在 HTML Preview 中保留了公式源码。
预览同时识别 `\[...\]`、`\(...\)` 和 Markdown 转义形式
`\\[...\\]`、`\\(...\\)`。原始 HTML 中的文字会保留双反斜杠，普通
MultiMarkdown 数学节点则使用单反斜杠；这两种输入都由数学运行库渲染成离线 MathML。
起止分隔符的反斜杠数量须匹配。处理只剥离外层分隔符，保留公式内部的
LaTeX 命令、`\_` 字符转义和矩阵 `\\` 换行语义。

显式 `span.math`、`div.math` 和数学代码块沿用同一外层分隔符规则。
普通代码保留源码，残缺或混用分隔符的正文保留原文；现有货币保护、
`trust: false` 和渲染数量/长度上限继续由数学运行库执行。

## Drafts 代码块图形

用户于 2026-11-17 要求在 Drafts HTML Preview 中渲染 SVG、Mermaid 围栏代码。
预览识别 `svg`、`mermaid`，兼容 Markdown 输出中代码或 pre 上的裸语言名、
`language-` 和 `lang-` 类名。维护入口为
`src/components/MarkdownRender/drafts-code-diagrams.mjs`，由 Drafts 运行库调用。
这条路径处理笔记中已有的代码块，保留网关与 Get/Send 的原文传递语义。

图形显示在可展开的源码上方；宽图在自身区域横向滚动，保留文字大小。
图片加载成功后收起源码。单个图形格式错误、加载失败
或超过限制时显示原因并展开原文，其余图形继续处理；停用 JavaScript 时保留原代码块。
每页最多处理 64 个图形，单个 SVG 最多 131072 字符，Mermaid 最多 50000 字符、
500 条边。主题切换顺序重绘，过期结果丢弃，临时测量节点与旧视图随生命周期清理。

Mermaid 及其图类型内嵌在唯一离线脚本中，采用固定的 strict、纯 SVG 标签、主题和
资源上限，源代码中的配置声明由 secure 配置隔离。SVG 先校验并通过 DOMPurify
清理，图形以 data URL 图片显示，CSS 与 ID 在各自图形内作用。页面正文颜色与字体
补入图片，支持 `currentColor` 与 viewBox 比例，保留作者显式字体和颜色。
`use` 可引用当前图形已有的 `#id`；外部引用和含 foreignObject 的图形显示源码回退，
保留完整内容。脚本、事件和动画内容清理；图片上下文隔离图形脚本与外部资源。
图形中的链接按静态图形呈现。运行库加载时即关闭 Mermaid 自动启动，保留 Markdown
解析器输出的原始代码，由同一顺序渲染入口管理图形。
唯一脚本继续使用精确 CSP 哈希；预览资源随模板离线提供。

## 当前适配范围

- 文本、行内文字、对齐、保留空白、强调、引用、代码、下划线和删除线。
- box、row、col、card、badge、spacer、grid 和基本 flow，静态网格跨列/跨行。
- 表格子节点及 `columns/rows` 数据形式、表头继承、单元格合并、对齐和空表提示。
- 列表子节点及 `items` 数据形式、编号起始值、标签和描述。
- CodeBlock、WritingBlock、LinkCard，以及 Cite/Citation/Link 的静态内容。
- 客户端组件通过 `model_dil_v2.clientDefinedWidgets[invocationId].refIndex` 对应
  同一消息的 `metadata.content_references`，不把引用数组过滤后重新编号。
  已解析的代码、`charts_widget_v2` / `recharts-json` 图表、写作和翻译内容转成静态
  组件；地图保留地点、坐标和路线文字，应用及动态学习内容保留可读源内容并说明
  交互限制。不执行组件逻辑、不加载地图瓦片、应用脚本、音频或远程图片。
- Cite/Citation 接受单个 `ref` 或多个 `refs`；来源仍从 `__resolutionId` 对应的
  已解析结果读取，引用属性本身不能激活未经允许的链接。
- 已解析引用和来源卡片只激活 safe URL 集合中的 HTTP(S) 链接。

表格最多 64 列、512 行，列表和静态数组 map 最多 512 项。代码长度、解释步数、
渲染步数和嵌套深度均有上限。静态局部变量、条件表达式和模板字符串可以解释；
严格相等比较及与 null 的相等检查可用于选择静态分支。任意函数调用及动态执行不属于支持范围。

基础 chart/pie-chart 和客户端图表使用同一离线运行库，具体契约见下节。
图片资源解析、原生 SVG 组件、交互地图、表单和官网动态状态交互不属于静态适配。
基础组件支持也不代表官网的所有属性已支持，未声明属性会触发 fallback。

## 离线图表

- chart：bar、line、area、scatter，多个系列、堆叠、横向布局、缺失值断点及负数。
- pie-chart：一个数值系列，类别标签、饼图/环形图、占比提示。
- 客户端图表接受对象或 JSON 字符串形式的 `content`，转换 `chartType`、
  `xKey/nameKey/valueKey`、`series`、`axes` 与 `meta`。省略键时遵循已观察的官网
  首行字段选择规则；数值本身不做字符串转数值。标题、说明、页脚和完整数据表保留。
- 折线区间带支持固定上下界或逐行上下界字段；缺失观察留空，倒置区间拒绝绘制。
  每个维度一个坐标轴，可指定名称、范围和刻度标签；多个同维坐标轴仍使用可读回退。
- 数据与样式属性集中声明在 `GENUI_CHART_PROPERTIES`。坐标轴支持字符串 dataKey
  或有限对象属性（类型、名称、刻度、标签映射、显示、范围、方向、数值格式）。其他原生坐标轴
  属性、函数 formatter、多个 y 轴和动态绑定暂不支持。
- 每图最多 512 个观察、16 个系列，描述符最多 131072 个字符；类别及标签有长度上限。
  未实现的关键属性触发明确回退，不猜测数据，也不把非数值字符串转换成数值。
- 输出包含版本为 1 的 `data-chatgptbox-chart` 描述符和默认展开的数据表。
  数据表始终保留数值的原始精度；图例和提示使用的 compact/integer 格式不改变源数据表。
  Markdown 清理器校验描述符，浏览器运行库再次校验，只从白名单数据创建配置。
  不转发生成的函数、事件处理器、任意 ECharts options 或外部资源 URL。
- 图表运行成功后收起数据表；失败或无 JS 时保留表格。提示、图例切换和启用的
  滚动/缩放都在本地运行，不调用 ChatGPT 或网关。显示动画关闭。
- 扩展随包发布 JS；Drafts Preview Action 内嵌 JS，通过 Drafts 自身同步。
  预览不需要网关凭据，Get/Send 仍按既有认证工作。Mac/iPad 实时预览可另用同一
  单文件模板；iPhone 使用 HTML Preview Action。
- 这是常见数据图表的适配，不保证复现官网全部外观、曲线插值或动态状态行为。
  Tooltip 的标题与标记开关生效；monotoneX/Y 保留平滑方向，natural 曲线仍使用
  ECharts 的平滑近似。

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

组件提供可解释的 fallback，或客户端引用提供可保留的源内容时，使用局部替代内容，
显示阅读提示并记录 `partial`，保留相邻组件。无法绘制的图表保留源数据而不猜测几何。
缺少可靠局部替代时，
使用官网提供的 Markdown fallback，避免直接丢弃未知组件。官方 fallback 也可能省略
原生组件内容；正文缺块时，应对照源组件树、常量和 fallback，不能仅凭 GET 成功或
`status: fallback` 判断内容完整。Drafts Get 原样写入转换结果，预览样式无法补回上游缺失内容。
引用清理保留 `client_defined_widget` 匹配的原文，包括围栏代码；它是可见内容，不能因
`alt` 为空而删除。无法取得可处理源内容的客户端组件仍保留官方 fallback 中已有的原文。
未知引用类型缺少可用 `alt` 时也保留原文；只有明确的隐藏内容和来源脚注标记等
已知类型可以按既有语义删除，避免同类数据丢失扩散到新增组件。

2026-11-06 的适配由用户报告的客户端饼图缺失触发；执行与验证状态见
[交付记录](plans/2026-11-06-genui-client-widgets.md)。参考的公开图表定义位于
[官网组件包](https://chatgpt.com/cdn/assets/536822.eb169dfc9d.js)，归一化逻辑位于
[官网图表包](https://chatgpt.com/cdn/assets/586159.48c41918bf.js)（11 月 3 日观察）。

## 验证

客户端 widget、区间几何及 Get/Send 回归在 `tests/chatgpt-web-client-widgets.test.mjs`。
组件契约回归在 `tests/chatgpt-web-genui-components.test.mjs`，图表与离线包回归在
`tests/chatgpt-web-genui-charts.test.mjs`；既有流、合并消息和
Drafts 恢复回归在 `chatgpt-web-genui.test.mjs`、`chatgpt-web-stream-handoff.test.mjs` 等文件。
合成示例 `tests/fixtures/genui-components.mjs` 可用于桌面、窄屏和深色预览。
真实会话及其原始元数据保留在仓库外。

2026-10-31 的只读排查发现，单个 `Cite.ref` 会触发旧属性白名单的整体回退。
补充该属性后，已核对的回答可完整生成 HTML；合成回归同时覆盖 Cite/Citation、
代码和表格混排，以及真实 Action 2 脚本的正文写入。此结果不证明所有官网组件
均已适配，也不代替用户设备上的 Drafts 原生预览验证。

同日对用户确认的代码块样本继续核对：官网 fallback 含有完整代码，引用清理却把
`client_defined_widget` 的整段匹配文本替换成空 `alt`。保留原文并补齐客户端代码组件
读取后，两个回答中的 7 个代码块与源数据逐字一致。回归同时经过首流、resume、
历史轮询、Markdown 清理和 Action 2；未知组件及缺失解析数据仍使用保留原文的回退。
生产构建已安装并重新加载，本机网关强制刷新和现有 Action 2 脚本均保留全部 7 个
代码块；按 Drafts 文档默认选项运行的 MultiMarkdown 6 也保留相同文本和顺序。
此处验证了网关与脚本，没有在安装了 Drafts 的用户设备上运行原生动作。

2026-11-06 的客户端图表适配通过 1,678 项完整回归与生产构建，并已安装、重载本机
扩展。原有饼图经运行中的网关强制 GET 后返回 `html/rendered`，四组数据、原始小数
精度及单位页脚均保留；当前 Get/Send 脚本原样写入相同 HTML。桌面、390px 和暗色
浏览器预览及本地交互已检查；这不证明 Drafts 设备原生导入、WebKit 或 iCloud 同步。
具体检查、部署层和保留边界见上述交付记录。

2026-11-17 的 Drafts 代码块适配通过 86 项定向回归，范围为
`tests/drafts-code-diagrams.test.mjs`、`tests/chatgpt-web-genui-charts.test.mjs`
和 `tests/drafts-operation-recovery.test.mjs`。回归覆盖 SVG 清理及内部引用、
模板分隔符保护、Mermaid frontmatter/directive 配置隔离、源码回退和清理。
恢复测试的一处编辑模拟同步支持标题位于首行的笔记布局，先确认编辑实际发生。
使用一次 Ask ChatGPT 设计判断，结合本地源码和浏览器实测补齐了可选配置保护与
内部 SVG 引用；该协作属于设计判断，验收依据为本地测试及原生观察。

本机 macOS 15.7.9 / Drafts 52.0.1 原生 Preview 已显示 SVG、流程图、时序图和
思维导图，错误图形保留源码，其后图形正常呈现。共享脚本更新后重新运行动作，
已核对部署模板逐字一致、唯一脚本 CSP 哈希和前一版本保留。390px 浅色/深色
浏览器检查中页面宽度与滚动宽度均为 390px，宽图在自身 358px 视口内滚动；
连续主题切换后保留五个原始代码块与四幅有效图形，临时节点为零。
手机、平板和跨设备 iCloud 同步留待各自设备验收。

2026-11-23 的公式分隔符修复通过 55 项定向回归，范围为
`tests/drafts-preview-math.test.mjs`、`tests/drafts-code-diagrams.test.mjs`
和 `tests/chatgpt-web-genui-charts.test.mjs`。新增用例覆盖用户给出的循环隐状态
公式及三处行内变量、显式数学节点、矩阵换行、混用/残缺分隔符和实际离线包执行。
本机 Drafts 附带的 MultiMarkdown 6.7.0 确认原始 HTML 会保留双反斜杠；
将该输出注入完整生成模板后，独立 WKWebView 在 1000px 浅色和 390px 浅色/深色
环境均显示四处公式，包含一处块级公式，渲染错误为零，页面宽度与视口相同。
已通过 `npm run drafts:update` 更新共享模板，核对部署文件、导入包和生成文件逐字
一致、脚本 CSP 哈希匹配及前一版本保留。文档检查、受影响文件 lint 和生成文件
时效检查通过。本轮视觉检查使用独立 WKWebView；Drafts 原生动作界面、
手机/平板及跨设备同步保留为各自环境的验收项。
