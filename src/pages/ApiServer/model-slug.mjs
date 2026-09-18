import { CHATGPT_WEB_DEFAULT_MODEL_KEY, CHATGPT_WEB_DEFAULT_MODEL_SLUG } from '../../config/limits.mjs'
import { formatEngineSelection, L2_CHATGPT_WEB, L2_GROK_WEB } from '../../config/engine-selection.mjs'
import { grokSlugToModelKey, isGrokChatSlug } from '../../config/grok-web.mjs'

export function isGrokEngineKey(key) {
  if (typeof key !== 'string') return false
  if (key.startsWith(`${L2_GROK_WEB}/`)) return true
  return key.startsWith('grokWeb')
}

export function slugToModelKey(slug) {
  const normalized = (slug || '').trim()
  if (isGrokChatSlug(normalized)) {
    return formatEngineSelection(L2_GROK_WEB, normalized)
  }
  if (normalized.startsWith(`${L2_CHATGPT_WEB}/`) || normalized.startsWith(`${L2_GROK_WEB}/`)) {
    return normalized
  }
  if (normalized) return formatEngineSelection(L2_CHATGPT_WEB, normalized)
  return CHATGPT_WEB_DEFAULT_MODEL_KEY
}

export { grokSlugToModelKey, CHATGPT_WEB_DEFAULT_MODEL_SLUG }
