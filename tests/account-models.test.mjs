import { describe, expect, it } from 'vitest'
import {
  isChatgptWebKeyAvailableForAccount,
  pickDefaultChatgptWebKey,
  slugForChatgptWebModelKey,
} from '../src/config/account-models.mjs'

describe('slugForChatgptWebModelKey', () => {
  it('maps a selection or leftover web key to a catalog slug', () => {
    expect(slugForChatgptWebModelKey('chatgptweb/gpt-5-6-thinking')).toBe('gpt-5-6-thinking')
    expect(slugForChatgptWebModelKey('chatgptWeb56Thinking')).toBe('gpt-5-6-thinking')
  })
})

describe('isChatgptWebKeyAvailableForAccount', () => {
  it('everything is available when the catalog is unknown', () => {
    expect(isChatgptWebKeyAvailableForAccount('chatgptweb/gpt-5-6-thinking', null)).toBe(true)
  })

  it('filters by the catalog when known', () => {
    expect(
      isChatgptWebKeyAvailableForAccount('chatgptweb/gpt-5-6-thinking', ['gpt-5-6-thinking']),
    ).toBe(true)
    expect(
      isChatgptWebKeyAvailableForAccount('chatgptweb/gpt-5-5-thinking', ['gpt-5-6-thinking']),
    ).toBe(false)
  })
})

describe('pickDefaultChatgptWebKey', () => {
  it('keeps a usable current selection', () => {
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptweb/gpt-5-6-thinking',
        availableSlugs: ['gpt-5-6-thinking'],
      }),
    ).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('prefers standard GPT-6 Thinking ahead of Pro and older models', () => {
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptweb/missing',
        availableSlugs: ['gpt-6-pro', 'gpt-5-6-thinking', 'gpt-6-thinking'],
      }),
    ).toBe('chatgptweb/gpt-6-thinking')
  })

  it.each(['chatgptweb/gpt-6-thinking', 'chatgptweb/missing'])(
    'keeps GPT-6 Thinking as the default when the account adds GPT-6.2 (%s)',
    (currentKey) => {
      expect(
        pickDefaultChatgptWebKey({
          currentKey,
          availableSlugs: [
            'gpt-6-2',
            'gpt-6-2-thinking',
            'gpt-6-2-instant',
            'gpt-6.2-astra-wm',
            'gpt-6.2-sol-wm',
            'gpt-6-thinking',
          ],
        }),
      ).toBe('chatgptweb/gpt-6-thinking')
    },
  )

  it('unknown catalog keeps the current key', () => {
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptweb/gpt-5-6-thinking',
        availableSlugs: [],
      }),
    ).toBe('chatgptweb/gpt-5-6-thinking')
  })
})
