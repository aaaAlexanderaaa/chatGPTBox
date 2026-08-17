import { grokWebModelKeys, Models } from './models.mjs'

export { grokWebModelKeys } from './models.mjs'

export const GROK_WEB_SLUGS = Object.freeze({
  grokWebFast: 'grok-chat-fast',
  grokWebAuto: 'grok-chat-auto',
  grokWebExpert: 'grok-chat-expert',
  grokWebHeavy: 'grok-chat-heavy',
})

const slugToKey = Object.fromEntries(
  grokWebModelKeys.map((key) => [Models[key].value, key]),
)

const TIER_SLUGS = Object.freeze({
  basic: ['grok-chat-fast'],
  super: ['grok-chat-fast', 'grok-chat-auto', 'grok-chat-expert'],
  heavy: ['grok-chat-fast', 'grok-chat-auto', 'grok-chat-expert', 'grok-chat-heavy'],
})

const DEFAULT_KEY_BY_TIER = Object.freeze({
  basic: 'grokWebFast',
  super: 'grokWebExpert',
  heavy: 'grokWebHeavy',
})

function makeApiMode(itemName) {
  return {
    groupName: 'grokWebModelKeys',
    itemName,
    isCustom: false,
    displayName: '',
    customName: '',
    customUrl: '',
    apiKey: '',
    active: true,
  }
}

export function slugsForGrokWebTier(tier) {
  if (!tier || tier === 'basic') return [...TIER_SLUGS.basic]
  if (tier === 'super') return [...TIER_SLUGS.super]
  if (tier === 'heavy') return [...TIER_SLUGS.heavy]
  return [...TIER_SLUGS.basic]
}

export function pickDefaultGrokWebKey(tier) {
  if (tier === 'super') return DEFAULT_KEY_BY_TIER.super
  if (tier === 'heavy') return DEFAULT_KEY_BY_TIER.heavy
  return DEFAULT_KEY_BY_TIER.basic
}

export function isGrokChatSlug(slug) {
  return slug in slugToKey
}

export function grokSlugToModelKey(slug) {
  return slugToKey[slug] ?? null
}

const SLUG_TO_MODE_ID = Object.freeze({
  'grok-chat-fast': 'fast',
  'grok-chat-auto': 'auto',
  'grok-chat-expert': 'expert',
  'grok-chat-heavy': 'heavy',
})

export function grokSlugToModeId(slug) {
  return SLUG_TO_MODE_ID[slug] ?? null
}

export function grokWebConversationUrl(conversationId) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!id) return 'https://grok.com/'
  return `https://grok.com/c/${encodeURIComponent(id)}`
}

export function grokWebApiModesForAccount({
  signedIn,
  tier,
  availableSlugs,
  selectedModelName,
}) {
  if (!signedIn) {
    if (selectedModelName && grokWebModelKeys.includes(selectedModelName)) {
      return [makeApiMode(selectedModelName)]
    }
    return []
  }

  let slugs = slugsForGrokWebTier(tier)
  if (Array.isArray(availableSlugs)) {
    if (availableSlugs.length === 0) {
      slugs = ['grok-chat-fast']
    } else {
      slugs = slugs.filter((slug) => availableSlugs.includes(slug))
    }
  }

  return grokWebModelKeys
    .filter((key) => slugs.includes(Models[key].value))
    .map(makeApiMode)
}
