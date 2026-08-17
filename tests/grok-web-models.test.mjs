import { describe, expect, it } from 'vitest'
import {
  grokSlugToModeId,
  grokSlugToModelKey,
  grokWebApiModesForAccount,
  grokWebConversationUrl,
  grokWebModelKeys,
  isGrokChatSlug,
  pickDefaultGrokWebKey,
  slugsForGrokWebTier,
} from '../src/config/grok-web.mjs'
import { Models } from '../src/config/models.mjs'

describe('grok web catalog', () => {
  it('maps keys to grok2api public slugs', () => {
    expect(Models.grokWebFast.value).toBe('grok-chat-fast')
    expect(Models.grokWebAuto.value).toBe('grok-chat-auto')
    expect(Models.grokWebExpert.value).toBe('grok-chat-expert')
    expect(Models.grokWebHeavy.value).toBe('grok-chat-heavy')
    expect(grokWebModelKeys).toEqual([
      'grokWebFast',
      'grokWebAuto',
      'grokWebExpert',
      'grokWebHeavy',
    ])
  })

  it('inherits lower tiers', () => {
    expect(slugsForGrokWebTier('basic')).toEqual(['grok-chat-fast'])
    expect(slugsForGrokWebTier('super')).toEqual([
      'grok-chat-fast',
      'grok-chat-auto',
      'grok-chat-expert',
    ])
    expect(slugsForGrokWebTier('heavy')).toEqual([
      'grok-chat-fast',
      'grok-chat-auto',
      'grok-chat-expert',
      'grok-chat-heavy',
    ])
    expect(slugsForGrokWebTier('')).toEqual(['grok-chat-fast'])
  })

  it('picks Super→Expert and Heavy→Heavy', () => {
    expect(pickDefaultGrokWebKey('basic')).toBe('grokWebFast')
    expect(pickDefaultGrokWebKey('super')).toBe('grokWebExpert')
    expect(pickDefaultGrokWebKey('heavy')).toBe('grokWebHeavy')
  })

  it('hides the picker when not signed in unless the current selection is Grok', () => {
    expect(grokWebApiModesForAccount({ signedIn: false, tier: 'super' })).toEqual([])
    const kept = grokWebApiModesForAccount({
      signedIn: false,
      tier: 'super',
      selectedModelName: 'grokWebExpert',
    })
    expect(kept.map((m) => m.itemName)).toEqual(['grokWebExpert'])
  })

  it('filters signed-in picker by tier', () => {
    const modes = grokWebApiModesForAccount({ signedIn: true, tier: 'basic' })
    expect(modes.map((m) => m.itemName)).toEqual(['grokWebFast'])
  })

  it('recognizes bridge slugs', () => {
    expect(isGrokChatSlug('grok-chat-expert')).toBe(true)
    expect(isGrokChatSlug('gpt-5-6-thinking')).toBe(false)
    expect(grokSlugToModelKey('grok-chat-heavy')).toBe('grokWebHeavy')
    expect(grokSlugToModelKey('nope')).toBeNull()
  })

  it('maps public slugs to grok2api modeId', () => {
    expect(grokSlugToModeId('grok-chat-fast')).toBe('fast')
    expect(grokSlugToModeId('grok-chat-auto')).toBe('auto')
    expect(grokSlugToModeId('grok-chat-expert')).toBe('expert')
    expect(grokSlugToModeId('grok-chat-heavy')).toBe('heavy')
    expect(grokSlugToModeId('nope')).toBeNull()
  })

  it('builds a grok.com thread URL', () => {
    expect(grokWebConversationUrl('abc/def')).toBe('https://grok.com/c/abc%2Fdef')
    expect(grokWebConversationUrl('')).toBe('https://grok.com/')
  })
})
