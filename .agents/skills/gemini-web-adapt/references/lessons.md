# 已验证经验

这些是有条件的历史经验，当前行为以 [Gemini 契约](../../../../docs/gemini-web.md)和代码为准。
每次新编译、模型、身份或原生事件改变都需重新核对。

## 2026-11-12：本地版本拒绝不是账号异常

初次安装只映射 `VxAhX7iBM_A.2018.O`，刷新后网站加载了 `qGl2D_iBXPk.2018.O`；
Angular view、类与字段职责发生变化。适配器在发送前报未验证版本，实际提交数为零。
早期操作者因此结束试验，误把自身兼容拒绝当成用户要求停止的网站异常。

只读检查公开脚本、真实实例和所需函数指纹后增加独立 profile，保留所有身份/提交保护。
新空白 writer 的思考档位重置为 Low；通过已检查的原生 menu setter 选择可用 High 并复核，
没有改手工页或请求体。随后一个 4 Argon / High 的真实 adapter 回合完成。
这不能证明所有新版本可自动接受，也不能以本地错误证明账号处罚。
来源：[最初交付与后续纠正](../../../../docs/plans/2026-11-12-gemini-web.md#correction-after-the-users-runtime-check-clarification)。

## 2026-11-13—14：原生提交入口与单次效果

直接会话 service 调用会跳过输入上游门控，DOM 合成点击也不能证明完整原生链路。
采用真实输入组件已有提交 handler，让网站保留准备、attestation、请求与原生恢复。
在准备前持久登记，在准备期间也监听意外 Send；稳定原生状态并不授权第二次调用。
生产打包会给注入函数引入外部 helper，因此需检查最终序列化函数，而不只检查源码。
来源：[原生设计与完成修正](../../../../docs/plans/2026-11-12-gemini-web.md#native-runtime-design-review)。

## 2026-11-14：父回答不能证明续聊成功

两次 Argon / High 续聊观察到 success/idle，却没有本次可归属的新响应；均保持 unknown，未重发。
使用旧父 head 或按问题文本查 DOM 会误认旧答案。当前实现用提交后持久化的 produced-output proof
关联 common run、native request 与新 server turn/response；history 中缺旧 client ID 时不猜测。
success/idle 后仍缺响应的观察有明确短边界，保留 hold；MCP 等待器不能抢占活跃 writer 的恢复。

用户后来选择 Hydrogen / Medium，真实续聊经 API/MCP 与新读 native history 得到相同正文和轮次，
Drafts Get 在丢失收据后找到原 operation。此成功未解释早前 Argon 异常，也不把旧 run 改为成功。
来源：[交付与真实观察](../../../../docs/plans/2026-11-13-gap-closure.md#real-gemini-and-drafts-evidence)。

## 2026-11-14：时间来源和客户端验收分别记录

同一 Hydrogen 回答的 live/native-history 时间戳相差约 3.6 秒，正文与轮次一致。
保留来源的时间点；请求到成功事件的间隔和本地 run 耗时均不是官方思考耗时。

四个 Gemini Drafts 脚本已在 VM 中通过真实认证网关验证，包含收据丢失与保留外部笔记。
此证据不覆盖 Drafts 原生导入、设备或 iCloud；维护时也不能由安装扩展推定已更新动作副本。
来源：[时间与脚本证据](../../../../docs/plans/2026-11-13-gap-closure.md#real-gemini-and-drafts-evidence)。
