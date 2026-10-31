// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { nativeChatgptMessages } from '../src/native-chatgpt/strings.mjs'
import { NativeChatgptSettings } from '../src/popup/components/NativeChatgptSettings.jsx'
import { useSettingsConfig } from '../src/hooks/use-settings-config.mjs'
const loading = vi.hoisted(() => ({ defer: false, reject: false, resolve: null }))

vi.mock('../src/config/storage.mjs', async () => {
  const { default: browser } = await import('webextension-polyfill')
  return {
    defaultConfig: { chatgptNativePasteTerms: [] },
    getUserConfig: async () => {
      if (loading.reject) throw new Error('synthetic read failure')
      return loading.defer
        ? new Promise((resolve) => {
            loading.resolve = resolve
          })
        : { chatgptNativePasteTerms: [] }
    },
    setUserConfig: (value) => browser.storage.local.set(value),
  }
})

let root, publish, finishWrite
const listeners = new Set()
function SettingsOwner() {
  const [config, updateConfig, configReadState] = useSettingsConfig()
  return (
    <>
      <output data-active-policy>{JSON.stringify(config.chatgptNativePasteTerms)}</output>
      <NativeChatgptSettings
        config={config}
        updateConfig={updateConfig}
        configReadState={configReadState}
      />
    </>
  )
}
const button = (text) => [...root.querySelectorAll('button')].find((el) => el.textContent === text)
const changed = (value) => listeners.forEach((fn) => fn({ chatgptNativePasteTerms: value }))
beforeEach(async () => {
  Browser.runtime.getManifest = () => ({ manifest_version: 3 })
  await i18n.use(initReactI18next).init({
    resources: { zh: { translation: nativeChatgptMessages.zh } },
    lng: 'zh',
    interpolation: { escapeValue: false },
  })
  Browser.storage.local.onChanged = {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
  }
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(
    (value) =>
      new Promise((resolve) => {
        finishWrite = resolve
        publish = () => {
          const saved = value.chatgptNativePasteTerms.map((rule) =>
            Object.fromEntries(Object.entries(rule).sort(([a], [b]) => a.localeCompare(b))),
          )
          changed({ newValue: saved })
          resolve()
        }
      }),
  )
  document.body.innerHTML = '<div id="root"></div>'
  root = document.getElementById('root')
  await act(async () => render(<SettingsOwner />, root))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
afterEach(() => {
  act(() => render(null, root))
  delete Browser.storage.local.onChanged
  listeners.clear()
  vi.restoreAllMocks()
  loading.defer = false
  loading.reject = false
})

it('publishes only saved policy and keeps success after reordered Chrome acknowledgement', async () => {
  await act(async () => button('添加规则').click())
  const input = root.querySelector('[data-native-rule-row] input')
  act(() => {
    input.value = '示例[甲乙]公司'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存规则').click())
  expect(Browser.storage.local.set).toHaveBeenCalledOnce()
  expect(root.querySelector('[data-active-policy]').textContent).toBe('[]')
  await act(async () => {
    publish()
    await Promise.resolve()
  })
  expect(root.querySelector('[role="status"]').textContent).toBe('规则已保存。')
  await act(async () =>
    changed({ newValue: [{ flags: '', pattern: '另一条', replacement: '[客户]' }] }),
  )
  expect(root.querySelector('[role="status"]')).toBeNull()
  expect(root.querySelector('[data-native-rule-row] input').value).toBe('另一条')
})

it('keeps failed writes out of active state and preserves a retryable draft', async () => {
  vi.mocked(Browser.storage.local.set).mockRejectedValueOnce(new Error('quota'))
  await act(async () => button('添加规则').click())
  const input = root.querySelector('[data-native-rule-row] input')
  act(() => {
    input.value = '本地草稿'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    button('保存规则').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(root.querySelector('[data-active-policy]').textContent).toBe('[]')
  expect(input.value).toBe('本地草稿')
  expect(root.querySelector('[role="alert"]').textContent).toContain('保存失败')
  expect(button('保存规则').disabled).toBe(false)
  await act(async () => button('保存规则').click())
  await act(async () => {
    publish()
    await Promise.resolve()
  })
  expect(root.querySelector('[data-active-policy]').textContent).toContain('本地草稿')
  expect(root.querySelector('[role="alert"]')).toBeNull()
})

it.each(['保留我的草稿', '使用已保存规则'])(
  'keeps dirty edits on external save until explicit %s',
  async (choice) => {
    await act(async () =>
      changed({ newValue: [{ pattern: '原规则', flags: '', replacement: 'X' }] }),
    )
    const input = root.querySelector('[data-native-rule-row] input')
    act(() => {
      input.value = '我的草稿'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      changed({ newValue: [{ pattern: '另一窗口', flags: '', replacement: 'Y' }] }),
    )
    expect(input.value).toBe('我的草稿')
    expect(root.querySelector('[role="alert"]').textContent).toContain('另一窗口')
    expect(button('保存规则').disabled).toBe(true)
    await act(async () => button(choice).click())
    expect(input.value).toBe(choice === '保留我的草稿' ? '我的草稿' : '另一窗口')
    expect(button('保存规则').disabled).toBe(false)
    expect(Browser.storage.local.set).not.toHaveBeenCalled()
  },
)

it('keeps a policy event received during initial read instead of applying stale read data', async () => {
  act(() => render(null, root))
  loading.defer = true
  await act(async () => render(<SettingsOwner />, root))
  await act(async () => changed({ newValue: [{ pattern: '新规则', flags: '', replacement: 'N' }] }))
  await act(async () =>
    loading.resolve({
      chatgptNativePasteTerms: [{ pattern: '旧规则', flags: '', replacement: 'O' }],
    }),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(root.querySelector('[data-active-policy]').textContent).toContain('新规则')
  expect(root.querySelector('[data-native-rule-row] input').value).toBe('新规则')
})

it('shows null imports as invalid while deletion restores the empty default', async () => {
  await act(async () => changed({ newValue: null }))
  expect(root.querySelector('pre').textContent).toBe('null')
  expect(root.querySelector('[role="alert"]').textContent).toContain('最多支持 100 条')
  expect(button('保存规则')).toBeUndefined()
  expect(Browser.storage.local.set).not.toHaveBeenCalled()
  await act(async () => changed({ oldValue: null }))
  expect(root.querySelector('[role="alert"]')).toBeNull()
  expect(button('添加规则')).toBeDefined()
})

it('keeps new edits when its own save receipt arrives after the promise completed', async () => {
  await act(async () => button('添加规则').click())
  const input = root.querySelector('[data-native-rule-row] input')
  act(() => {
    input.value = '已保存版本'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存规则').click())
  await act(async () => {
    finishWrite()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  act(() => {
    input.value = '新一轮草稿'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => publish())
  expect(input.value).toBe('新一轮草稿')
  expect(root.querySelector('[data-active-policy]').textContent).toContain('已保存版本')
  expect(button('保存规则').disabled).toBe(false)
})

it('does not mark its draft current when another policy is published before save completion', async () => {
  await act(async () => button('添加规则').click())
  const input = root.querySelector('[data-native-rule-row] input')
  act(() => {
    input.value = '本窗口版本'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存规则').click())
  await act(async () =>
    changed({ newValue: [{ pattern: '另一个生效版本', flags: '', replacement: 'Y' }] }),
  )
  await act(async () => {
    finishWrite()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(input.value).toBe('本窗口版本')
  expect(root.querySelector('[data-active-policy]').textContent).toContain('另一个生效版本')
  expect(root.querySelector('[role="alert"]').textContent).toContain('另一窗口')
  expect(button('保存规则').disabled).toBe(true)
})

it('adopts an authoritative late receipt after explicitly using the saved version', async () => {
  await act(async () => button('添加规则').click())
  const input = root.querySelector('[data-native-rule-row] input')
  act(() => {
    input.value = 'N'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存规则').click())
  await act(async () => changed({ newValue: [{ pattern: 'F', flags: '', replacement: 'X' }] }))
  await act(async () => {
    finishWrite()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => button('使用已保存规则').click())
  expect(input.value).toBe('F')
  await act(async () => publish())
  expect(root.querySelector('[data-active-policy]').textContent).toContain('N')
  expect(input.value).toBe('N')
  expect(root.querySelector('[role="alert"]')).toBeNull()
})

it('labels invalid draft separately while the valid saved policy remains active', async () => {
  await act(async () =>
    changed({ newValue: [{ pattern: '有效规则', flags: '', replacement: 'X' }] }),
  )
  const input = root.querySelector('[data-native-rule-row] input')
  act(() => {
    input.value = '('
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存规则').click())
  expect(root.querySelector('[role="alert"]').textContent).toContain('草稿尚未保存')
  expect(root.querySelector('[role="alert"]').textContent).not.toContain('已保存的无效策略')
  expect(root.querySelector('[data-active-policy]').textContent).toContain('有效规则')
  expect(Browser.storage.local.set).not.toHaveBeenCalled()
})

it('shows failed initial read instead of exposing default rules as an editable saved policy', async () => {
  act(() => render(null, root))
  loading.reject = true
  await act(async () => {
    render(<SettingsOwner />, root)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(root.querySelector('[role="alert"]').textContent).toContain('无法读取')
  expect(button('添加规则')).toBeUndefined()
  expect(button('保存规则')).toBeUndefined()
  expect(button('重新加载设置')).toBeDefined()
  expect(Browser.storage.local.set).not.toHaveBeenCalled()
})
