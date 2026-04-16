export const CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS = Object.freeze(['gpt-5-4-pro'])

const EXTRA_THINKING_EFFORT_MODEL_SLUG_SET = new Set(CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS)

function normalizeChatgptWebModelSlug(model) {
  return typeof model === 'string' ? model.trim().toLowerCase() : ''
}

export function isChatgptWebThinkingModelSlug(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  return normalized.endsWith('-thinking')
}

export function needsChatgptWebThinkingEffort(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  return (
    normalized.endsWith('-thinking') || EXTRA_THINKING_EFFORT_MODEL_SLUG_SET.has(normalized)
  )
}

export function requiresChatgptWebExtendedThinkingEffort(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  return EXTRA_THINKING_EFFORT_MODEL_SLUG_SET.has(normalized)
}
