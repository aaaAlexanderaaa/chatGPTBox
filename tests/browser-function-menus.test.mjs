import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { resources } from '../src/_locales/resources.mjs'
import { RuntimeMessage } from '../src/protocol/messages.mjs'

const state = vi.hoisted(() => ({
  config: {},
  language: 'en',
  items: [],
  listeners: new Set(),
  sent: [],
}))
vi.mock('../src/config/storage.mjs', () => ({
  defaultConfig: { selectionTools: ['translate'] },
  getUserConfig: async () => state.config,
  getPreferredLanguageKey: async () => state.language,
}))
vi.mock('webextension-polyfill', () => ({
  default: {
    contextMenus: {
      create: async (item) => {
        if (state.items.some((value) => value.id === item.id)) throw new Error('Duplicate menu ID')
        state.items.push(item)
      },
      removeAll: async () => {
        state.items = []
      },
      onClicked: {
        hasListener: (listener) => state.listeners.has(listener),
        addListener: (listener) => state.listeners.add(listener),
        removeListener: (listener) => state.listeners.delete(listener),
      },
    },
    tabs: {
      query: async () => [{ id: 42 }],
      sendMessage: async (...args) => state.sent.push(args),
    },
    runtime: { sendMessage: async (message) => state.sent.push(message) },
  },
}))
import { refreshMenu } from '../src/background/menus.mjs'
import { listFunctions } from '../src/browser-assistant/catalog.mjs'
import {
  applyPreferredLanguage,
  buildLanguageOptions,
} from '../src/popup/components/preferred-language.mjs'

beforeEach(async () => {
  await i18n.init({ resources, lng: 'en', fallbackLng: 'en' })
  state.config = {
    activeSelectionTools: ['translate'],
    browserAssistantEnabled: true,
    customSelectionTools: [{ name: 'My function', prompt: 'Explain {{selection}}', active: true }],
    browserAssistantFunctions: [
      {
        id: 'saved.link',
        name: 'My saved link',
        prompt: 'Read the link',
        scope: 'url',
        output: 'chat',
        enabled: true,
      },
    ],
  }
  state.language = 'en'
  state.items = []
  state.sent = []
})

describe('shared functions in native browser entries', () => {
  it('builds the context menu from the same catalog as the toolbar and picker', async () => {
    await refreshMenu()
    const nativeIds = state.items
      .filter((item) => item.id.startsWith('ChatGPTBox-Menufunction:'))
      .map((item) => item.id.slice('ChatGPTBox-Menufunction:'.length))
    expect(nativeIds).toEqual(
      listFunctions(state.config, { entry: 'context-menu' }).map((item) => item.id),
    )
    expect(nativeIds).toContain('saved.link')
    expect(nativeIds).toContain('legacy.0')
    expect(state.items.find((item) => item.id.endsWith('preset.rewrite')).contexts).toEqual([
      'editable',
    ])
  })
  it('serializes rebuilds and uses the chosen Chinese language for menu labels', async () => {
    const first = refreshMenu()
    state.language = 'zh'
    await Promise.all([first, refreshMenu(), refreshMenu()])
    expect(state.items.find((item) => item.id.endsWith('preset.annotations')).title).toBe(
      '导读与标注',
    )
    expect(state.items.find((item) => item.id.endsWith('browserAssistant')).title).toBe('功能…')
  })
  it('respects per-function entry preferences and enablement in the real menu builder', async () => {
    state.config.browserFunctionOverrides = {
      'preset.annotations': { entries: ['selection-toolbar'] },
      'preset.link': { enabled: false },
    }
    await refreshMenu()
    expect(state.items.some((item) => item.id.endsWith('preset.annotations'))).toBe(false)
    expect(state.items.some((item) => item.id.endsWith('preset.link'))).toBe(false)
  })
  it('dispatches the canonical function ID to the clicked frame without another prompt builder', async () => {
    await refreshMenu()
    const listener = state.listeners.values().next().value
    listener(
      { menuItemId: 'ChatGPTBox-Menufunction:saved.link', frameId: 3, selectionText: 'Passage' },
      { id: 42 },
    )
    expect(state.sent).toContainEqual([
      42,
      {
        type: RuntimeMessage.CreateChat,
        data: { itemId: 'function:saved.link', selectionText: 'Passage' },
      },
      { frameId: 3 },
    ])
  })
  it('localizes Auto and rebuilds native menus when the user changes preferred language', async () => {
    const updateConfig = async (patch) => Object.assign(state.config, patch)
    await applyPreferredLanguage('zh-Hant-TW', {
      config: { userLanguage: 'en' },
      updateConfig,
      i18n,
    })
    expect(i18n.language).toBe('zhHant')
    expect(state.sent).toContainEqual({ type: RuntimeMessage.RefreshMenu })
    expect(state.sent).toContainEqual([
      42,
      { type: RuntimeMessage.ChangeLang, data: { lang: 'zhHant' } },
    ])
    expect(
      buildLanguageOptions(i18n.t.bind(i18n)).find((item) => item.value === 'auto').label,
    ).toBe(i18n.t('Auto'))
  })
})
