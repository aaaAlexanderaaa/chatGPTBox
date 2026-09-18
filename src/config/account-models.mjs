// Account-available ChatGPT Web models.
// Pickers use `chatgptweb/<slug>`. Catalog unknown → do not filter.

import { chatgptWebChatModelKeys, chatgptWebModelKeys, Models } from './models.mjs'
import {
  formatEngineSelection,
  L2_CHATGPT_WEB,
  parseEngineSelection,
} from './engine-selection.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_SLUG } from './limits.mjs'

export function slugForChatgptWebModelKey(modelKey) {
  const parsed = parseEngineSelection(modelKey)
  if (parsed?.providerId === L2_CHATGPT_WEB) return parsed.modelId
  return Models[modelKey]?.value
}

export function filterChatgptWebKeysByAccount(availableSlugs) {
  if (!Array.isArray(availableSlugs) || availableSlugs.length === 0) return null
  const slugSet = new Set(availableSlugs)
  const keys = chatgptWebModelKeys.filter((key) => slugSet.has(Models[key]?.value))
  return keys.length > 0 ? keys : null
}

export function isChatgptWebKeyAvailableForAccount(modelKey, availableSlugs) {
  if (!Array.isArray(availableSlugs) || availableSlugs.length === 0) return true
  const slug = slugForChatgptWebModelKey(modelKey)
  if (slug) return availableSlugs.includes(slug)
  if (typeof modelKey === 'string' && !modelKey.includes('/')) {
    return availableSlugs.includes(modelKey)
  }
  return true
}

export function pickDefaultChatgptWebSlug({ currentSlug, availableSlugs }) {
  if (!Array.isArray(availableSlugs) || availableSlugs.length === 0) {
    return currentSlug || CHATGPT_WEB_DEFAULT_MODEL_SLUG
  }
  if (currentSlug && availableSlugs.includes(currentSlug)) return currentSlug
  if (availableSlugs.includes(CHATGPT_WEB_DEFAULT_MODEL_SLUG)) return CHATGPT_WEB_DEFAULT_MODEL_SLUG
  const chatKeys = chatgptWebChatModelKeys
    .map((key) => Models[key]?.value)
    .filter((slug) => slug && availableSlugs.includes(slug))
  return chatKeys[0] || availableSlugs[0]
}

export function pickDefaultChatgptWebKey({ currentKey, availableSlugs }) {
  const currentSlug = slugForChatgptWebModelKey(currentKey)
  const slug = pickDefaultChatgptWebSlug({ currentSlug, availableSlugs })
  return slug ? formatEngineSelection(L2_CHATGPT_WEB, slug) : currentKey || null
}
