// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import Browser from 'webextension-polyfill'
import { useSettingsConfig } from '../src/hooks/use-settings-config.mjs'
import { FunctionLibrary } from '../src/browser-assistant/FunctionLibrary.jsx'

const state = vi.hoisted(() => ({ config: {}, writes: [] }))
vi.mock('../src/config/storage.mjs', () => ({
  defaultConfig: {
    browserAssistantFunctions: [],
    browserFunctionOverrides: {},
    customSelectionTools: [],
  },
  getUserConfig: async () => state.config,
  setUserConfig: (patch) =>
    new Promise((resolve, reject) => state.writes.push({ patch, resolve, reject })),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (value) => value }) }))

let root, listeners, writeConfig
function SettingsFunctions() {
  const [config, updateConfig, configReadState] = useSettingsConfig()
  writeConfig = updateConfig
  return (
    <FunctionLibrary
      config={config}
      updateConfig={updateConfig}
      configReadState={configReadState}
    />
  )
}

beforeEach(() => {
  state.config = {
    modelName: 'chatgptweb/model',
    chatgptWebEnabled: true,
    chatgptWebEnabledModels: ['model'],
    l1Providers: [],
    activeSelectionTools: [],
    customSelectionTools: [],
    browserAssistantFunctions: ['A', 'B'].map((id) => ({
      id,
      name: id,
      prompt: 'Explain this passage.',
      scope: 'selection',
      output: 'chat',
      enabled: true,
      entries: ['function-picker', 'context-menu'],
    })),
  }
  state.writes = []
  listeners = new Set()
  Browser.storage.local.onChanged = {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
  }
  root = document.createElement('div')
  document.body.append(root)
})
afterEach(() => {
  act(() => render(null, root))
  root.remove()
  delete Browser.storage.local.onChanged
})

async function mount() {
  await act(async () => render(<SettingsFunctions />, root))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const row = (id) => root.querySelector(`[data-function-id="${id}"]`)
const switchFor = (id) => row(id).querySelector('[role="switch"]')
const entryFor = (id) => row(id).querySelector('input[type="checkbox"]')
const button = (element, label) =>
  [...element.querySelectorAll('button')].find((item) => item.textContent === label)

async function finishWrite(error) {
  const write = state.writes.at(-1)
  await act(async () => {
    if (error) write.reject(error)
    else {
      state.config = { ...state.config, ...write.patch }
      const changes = Object.fromEntries(
        Object.entries(write.patch).map(([key, newValue]) => [key, { newValue }]),
      )
      for (const listener of listeners) listener(changes)
      write.resolve()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

it.each([
  ['enabled switches', switchFor, (item) => item.enabled === false],
  ['entry checkboxes', entryFor, (item) => !item.entries.includes('function-picker')],
])('prevents overlapping %s from overwriting a pending change', async (_, control, changed) => {
  await mount()
  act(() => control('A').click())
  expect(state.writes).toHaveLength(1)
  expect(control('B').matches(':disabled')).toBe(true)
  expect(root.querySelector('input[type="file"]').matches(':disabled')).toBe(true)
  act(() => control('B').click())
  expect(state.writes).toHaveLength(1)

  await finishWrite()
  expect(control('B').matches(':disabled')).toBe(false)
  act(() => control('B').click())
  await finishWrite()
  expect(state.writes).toHaveLength(2)
  expect(state.config.browserAssistantFunctions.every(changed)).toBe(true)
})

it('restores controls after a failed write without publishing the failed change', async () => {
  await mount()
  act(() => switchFor('A').click())
  await finishWrite(new Error('Storage full'))
  expect(root.querySelector('[role="alert"]').textContent).toBe('Storage full')
  expect(switchFor('A').getAttribute('aria-checked')).toBe('true')
  expect(switchFor('B').matches(':disabled')).toBe(false)

  act(() => switchFor('B').click())
  await finishWrite()
  expect(state.config.browserAssistantFunctions.map((item) => item.enabled)).toEqual([true, false])
})

it('blocks duplicate submissions and preserves the editor draft when saving fails', async () => {
  await mount()
  act(() => button(row('A'), 'Edit').click())
  const form = row('A').querySelector('form')
  act(() => {
    const input = form.querySelector('textarea')
    input.value = '保留这份尚未保存的草稿。'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(state.writes).toHaveLength(1)
  expect(form.querySelector('textarea').matches(':disabled')).toBe(true)
  act(() => button(row('B'), 'Edit').click())
  expect(row('A').querySelector('form')).toBe(form)

  await finishWrite(new Error('Storage full'))
  expect(form.querySelector('textarea').value).toBe('保留这份尚未保存的草稿。')
  expect(form.querySelector('textarea').matches(':disabled')).toBe(false)
  act(() => button(form, 'Save').click())
  await finishWrite()
  expect(row('A').querySelector('form')).toBeNull()
  expect(state.config.browserAssistantFunctions.find((item) => item.id === 'A').prompt).toBe(
    '保留这份尚未保存的草稿。',
  )
})

it('reserves the save operation before reading an imported file', async () => {
  await mount()
  let finishRead
  const file = {
    size: 100,
    text: () => new Promise((resolve) => (finishRead = resolve)),
  }
  const input = root.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [file] })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(switchFor('A').matches(':disabled')).toBe(true)
  act(() => switchFor('A').click())
  expect(state.writes).toHaveLength(0)

  await act(async () =>
    finishRead(
      JSON.stringify({
        format: 'chatgptbox.browser-functions',
        version: 2,
        functions: [{ ...state.config.browserAssistantFunctions[0], id: 'imported' }],
      }),
    ),
  )
  expect(state.writes).toHaveLength(1)
  await finishWrite()
  expect(state.config.browserAssistantFunctions.map((item) => item.id)).toEqual([
    'A',
    'B',
    'imported',
  ])
  expect(switchFor('A').matches(':disabled')).toBe(false)
})

it('restores controls and explains an invalid import without writing configuration', async () => {
  await mount()
  const input = root.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', {
    value: [{ size: 1, text: async () => '{' }],
  })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(state.writes).toHaveLength(0)
  expect(root.querySelector('[role="alert"]').textContent).toBe('Unsupported function file')
  expect(switchFor('A').matches(':disabled')).toBe(false)
})

it('blocks collection writes and editing until the initial read actually succeeds', async () => {
  const saved = state.config
  let complete
  state.config = new Promise((resolve) => {
    complete = resolve
  })
  await mount()
  expect(button(root, 'New function').matches(':disabled')).toBe(true)
  await expect(writeConfig({ browserAssistantFunctions: [] })).rejects.toThrow('unavailable')
  expect(state.writes).toEqual([])
  await act(async () => {
    complete(saved)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(button(root, 'New function').matches(':disabled')).toBe(false)
  expect(row('A')).toBeTruthy()
})
it('keeps functions unavailable on a read failure and never overwrites saved collections', async () => {
  state.config = Promise.reject(new Error('read failed'))
  state.config.catch(() => {})
  await mount()
  expect(root.textContent).toContain('could not be loaded')
  expect(button(root, 'New function').matches(':disabled')).toBe(true)
  await expect(writeConfig({ customSelectionTools: [] })).rejects.toThrow('unavailable')
  expect(state.writes).toEqual([])
})
