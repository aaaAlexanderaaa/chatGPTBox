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

  it('prefers gpt-5-6-thinking when present in the catalog', () => {
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptweb/missing',
        availableSlugs: ['gpt-5-4-auto', 'gpt-5-6-thinking'],
      }),
    ).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('unknown catalog keeps the current key', () => {
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptweb/gpt-5-6-thinking',
        availableSlugs: [],
      }),
    ).toBe('chatgptweb/gpt-5-6-thinking')
  })
})
