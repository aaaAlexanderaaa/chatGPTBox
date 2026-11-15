# 定位与验证入口

路径相对仓库根目录；用 `rg` 找当前职责，不假定函数或混淆字段永久不变。

| 需检查的边界 | 现有 owner / 代码 / 回归 |
| --- | --- |
| 当前产品与账号/恢复约定 | `docs/gemini-web.md`、`docs/engine-contract.md` |
| 编译、指纹、语义字段、模型选择符 | `src/config/gemini-web.mjs` |
| MAIN 输入、准备、action、history 与输出 | `src/services/clients/gemini-web/native-runtime.mjs` |
| 自动重命名等价、公开资源与文档绑定 | `code-equivalence.mjs`、`automatic-contract.mjs`、`runtime-inspection.mjs`（同目录）；`tests/gemini-code-equivalence.test.mjs` |
| 专用 tab、持久 hold、单路与只读恢复 | `src/background/gemini-web-service.mjs`；`tests/gemini-web-service.test.mjs` |
| provider / 统一引擎投影 | `src/background/providers/gemini-web.mjs`、`src/engines/adapters.mjs`、`runtime.mjs` |
| 模型就绪与界面 | `src/config/engine-selection.mjs`、`src/popup/components/GeminiWebTab.jsx`、`src/options/SettingsCenter.jsx` |
| HTTP、MCP 等待与恢复 | `scripts/api-server.mjs`、`scripts/lib/engine-gateway.mjs`、`scripts/mcp-server.mjs` |
| Drafts | `docs/drafts/engine-actions.shared.txt`、`gemini-*.js`、`scripts/sync-drafts-engines.mjs` |
| 各入口的受控回归 | `tests/engine-runtime.test.mjs`；用 `rg --files tests` 找 `gemini`、`engine`、`drafts`、`mcp` 对应文件 |

## 变化与应取得的证据

- **新增 runtime profile**：公开源码实际调用链、原生实例及全部所需方法指纹一致；
  核对模型 setter、请求准备、attestation、Send、终态和 history，不只让 readiness 变绿。
- **自动兼容**：完整 runtime/app 编译纯改名可接受；入口不变但 helper、条件、常量、外部 API、
  动态键、模块组合改变必须拒绝。缺模块、多解、名称冲突、超限/失败资源读取、document/runtime/
  nonce 变化、准备后的未知编译均不能触发发送或第二次 handler。生产包中的新增 MAIN 检查函数也需独立验证。
  同 token 的 `return` 换行、转义后的 strict directive 不能被当作无害格式变化。
- **提交/完成**：原生 handler 一次；准备期间意外 Send 不再额外提交；
  不能将旧同文 DOM 或父回答与新 terminal action 拼成成功。Stop/最终发布竞态只结束一次。
- **历史/续聊**：覆盖 pinned 与普通列表、分页、刷新/重开、过期 head、缺 produced proof；
  只读 busy/失败保留原 run，读操作不导航 writer 或释放活跃 lease。
- **Drafts**：先落完整 request/key 再 HTTP；丢失 202 后按原 key 找原 run；
  pending 时 Send 只观察。Get/Load Older 保留 Waiting Reply 与生成区外备注，编辑冲突保留全文。
- **时间/输出**：同一响应身份上的内容与终态一致；live/history 时间来源可不同。
  静态 HTML 不执行站点代码，未知原生交互块不伪造可用结果。

## 构建和真实环境

按 `CONTRIBUTING.md` 先跑相关测试，再由变化范围决定完整 suite、lint 和四包构建。
从最终 `background.js` 提取所有序列化 Gemini MAIN 函数，确认可单独编译、
无外部 bundler/Babel helper，并在适用的受控 fixture 执行。源码 `.toString()` 不是生产包证据。
Vitest 直接 import 压缩函数会经过重写。要核对序列化原文，先在受控进程中反序列化本项目
包内函数，并断言其 `toString()` 与提取文本相等；不执行候选官网公开源码来试兼容。

核对浏览器扩展详情中的实际路径，再更新那个安装；Reload 后刷新受影响页面。
只改 skill 不更新安装或重启服务。网关脚本有变化才按原参数重启现有 API/MCP，
保留端口、token、访问授权和未决请求账本；检查 bridge 实际健康与连接。
Drafts 重新生成不等于已替换用户副本，替换时保留地址和 token。

一次成功只证明该 runtime、模型和已观察流程。真实续聊、重启恢复、原生 Drafts、
其他浏览器分别取证；不沿用旧测试数声称本轮通过。清理临时观察器和自己的草稿，
不清除不确定 run、用户会话或账号保护。

## 离线参考与真实公开代码试验

先核对完整公开编译来源与调用链，再用已有 profile 的精确版本生成参考；命令不会下载或执行网站代码。
输出临时文件供检查，确认后才替换仓库参考。第二个命令会一致改名允许的符号，核对六项关键
namespace、提交方法和八个新指纹，并验证入口不变但 runtime 常量改变时仍拒绝。

```sh
node scripts/build-gemini-code-reference.mjs EXACT_VERSION /private/tmp/gemini-reference.json PUBLIC_RUNTIME.js PUBLIC_APP.js
node --max-old-space-size=512 scripts/check-gemini-code-reference.mjs /private/tmp/gemini-reference.json /private/tmp/gemini-report.json PUBLIC_RUNTIME.js PUBLIC_APP.js
```
