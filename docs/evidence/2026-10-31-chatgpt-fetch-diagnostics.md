---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-31
---

# 2026-10-31 ChatGPT fetch diagnostics compatibility

本次用户报告发送前的 `ChatGPT webpage compatibility error`。实际网关健康、桥接已连接，
但同一安装版经代理页读取项目列表也返回 HTTP 503。此次页面仍有可识别的运行时引用，
与[前一天刷新后恢复的案例](2026-10-30-chatgpt-web-runtime.md)不同；需要修正调用关系识别。

## 公开代码与故障机制

从专用代理页的 modulepreload 与 DevTools 函数定位取得下列官网公开资源，另行下载核对：

| 资源 | 字节数 | SHA-256 |
| --- | --- | --- |
| [633146.af28b07636.js](https://chatgpt.com/cdn/assets/633146.af28b07636.js) | 231018 | `152cec295dde71eae78903e5bc3bdd9fdfdb735281fd9cafaba8d5ce20e430d9` |
| [673108.fc88f1fbb9.js](https://chatgpt.com/cdn/assets/673108.fc88f1fbb9.js) | 53828 | `0906fa539e4767bf468675f5823e833a6758168e26b9432b088bd63fca183559` |
| [7078.4467579346.js](https://chatgpt.com/cdn/assets/7078.4467579346.js) | 414310 | `6c49303b520718e4853cfbf391ce3bb063215167528298e6905fc2fe49c5c398` |

网络函数 `wl0r.d` 仍在第一次请求前调用身份检查和同步断言，传递取消信号，
并通过 `retry: never` 在认证重试前返回。变化发生在它调用的 `y3uJ.a`：原来的私有
WeakMap 追踪包装器直接调用 fetch，现在把原 fetch、原 URL/options 和 attempt
传给 `maGL.b`。该诊断函数只为同源 `/ces/v1/rgstr` 遥测地址添加 `ces_diag_id`；
业务 API 地址走直接调用传入 fetch 一次的分支。它保留原 options、响应与错误。

旧扫描器仅寻找直接 `fetch(`，会漏掉只传递 fetch 的包装器，也没有收集诊断模块。
旧包装器识别器则只接受直接 fetch，无法核实新增的委托。因此它按原规则拒绝连接，
未进入正式问题发送。刷新页面不能补齐这种源码识别缺口。

## 修复边界

- [公开代码扫描](../../src/services/clients/chatgpt-web/runtime-inspection.mjs)收集传递 fetch
  的 WeakMap 包装器与诊断候选；字符串只是发现线索，不是兼容性证明。
- [能力识别](../../src/services/clients/chatgpt-web/runtime-fetch-capabilities.mjs)沿真实模块
  import 核对原 fetch、参数与 attempt，检查诊断地址的同源、路径与无凭据条件，
  以及直接返回、单次调用、原响应和原错误的代码形态。请求参数、取消信号、响应与错误
  的直接改写也有反例检查；不符合这些已核对形态的候选仍拒绝。
- [职责解析](../../src/services/clients/chatgpt-web/runtime-capabilities.mjs)把诊断模块工厂及
  导出源码一起放入现有能力快照。MAIN 在连接前与每次请求前继续比较这些源码；
  账户、代次、工作区切换、取消和禁止重试检查保持原契约。没有新增运行时版本映射。
- 扩展只识别已加载的官网实现，不执行自己的遥测实现，不搬运原生网络凭据。
  API/MCP 与 Drafts 的输入、输出和恢复契约未变，Action 2/3 无需更新。

## 验证与安装

Node.js 22.18.0 下，相关三个测试文件的 157 项测试通过；全量 124 个文件的
1602 项测试通过，`npm run lint` 与 `git diff --check` 通过。新增合成样本覆盖委托链路、
改写参数/attempt/响应/错误、额外 fetch、错误遥测路径与来源，以及连接前后源码变化。
回归样本不包含账号、真实校验实现或原始会话。

四种生产包构建成功；只有既存 Browserslist 数据过期提示。分别提取四个包的两段 MAIN
注入函数，在不提供扩展外部辅助函数的 VM 中执行来源拒绝分支，均得到预期结果。
这是序列化与拒绝分支验证，不代替真实登录路径。

Brave 扩展管理页确认加载项目旁 `browser-extensions/chatgptbox` 安装目录。
替换前在仓库外保存临时回滚副本；安装后的 29 个构建文件逐一与 `build/chromium`
一致。管理页显示 `Reloaded`，随后刷新专用代理页并重新打开 API Server 桥接页。
桥接显示 Connected / healthy，沿用原 18081 端口、认证配置和网关进程。

同一个 `GET /chatgpt/projects` 从安装前 HTTP 503 恢复为重载后 HTTP 200，约 2.38 秒，
只记录条数，不保存项目内容。

只发送一次有实质内容的 ChatGPT 工程复核请求，没有重发用户原始失败问题，也没有覆盖
账号的模型/强度设置。MCP 返回 `completed` 和完整静态 HTML 回答；强制只读历史 GET
返回 HTTP 200，只有一条 user 和一条 assistant，`pending: false`，assistant 为
`finished_successfully`、`endTurn: true`，3796 字符的回答及尾部与 MCP 一致。
会话的 `defaultModel` 为 `gpt-6-thinking`；未截取 wire 请求的模型/强度，不能将该字段
充当请求参数观测。服务端思考时长为 219 秒；提交至本机首次读取完整结果约 287 秒，
后者包含并行检查与取结果等待，不是服务端思考时长。

复核者取得必要项目事实、修改后的识别代码及两段官网公开工厂源码，没有账号信息或
原始私人会话。其首次静态结论是当前官网实现未见阻断问题；它没有独立复现本机检查。
它也指出 AST 匹配不是任意未来 JavaScript 的完整语义证明，原生 RequestInit 的后续
展开覆盖 signal 是可构造的既有识别边界，当前下载的官方实现未观察到该情形。
等待复核期间，本机反例另发现诊断条件可直接改写业务 options 而通过初版检查，随后
增加改写参数、signal、fetch、响应与错误的五项拒绝样本。最终增加的守卫经过本机
回归与当前公开模块对照，未再次作为新问题提交给复核者。

正式发送发生在最后这项守卫重构建之前，发送实现和协议没有再改变；最终重载后只做
只读验证：健康检查为 healthy / connected，pending 为 0；项目列表 HTTP 200，约 1.97 秒。
最终安装的 29 个文件及四包 MAIN 来源拒绝分支也重新核对通过。手动调用量为三次
项目列表、一次完整历史读取、一次正式 MCP 请求；原生预检等辅助请求未逐一计数。
`npm run docs:check` 为 0 错误、4 条既存历史链接提示。
以上证据不证明新版官网上的真实断线恢复、取消、所有模型或可视化布局
均已逐项验证。

各层状态：源码已修复；四包已构建；实际 Chromium 安装副本已替换并重载；
网关未改动或重启，桥接已重新连接；Drafts 已安装副本未修改。
Firefox 仅有构建与合成测试证据，尚未执行真实账号验证。

## 同日后续：包装函数改为内联导出

用户再次报告同一发送前错误。网关和桥接仍为 healthy / connected，
`GET /chatgpt/projects` 则为 HTTP 503。代理页已加载的公开运行时变为
[633146.4fca27ee1f.js](https://chatgpt.com/cdn/assets/633146.4fca27ee1f.js)，
231674 字节，SHA-256 为
`c64c149d49bf3bf06f1e94696db046c36331341f9a2c5a6f29f8801ee15bae05`。

`y3uJ.a` 与 `maGL.b` 现在作为导出对象中的匿名 `FunctionExpression` 出现，
不再是工厂中的独立 `FunctionDeclaration`。识别器验证函数确实属于模块时只接受
后一种语法，所以两层包装均未被识别。相同函数必须真实存在于模块 AST 的函数节点中；
只在字符串里出现相同文本仍不成立。修复接受这两种函数节点，其他请求、诊断路径、
参数、取消、单次尝试和原响应/错误检查保持原代码，模块与导出源码仍逐次核对。

当前公开模块离线核对可解析出唯一的 `Kwur` 请求、`QdUF` 身份、`lXEa` 完整性和
`wl0r.d` 网络职责，并同时绑定 `y3uJ.a` 与 `maGL.b`。合成回归新增内联导出正例、
仅含相同字符串的反例，以及内联函数改变发送次数和参数的反例。

后续修复的三个相关测试文件共 162 项通过；全量 124 个文件的 1635 项通过，
lint、文档检查和 diff 检查通过，文档仍有 4 条既存历史链接提示。
四种生产包构建完成，安装目录的 29 个文件与 Chromium 构建逐一相同。
明确 Reload 扩展、刷新代理页并重开桥接后，同一个项目列表请求恢复 HTTP 200，
约 3.84 秒；健康状态为 healthy / connected，pending 为 0。
本轮只验证只读路径，没有重发用户失败的问题或发送新的测试问题。
网关进程、端口及认证未改动；Drafts 动作副本无需更换。
