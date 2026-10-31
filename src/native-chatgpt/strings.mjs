// Shared by the tiny early entry and the normal i18n resources.
export const nativeChatgptMessages = {
  en: {},
  zh: {
    'This draft was not saved. Fix it before saving; the saved rules still apply.':
      '草稿尚未保存。请修正后再保存；当前仍使用已保存的规则。',
    'Loading saved website settings…': '正在读取已保存的网站设置…',
    'Saved website settings could not be read. Reload settings before changing ChatGPT enhancements.':
      '无法读取已保存的网站设置。请重新加载设置后再修改 ChatGPT 官网增强。',
    'Reload settings': '重新加载设置',
    'Saved rules are unavailable. Reload settings before saving.':
      '已保存的规则暂不可用，请重新加载设置后再保存。',
    'Rules could not be saved. Your draft is not the active policy; retry saving.':
      '规则保存失败。草稿尚未作为生效策略，请重试保存。',
    'Saved rules changed in another window. Your unsaved draft is kept. Choose which version to use before saving.':
      '规则已在另一窗口改变。已保留你的未保存草稿，请先选择使用哪个版本。',
    'Use saved rules': '使用已保存规则',
    'Keep my draft': '保留我的草稿',
    'Draft kept. Saving will replace the current saved rules.':
      '已保留草稿；再次保存会覆盖当前已保存的规则。',
    'The selected result is unchanged original text. I confirm sharing it with the website.':
      '所选结果与原文完全相同。我确认将原文交给网站。',
    'Original text needs explicit confirmation. Paste again.': '插入原文需要明确确认，请重新粘贴。',
    'Regex replacement rules': '正则替换规则',
    'RE2 syntax; no / delimiters. Flags: i, m, s. Each rule matches globally, left to right without overlapping itself.':
      '使用 RE2 语法，不加 / 分隔符。标志支持 i、m、s；每条从左到右全局匹配，同一条内的命中不重叠。',
    'Replacement: fixed text, empty to delete, $$ for $, $& for the match, $1 or $<name> for a capture. Captures can retain sensitive text; review the result.':
      '替换支持固定文字、留空删除、$$ 表示美元符号、$& 表示完整命中、$1 或 $<name> 表示捕获组。捕获组可能保留敏感内容，请检查最终结果。',
    'Up to 100 rules, 512 UTF-16 units per pattern, 256 per template and 16 captures. Lookaround and pattern backreferences are unsupported.':
      '最多 100 条；表达式最多 512、替换模板最多 256 个 UTF-16 单位，每条最多 16 个捕获组。不支持环视和表达式内反向引用。',
    'Rules are stored locally and included in full configuration backups. Pasted originals are not saved.':
      '规则保存在本地，完整配置备份会包含规则；粘贴原文不会保存。',
    'Legacy terms are escaped as literal patterns with [REDACTED] replacement. Save to upgrade; custom identity aliases are no longer generated for these rules.':
      '旧敏感词已转义为字面表达式，默认替换为 [REDACTED]。保存后升级；这些规则不再生成自定义身份别名。',
    'Invalid saved rules block checked insertion until repaired and saved.':
      '请修正规则后保存；已保存的无效策略会阻止检查后插入。',
    'Changes are not saved. Save rules to replace the invalid policy.':
      '尚未保存。点击保存规则后才会替换原来的无效策略。',
    'Reset invalid rules': '重置无效规则',
    'No custom rules. Built-in email, phone and known-key checks still apply.':
      '尚无自定义规则；内置邮箱、手机号和已知密钥检查仍会运行。',
    Rule: '规则',
    'Matching pattern': '匹配表达式',
    Flags: '匹配标志',
    'Replacement text (empty deletes the match)': '替换文本（留空则删除命中）',
    'Remove rule': '删除规则',
    'Add rule': '添加规则',
    'Save rules': '保存规则',
    'Rules saved.': '规则已保存。',
    'Use up to 100 regex replacement rules.': '最多支持 100 条正则替换规则。',
    'Invalid legacy term. Repair or remove this rule.': '旧词条无效，请修正或删除该条。',
    'Invalid rule format. Each rule needs pattern, flags and replacement.':
      '规则格式无效，每条须有 pattern、flags 和 replacement 字符串字段。',
    'Invalid replacement. Use $$, $&, $1–$99 or $<name> for declared groups only.':
      '替换语法无效；仅支持 $$、$&、$1–$99 或 $<name>，引用的捕获组必须存在。',
    'Each pattern must contain 1–512 UTF-16 units.': '每条表达式须包含 1–512 个 UTF-16 单位。',
    'Each replacement template may contain at most 256 UTF-16 units.':
      '每条替换模板最多包含 256 个 UTF-16 单位。',
    'Flags may contain i, m and s once each; g is optional because matching is always global.':
      '标志仅支持 i、m、s，各最多一次；始终全局匹配，g 可省略。',
    'Unsupported or invalid RE2 regular expression.': 'RE2 表达式无效或使用了不支持的语法。',
    'Regex program is too large. Simplify this rule or use fewer rules.':
      '正则编译规模过大，请简化该条或减少规则。',
    'Use at most 16 capture groups per rule.': '每条最多支持 16 个捕获组。',
    'Zero-length matches are not supported. Require at least one character.':
      '不支持零长度命中，请让每次命中至少包含一个字符。',
    'Local check took too long. Simplify the rules or paste a smaller part.':
      '本地检查耗时过长，请简化规则或分段粘贴。',
    'Replacement output is too large. Simplify the rules or paste a smaller part.':
      '替换结果过长，请简化规则或分段粘贴。',
    'The candidate contains a known key or token. Change the rules or selection before inserting.':
      '候选含有已知格式的密钥或令牌，请调整规则或勾选项后再插入。',
    'Custom regex rule': '自定义正则规则',
    '(delete)': '（删除）',
    'Overlapping rules conflict. The entire range uses one masked alias.':
      '重叠规则冲突，整个范围统一使用遮盖别名。',
    'Finish composing before pasting.': '请先完成输入法组合输入，再粘贴。',
    'Finish composing before rewriting.': '请先完成输入法组合输入，再改写。',
    'Local paste checking is unconfirmed. Do not rely on it; reload the extension and try again.':
      '本地粘贴检查状态未确认，请勿依赖其保护；请重新加载扩展后重试。',
    'Reload ChatGPT to apply local paste checking.':
      '请刷新 ChatGPT 页面，使本地粘贴检查设置生效。',
    'ChatGPT website enhancements': 'ChatGPT 官网增强',
    'Works on chatgpt.com independently of the ChatGPT Web engine and gateway.':
      '独立增强 chatgpt.com，不要求启用 ChatGPT Web 引擎或网关。',
    'Rewrite draft': '改写草稿',
    'Show a draft-rewrite entry beside the native ChatGPT input. Uses your existing Functions and chosen engine.':
      '在官网输入框旁显示改写入口，复用现有功能和你选择的 AI 连接。',
    'Local paste check': '本地粘贴检查',
    'Checks normal text paste in the main ChatGPT editor. Matches require confirmation in an extension window.':
      '检查主对话输入框中的普通文本粘贴。命中后在扩展窗口确认，再插入。',
    'Reload ChatGPT after installing or updating the extension. Desktop Chromium only.':
      '安装或更新扩展后请刷新 ChatGPT。自动粘贴检查仅支持桌面 Chromium。',
    'This checks the intercepted paste event, not all clipboard access. A website with clipboard-read permission can read the clipboard separately.':
      '仅检查拦下的粘贴事件，不隔离所有剪贴板访问。网站若有剪贴板读取权限，仍可能单独读取。',
    'Custom terms (one per line)': '自定义敏感词（每行一个）',
    'Exact, case-sensitive matching. Stored locally as configuration; included in full configuration backups.':
      '精确、区分大小写匹配。词条保存在本地配置中，完整配置备份会包含这些词条。',
    'Save terms': '保存词条',
    'Terms saved.': '词条已保存。',
    'Use up to 100 custom terms.': '最多支持 100 个自定义词条。',
    'Each custom term must contain 1–120 characters on one line.':
      '每个词条必须为单行，包含 1–120 个字符。',
    'Ready: local paste check.': '本地粘贴检查已就绪。',
    'Local check is starting. Paste again shortly.': '正在初始化本地检查，请稍后重新粘贴。',
    'This editor or page is not supported.': '此输入框或页面暂不支持粘贴检查。',
    'Finish or cancel the current paste first.': '请先完成或取消当前粘贴。',
    'Checking locally…': '正在本机检查…',
    'Review this paste in the extension window.': '请在扩展窗口确认本次粘贴。',
    'No rule matched. Text inserted.': '规则未命中，已插入文本。',
    'Paste cancelled.': '已取消粘贴。',
    'The input changed. Paste again.': '输入位置或内容已改变，请重新粘贴。',
    'Paste review expired. Paste again.': '粘贴审查已过期，请重新粘贴。',
    'Could not open the paste review. Paste again.': '无法打开粘贴审查窗口，请重新粘贴。',
    'Paste inserted.': '已插入。',
    'Check incomplete. Original text was not inserted.': '检查未完成，未插入原文。',
    'Images and files are not checked.': '图片和文件不在检查范围内。',
    'Paste is too long. Split it into parts of at most 20000 characters.':
      '粘贴文本过长，请分成每段最多 20000 个字符。',
    'Too many matches. Split the text and paste again.': '命中项过多，请分段重新粘贴。',
    'The local check could not start. Paste again.': '本地检查无法启动，请重新粘贴。',
    'This paste also contains formatting. Confirm plain-text insertion.':
      '本次粘贴包含格式，请确认是否仅插入纯文本。',
    'Paste review': '粘贴审查',
    'Original text': '原文',
    'Text to insert': '将插入的文本',
    'Choose which matches to replace. Keys stay masked in this result.':
      '选择需要替换的命中项。此替换结果中的密钥保持遮盖。',
    'Insert selected text': '插入所选结果',
    'Insert original plain text once': '仅此次插入原文纯文本',
    'I understand that original text will be shared with the website.':
      '我确认本次将原文交给网站。',
    Cancel: '取消',
    Close: '关闭',
    'Connecting to the original document…': '正在连接原始页面…',
    'This review is no longer available. Close it and paste again.':
      '本次审查已失效，请关闭后重新粘贴。',
    'Review cancelled or target changed.': '审查已取消或目标已改变。',
    'API key or bearer token': 'API 密钥或 Bearer 令牌',
    Email: '邮箱',
    'Mainland China phone candidate': '中国大陆手机号候选',
    'Custom term': '自定义词',
    'The editor did not confirm insertion. Check the draft before retrying.':
      '编辑器未确认插入结果，请先检查草稿再重试。',
    'The input changed. Open the assistant again.': '输入框已改变，请重新打开助手。',
    'Could not open the assistant. Reload the page and try again.':
      '无法打开助手，请刷新页面后重试。',
    'Only the supported rules are checked; an unmatched text is not a privacy guarantee.':
      '仅检查已支持的规则；未命中不代表文本没有敏感信息。',
  },
  zhHant: {
    'This draft was not saved. Fix it before saving; the saved rules still apply.':
      '草稿尚未儲存。請修正後再儲存；目前仍使用已儲存的規則。',
    'Loading saved website settings…': '正在讀取已儲存的網站設定…',
    'Saved website settings could not be read. Reload settings before changing ChatGPT enhancements.':
      '無法讀取已儲存的網站設定。請重新載入設定後再修改 ChatGPT 官網增強。',
    'Reload settings': '重新載入設定',
    'Saved rules are unavailable. Reload settings before saving.':
      '已儲存的規則暫時無法使用，請重新載入設定後再儲存。',
    'Rules could not be saved. Your draft is not the active policy; retry saving.':
      '規則儲存失敗。草稿尚未成為生效策略，請重試儲存。',
    'Saved rules changed in another window. Your unsaved draft is kept. Choose which version to use before saving.':
      '規則已在另一視窗變更。已保留你的未儲存草稿，請先選擇使用哪個版本。',
    'Use saved rules': '使用已儲存規則',
    'Keep my draft': '保留我的草稿',
    'Draft kept. Saving will replace the current saved rules.':
      '已保留草稿；再次儲存會覆蓋目前已儲存的規則。',
    'The selected result is unchanged original text. I confirm sharing it with the website.':
      '所選結果與原文完全相同。我確認將原文交給網站。',
    'Original text needs explicit confirmation. Paste again.': '插入原文需要明確確認，請重新貼上。',
    'Regex replacement rules': '正則替換規則',
    'RE2 syntax; no / delimiters. Flags: i, m, s. Each rule matches globally, left to right without overlapping itself.':
      '使用 RE2 語法，不加 / 分隔符。旗標支援 i、m、s；每條由左至右全域比對，同一條內的命中不重疊。',
    'Replacement: fixed text, empty to delete, $$ for $, $& for the match, $1 or $<name> for a capture. Captures can retain sensitive text; review the result.':
      '替換支援固定文字、留空刪除、$$ 表示美元符號、$& 表示完整命中、$1 或 $<name> 表示擷取群組。群組可能保留敏感內容，請檢查最終結果。',
    'Up to 100 rules, 512 UTF-16 units per pattern, 256 per template and 16 captures. Lookaround and pattern backreferences are unsupported.':
      '最多 100 條；運算式最多 512、替換範本最多 256 個 UTF-16 單位，每條最多 16 個擷取群組。不支援環視和運算式內反向參照。',
    'Rules are stored locally and included in full configuration backups. Pasted originals are not saved.':
      '規則儲存在本機，完整設定備份會包含規則；貼上原文不會儲存。',
    'Legacy terms are escaped as literal patterns with [REDACTED] replacement. Save to upgrade; custom identity aliases are no longer generated for these rules.':
      '舊敏感詞已轉義為字面運算式，預設替換為 [REDACTED]。儲存後升級；這些規則不再產生自訂身分別名。',
    'Invalid saved rules block checked insertion until repaired and saved.':
      '請修正規則後儲存；已儲存的無效策略會阻止檢查後插入。',
    'Changes are not saved. Save rules to replace the invalid policy.':
      '尚未儲存。儲存規則後才會替換原來的無效策略。',
    'Reset invalid rules': '重設無效規則',
    'No custom rules. Built-in email, phone and known-key checks still apply.':
      '尚無自訂規則；內建信箱、手機號碼和已知金鑰檢查仍會執行。',
    Rule: '規則',
    'Matching pattern': '比對運算式',
    Flags: '比對旗標',
    'Replacement text (empty deletes the match)': '替換文字（留空則刪除命中）',
    'Remove rule': '刪除規則',
    'Add rule': '新增規則',
    'Save rules': '儲存規則',
    'Rules saved.': '規則已儲存。',
    'Use up to 100 regex replacement rules.': '最多支援 100 條正則替換規則。',
    'Invalid legacy term. Repair or remove this rule.': '舊詞條無效，請修正或刪除該條。',
    'Invalid rule format. Each rule needs pattern, flags and replacement.':
      '規則格式無效，每條須有 pattern、flags 和 replacement 字串欄位。',
    'Invalid replacement. Use $$, $&, $1–$99 or $<name> for declared groups only.':
      '替換語法無效；僅支援 $$、$&、$1–$99 或 $<name>，參照的擷取群組必須存在。',
    'Each pattern must contain 1–512 UTF-16 units.': '每條運算式須包含 1–512 個 UTF-16 單位。',
    'Each replacement template may contain at most 256 UTF-16 units.':
      '每條替換範本最多包含 256 個 UTF-16 單位。',
    'Flags may contain i, m and s once each; g is optional because matching is always global.':
      '旗標僅支援 i、m、s，各最多一次；始終全域比對，g 可省略。',
    'Unsupported or invalid RE2 regular expression.': 'RE2 運算式無效或使用了不支援的語法。',
    'Regex program is too large. Simplify this rule or use fewer rules.':
      '正則編譯規模過大，請簡化該條或減少規則。',
    'Use at most 16 capture groups per rule.': '每條最多支援 16 個擷取群組。',
    'Zero-length matches are not supported. Require at least one character.':
      '不支援零長度命中，請讓每次命中至少包含一個字元。',
    'Local check took too long. Simplify the rules or paste a smaller part.':
      '本機檢查耗時過長，請簡化規則或分段貼上。',
    'Replacement output is too large. Simplify the rules or paste a smaller part.':
      '替換結果過長，請簡化規則或分段貼上。',
    'The candidate contains a known key or token. Change the rules or selection before inserting.':
      '候選含有已知格式的金鑰或權杖，請調整規則或勾選項目後再插入。',
    'Custom regex rule': '自訂正則規則',
    '(delete)': '（刪除）',
    'Overlapping rules conflict. The entire range uses one masked alias.':
      '重疊規則衝突，整個範圍統一使用遮蓋別名。',
    'Finish composing before pasting.': '請先完成輸入法組合輸入，再貼上。',
    'Finish composing before rewriting.': '請先完成輸入法組合輸入，再改寫。',
    'Local paste checking is unconfirmed. Do not rely on it; reload the extension and try again.':
      '本機貼上檢查狀態未確認，請勿依賴其保護；請重新載入擴充功能後重試。',
    'Reload ChatGPT to apply local paste checking.':
      '請重新整理 ChatGPT 頁面，使本機貼上檢查設定生效。',
    'Choose which matches to replace. Keys stay masked in this result.':
      '選擇需要替換的項目。此替換結果中的金鑰保持遮蓋。',
    'ChatGPT website enhancements': 'ChatGPT 官網增強',
    'Rewrite draft': '改寫草稿',
    'Local paste check': '本機貼上檢查',
    'Ready: local paste check.': '本機貼上檢查已就緒。',
    'Checking locally…': '正在本機檢查…',
    'Review this paste in the extension window.': '請在擴充功能視窗確認本次貼上。',
    'Paste review': '貼上審查',
    'Original text': '原文',
    'Text to insert': '將插入的文字',
    'Insert selected text': '插入所選結果',
    'Insert original plain text once': '僅本次插入原文純文字',
    Cancel: '取消',
    Close: '關閉',
    'Custom terms (one per line)': '自訂敏感詞（每行一個）',
    'Save terms': '儲存詞條',
  },
}
export function nativeText(language = 'en') {
  const key = /^zh(?:Hant|-hant|-tw|-hk)/i.test(language)
    ? 'zhHant'
    : /^zh/i.test(language)
    ? 'zh'
    : 'en'
  return (text) => nativeChatgptMessages[key][text] || text
}
