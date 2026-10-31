// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { resources } from '../src/_locales/resources.mjs'
import { NativeChatgptSettings } from '../src/popup/components/NativeChatgptSettings.jsx'
import { installNativeDraftEntry } from '../src/native-chatgpt/draft-entry.mjs'
import { installNativeDraftLifecycle } from '../src/native-chatgpt/draft-lifecycle.mjs'
import { RuntimeMessage } from '../src/protocol/messages.mjs'
import { captureContext } from '../src/browser-assistant/context.mjs'

let root,
  dispose = () => {}
beforeEach(async () => {
  await i18n
    .use(initReactI18next)
    .init({ resources, lng: 'zh', fallbackLng: 'en', interpolation: { escapeValue: false } })
  Browser.runtime.getManifest = () => ({ manifest_version: 3 })
  document.body.innerHTML =
    '<main><form><textarea id="prompt-textarea">A sample draft</textarea></form></main><div id="root"></div>'
  root = document.getElementById('root')
})
afterEach(() => {
  dispose()
  dispose = () => {}
  act(() => render(null, root))
  vi.restoreAllMocks()
})
const button = (text) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent === text)
// jsdom clicks are untrusted. Invoke the captured listener with the trusted
// boundary value separately; production browser tests supply real clicks.
const trustedClick = async (entry, bindings) => {
  const index = bindings.mock.calls.findIndex(
    ([type], index) => type === 'click' && bindings.mock.contexts[index] === entry,
  )
  await bindings.mock.calls[index][1]({ isTrusted: true })
}

describe('independent native settings', () => {
  it('exposes separate toggles even with the ChatGPT Web engine disabled, and validates custom policy', async () => {
    const updateConfig = vi.fn()
    act(() =>
      render(
        <NativeChatgptSettings config={{ chatgptWebEnabled: false }} updateConfig={updateConfig} />,
        root,
      ),
    )
    expect(root.textContent).toContain('ChatGPT 官网增强')
    expect(root.textContent).toContain('本地粘贴检查')
    expect(root.textContent).toContain('完整配置备份')
    expect(root.textContent).toContain('网站若有剪贴板读取权限')
    await act(async () => button('添加规则').click())
    const inputs = root.querySelectorAll('[data-native-rule-row] input')
    act(() => {
      inputs[0].value = '示例[甲乙]公司'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      inputs[2].value = '[客户]'
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('保存规则').click())
    expect(updateConfig).toHaveBeenCalledWith({
      chatgptNativePasteTerms: [{ pattern: '示例[甲乙]公司', flags: '', replacement: '[客户]' }],
    })
    act(() => {
      inputs[0].value = '(?=x)'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('保存规则').click())
    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(root.querySelector('[role="alert"]').textContent).toContain('RE2 表达式无效')
    expect(inputs[0].value).toBe('(?=x)')
  })
  it('shows legacy migration and saves an editable object policy with intentional deletion', async () => {
    const updateConfig = vi.fn()
    await act(async () =>
      render(
        <NativeChatgptSettings
          config={{ chatgptNativePasteTerms: ['a+b'] }}
          updateConfig={updateConfig}
        />,
        root,
      ),
    )
    const inputs = root.querySelectorAll('[data-native-rule-row] input')
    expect(inputs[0].value).toBe('a\\+b')
    expect(root.textContent).toContain('旧敏感词已转义')
    act(() => {
      inputs[2].value = ''
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('保存规则').click())
    expect(updateConfig).toHaveBeenCalledWith({
      chatgptNativePasteTerms: [{ pattern: 'a\\+b', flags: '', replacement: '' }],
    })
  })
  it('keeps a malformed imported policy visible until an explicit reset and save', async () => {
    const updateConfig = vi.fn()
    await act(async () =>
      render(
        <NativeChatgptSettings
          config={{ chatgptNativePasteTerms: null }}
          updateConfig={updateConfig}
        />,
        root,
      ),
    )
    expect(root.querySelector('[role="alert"]').textContent).toContain('最多支持 100 条')
    expect(root.querySelector('pre').textContent).toBe('null')
    expect(button('保存规则')).toBeUndefined()
    expect(updateConfig).not.toHaveBeenCalled()
    await act(async () => button('重置无效规则').click())
    expect(updateConfig).not.toHaveBeenCalled()
    expect(root.textContent).toContain('尚未保存')
    await act(async () => button('保存规则').click())
    expect(updateConfig).toHaveBeenCalledWith({ chatgptNativePasteTerms: [] })
  })
  it('uses background registration for opt-in and displays activation failures', async () => {
    const send = vi
      .spyOn(Browser.runtime, 'sendMessage')
      .mockRejectedValue(new Error('registration unavailable'))
    act(() => render(<NativeChatgptSettings config={{}} updateConfig={vi.fn()} />, root))
    const toggles = root.querySelectorAll('[role="switch"]')
    await act(async () => toggles[1].click())
    expect(send).toHaveBeenCalledWith({
      type: RuntimeMessage.SetNativePasteEnabled,
      data: { enabled: true },
    })
    expect(root.textContent).toContain('本地粘贴检查状态未确认')
  })
  it('retains save confirmation when the settings owner publishes the saved policy', async () => {
    function SettingsOwner() {
      const [config, setConfig] = useState({ chatgptNativePasteTerms: [] })
      return (
        <NativeChatgptSettings
          config={config}
          updateConfig={async (patch) =>
            setConfig((current) => ({
              ...current,
              chatgptNativePasteTerms: patch.chatgptNativePasteTerms.map((rule) =>
                Object.fromEntries(Object.entries(rule).sort(([a], [b]) => a.localeCompare(b))),
              ),
            }))
          }
        />
      )
    }
    await act(async () => render(<SettingsOwner />, root))
    await act(async () => button('添加规则').click())
    const input = root.querySelector('[data-native-rule-row] input')
    act(() => {
      input.value = '示例[甲乙]公司'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('保存规则').click())
    expect(root.querySelector('[role="status"]').textContent).toBe('规则已保存。')
  })
  it('keeps the new automatic paste control unavailable in the Firefox manifest build', () => {
    Browser.runtime.getManifest = () => ({ manifest_version: 2 })
    act(() => render(<NativeChatgptSettings config={{}} updateConfig={() => {}} />, root))
    expect(root.querySelector('textarea')).toBeNull()
    expect(root.textContent).toContain('改写草稿')
    expect(root.textContent).not.toContain('命中后在扩展窗口确认')
  })
})

describe('native draft entry uses the existing assistant context', () => {
  it('captures only the selected draft and opens without running an engine', async () => {
    window.history.replaceState(null, '', '/')
    // jsdom document URL is localhost; use a separate permitted origin fixture below.
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      '<main><form><textarea id="prompt-textarea">One two three</textarea></form></main>',
      { url: 'https://chatgpt.com/', pretendToBeVisual: true },
    )
    const doc = dom.window.document,
      editor = doc.getElementById('prompt-textarea')
    const open = vi.fn()
    const bindings = vi.spyOn(dom.window.EventTarget.prototype, 'addEventListener')
    dispose = installNativeDraftEntry({ doc, enabled: true, t: (text) => text, onRewrite: open })
    editor.focus()
    editor.setSelectionRange(4, 7)
    doc.dispatchEvent(new dom.window.Event('selectionchange'))
    const entry = doc.querySelector('[data-chatgptbox-native-draft] button')
    expect(entry.textContent).toBe('Rewrite draft')
    entry.click()
    expect(open).not.toHaveBeenCalled()
    await trustedClick(entry, bindings)
    await Promise.resolve()
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0].input.selectedText).toBe('two')
    expect(editor.value).toBe('One two three')
    dispose()
    dom.window.close()
  })
  it('does not mount or read a draft when disabled', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM('<textarea id="prompt-textarea">private</textarea>', {
      url: 'https://chatgpt.com/',
      pretendToBeVisual: true,
    })
    const onRewrite = vi.fn()
    dispose = installNativeDraftEntry({
      doc: dom.window.document,
      enabled: false,
      t: (x) => x,
      onRewrite,
    })
    expect(dom.window.document.querySelector('[data-chatgptbox-native-draft]')).toBeNull()
    expect(onRewrite).not.toHaveBeenCalled()
    expect(captureContext({ doc: dom.window.document }).url).toBe('https://chatgpt.com/')
    dispose()
    dom.window.close()
  })
  it('preserves multiline draft material, pauses for composition and refreshes after BFCache', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      '<main><form><div id="prompt-textarea" contenteditable="true"><p>一</p><p>二</p></div></form></main>',
      { url: 'https://chatgpt.com/', pretendToBeVisual: true },
    )
    const doc = dom.window.document,
      editor = doc.getElementById('prompt-textarea'),
      open = vi.fn()
    const listeners = new Set()
    const bindings = vi.spyOn(dom.window.EventTarget.prototype, 'addEventListener')
    let enabled = true
    const browser = {
      storage: {
        onChanged: {
          addListener: (fn) => listeners.add(fn),
          removeListener: (fn) => listeners.delete(fn),
        },
      },
    }
    dispose = installNativeDraftLifecycle({
      doc,
      browser,
      getConfig: async () => ({ chatgptNativeRewriteEnabled: enabled }),
      t: (x) => x,
      onRewrite: open,
    })
    await Promise.resolve()
    let entry = doc.querySelector('[data-chatgptbox-native-draft] button')
    editor.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    expect(entry.disabled).toBe(true)
    editor.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }))
    await trustedClick(entry, bindings)
    await Promise.resolve()
    await Promise.resolve()
    expect(open.mock.calls[0][0].input.selectedText).toBe('一\n二')
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }))
    expect(doc.querySelector('[data-chatgptbox-native-draft]')).toBeNull()
    enabled = false
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }))
    await Promise.resolve()
    expect(doc.querySelector('[data-chatgptbox-native-draft]')).toBeNull()
    enabled = true
    for (const fn of listeners) fn({ chatgptNativeRewriteEnabled: { newValue: true } }, 'local')
    await Promise.resolve()
    expect(doc.querySelector('[data-chatgptbox-native-draft] button')).not.toBeNull()
    dispose()
    dom.window.close()
  })
})
