import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from '../../config/limits.mjs'
import { Models, chatgptWebModelKeys } from '../../config/models.mjs'
import { grokSlugToModelKey, isGrokChatSlug } from '../../config/grok-web.mjs'

export function isGrokEngineKey(key) {
  return typeof key === 'string' && key.startsWith('grokWeb')
}

export function slugToModelKey(slug) {
  const normalized = (slug || '').trim()
  if (isGrokChatSlug(normalized)) {
    return grokSlugToModelKey(normalized)
  }
  for (const key of chatgptWebModelKeys) {
    if (Models[key] && Models[key].value === normalized) return key
  }
  if (Models[normalized]) return normalized
  return CHATGPT_WEB_DEFAULT_MODEL_KEY
}
