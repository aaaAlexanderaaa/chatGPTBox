import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeLanguageKey, preferredLanguageKey } from '../src/config/language-preference.mjs'

const stored = vi.hoisted(() => ({ preferredLanguage: 'auto', userLanguage: 'zh' }))
vi.mock('../src/config/storage.mjs', () => ({ getUserConfig: async () => stored }))
import {
  getPreferredLanguage,
  getPreferredLanguageNative,
  getUserLanguage,
} from '../src/config/language.mjs'

describe('consistent interface and response languages', () => {
  beforeEach(() => Object.assign(stored, { preferredLanguage: 'auto', userLanguage: 'zh' }))
  it.each(['zh-TW', 'zh-HK', 'zh-Hant-TW', 'zh_Hant', 'zhHant'])(
    'normalizes traditional Chinese locale %s',
    (value) => expect(normalizeLanguageKey(value)).toBe('zhHant'),
  )
  it('uses the saved user language in auto mode instead of the default navigator language', async () => {
    expect(preferredLanguageKey(stored, 'en')).toBe('zh')
    expect(await getUserLanguage()).toBe('Chinese (Simplified)')
    expect(await getPreferredLanguageNative()).toBe('简体中文')
    stored.userLanguage = 'en'
    expect(await getPreferredLanguage()).toBe('English')
  })
  it('keeps an explicit language consistent with UI locale normalization', async () => {
    stored.preferredLanguage = 'zh-Hant-TW'
    expect(preferredLanguageKey(stored)).toBe('zhHant')
    expect(await getPreferredLanguage()).toBe('Chinese (Traditional)')
    expect(await getPreferredLanguageNative()).toBe('正體中文')
  })
  it('handles unsupported languages without crashing prompt preparation', async () => {
    stored.preferredLanguage = 'unknown'
    expect(await getPreferredLanguage()).toBe('English')
  })
})
