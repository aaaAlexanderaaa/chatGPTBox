import { describe, expect, it } from 'vitest'
import {
  filterChatgptWebKeysByAccount,
  isChatgptWebKeyAvailableForAccount,
  pickDefaultChatgptWebKey,
  slugForChatgptWebModelKey,
} from '../src/config/account-models.mjs'
import { Models } from '../src/config/models.mjs'

// Roadmap D / D-15: settings must only offer tiers the account can use.
// Unknown catalogs never filter anything.

describe('filterChatgptWebKeysByAccount', () => {
  it('keeps only keys whose slug is in the account catalog', () => {
    const slug56 = Models.chatgptWeb56Thinking.value
    const slug54 = Models.chatgptWeb54Auto.value
    const keys = filterChatgptWebKeysByAccount([slug56, slug54, 'something-else'])
    expect(keys).toContain('chatgptWeb56Thinking')
    expect(keys).toContain('chatgptWeb54Auto')
    expect(keys.every((key) => [slug56, slug54].includes(Models[key].value))).toBe(true)
  })

  it('returns null for unknown or empty catalogs (filtering off)', () => {
    expect(filterChatgptWebKeysByAccount(null)).toBeNull()
    expect(filterChatgptWebKeysByAccount(undefined)).toBeNull()
    expect(filterChatgptWebKeysByAccount([])).toBeNull()
  })

  it('returns null when the catalog matches nothing we know', () => {
    expect(filterChatgptWebKeysByAccount(['totally-unknown-slug'])).toBeNull()
  })
})

describe('isChatgptWebKeyAvailableForAccount', () => {
  it('everything is available when the catalog is unknown', () => {
    expect(isChatgptWebKeyAvailableForAccount('chatgptWeb56Thinking', null)).toBe(true)
  })

  it('filters by the catalog when known', () => {
    const slug56 = Models.chatgptWeb56Thinking.value
    expect(isChatgptWebKeyAvailableForAccount('chatgptWeb56Thinking', [slug56])).toBe(true)
    expect(isChatgptWebKeyAvailableForAccount('chatgptWeb55Thinking', [slug56])).toBe(false)
  })
})

describe('pickDefaultChatgptWebKey', () => {
  it('keeps a usable current key', () => {
    const slug56 = Models.chatgptWeb56Thinking.value
    expect(
      pickDefaultChatgptWebKey({ currentKey: 'chatgptWeb56Thinking', availableSlugs: [slug56] }),
    ).toBe('chatgptWeb56Thinking')
  })

  it('falls to the newest usable tier (key order is newest-first)', () => {
    const slug54 = Models.chatgptWeb54Auto.value
    const slug53 = Models.chatgptWeb53Instant.value
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptWeb56Thinking',
        availableSlugs: [slug53, slug54],
      }),
    ).toBe('chatgptWeb54Auto')
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptWeb54Auto',
        availableSlugs: [Models.chatgptWeb6Pro.value, Models.chatgptWeb56Thinking.value],
      }),
    ).toBe('chatgptWeb56Thinking')
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptWeb56Thinking',
        availableSlugs: [Models.chatgptWeb56SolWork.value, Models.chatgptWeb6Pro.value],
      }),
    ).toBe('chatgptWeb6Pro')
    expect(
      pickDefaultChatgptWebKey({
        currentKey: 'chatgptWeb56Thinking',
        availableSlugs: [Models.chatgptWeb6AstraWork.value, Models.chatgptWeb56SolWork.value],
      }),
    ).toBe('chatgptWeb6AstraWork')
  })

  it('unknown catalog keeps the current key', () => {
    expect(
      pickDefaultChatgptWebKey({ currentKey: 'chatgptWeb56Thinking', availableSlugs: [] }),
    ).toBe('chatgptWeb56Thinking')
  })
})

describe('slugForChatgptWebModelKey', () => {
  it('maps a key to its account slug', () => {
    expect(slugForChatgptWebModelKey('chatgptWeb56Thinking')).toBe(
      Models.chatgptWeb56Thinking.value,
    )
    expect(slugForChatgptWebModelKey('nope')).toBeUndefined()
  })
})
