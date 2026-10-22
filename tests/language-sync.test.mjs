import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { preferredLanguageKey } from '../src/config/language-preference.mjs'

const state = vi.hoisted(() => ({
  config: { preferredLanguage: 'auto', userLanguage: 'zh' },
  listeners: new Set(),
  reads: null,
}))
vi.mock('../src/config/storage.mjs', () => ({
  getNavigatorLanguage: () => 'en',
  getPreferredLanguageKey: async () =>
    state.reads ? await state.reads() : preferredLanguageKey(state.config),
}))
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        onChanged: {
          addListener: (listener) => state.listeners.add(listener),
        },
      },
    },
  },
}))
import { initializeLanguage } from '../src/_locales/language-sync.mjs'

describe('language synchronization in each extension context', () => {
  beforeEach(() => {
    state.config = { preferredLanguage: 'auto', userLanguage: 'zh' }
    state.listeners.clear()
    state.reads = null
  })
  it('initializes from saved settings and installs only one listener', async () => {
    const instance = createInstance()
    const first = initializeLanguage(instance)
    expect(initializeLanguage(instance)).toBe(first)
    await first
    expect(instance.language).toBe('zh')
    expect(instance.t('Functions')).toBe('功能')
    expect(state.listeners.size).toBe(1)
  })
  it('updates other contexts when the stored language changes', async () => {
    const instance = createInstance()
    await initializeLanguage(instance)
    state.config.preferredLanguage = 'en'
    for (const listener of state.listeners) listener({ preferredLanguage: { newValue: 'en' } })
    await vi.waitFor(() => expect(instance.language).toBe('en'))
    expect(instance.t('Functions')).toBe('Functions')
    state.config = { preferredLanguage: 'auto', userLanguage: 'zh-Hant-TW' }
    for (const listener of state.listeners) listener({ userLanguage: { newValue: 'zh-Hant-TW' } })
    await vi.waitFor(() => expect(instance.language).toBe('zhHant'))
  })
  it('does not let a slow old preference overwrite the latest change', async () => {
    const instance = createInstance()
    await initializeLanguage(instance)
    let oldRead
    state.reads = () =>
      new Promise((resolve) => {
        oldRead = resolve
      })
    for (const listener of state.listeners) listener({ preferredLanguage: { newValue: 'zh' } })
    state.reads = () => Promise.resolve('en')
    for (const listener of state.listeners) listener({ preferredLanguage: { newValue: 'en' } })
    await vi.waitFor(() => expect(instance.language).toBe('en'))
    oldRead('zh')
    await Promise.resolve()
    await Promise.resolve()
    expect(instance.language).toBe('en')
  })
})
