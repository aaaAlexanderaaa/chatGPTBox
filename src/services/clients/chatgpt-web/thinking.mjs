export const CHATGPT_WEB_THINKING_EFFORTS = Object.freeze([
  'min',
  'standard',
  'extended',
  'xhigh',
  'max',
])

export const CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS = Object.freeze([
  'gpt-5-5-pro',
  'gpt-5-4-pro',
])

const EXTRA_THINKING_EFFORT_MODEL_SLUG_SET = new Set(CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS)
const THINKING_EFFORT_SET = new Set(CHATGPT_WEB_THINKING_EFFORTS)

/**
 * Chat Pro lanes only advertise a subset of efforts.
 * Chat Thinking has no `xhigh` (that gear is Work-only).
 * Work (`*-wm`) keeps the full slider, including `xhigh` on `/tpp/models/`.
 */
const CHAT_THINKING_EFFORTS = Object.freeze(['min', 'standard', 'extended', 'max'])
const THINKING_EFFORTS_BY_SLUG = Object.freeze({
  'gpt-6-pro': Object.freeze(['standard']),
  'gpt-5-6-pro': Object.freeze(['standard']),
  'gpt-5-5-pro': Object.freeze(['standard', 'extended']),
  'gpt-5-4-pro': Object.freeze(['standard', 'extended']),
})

function normalizeChatgptWebModelSlug(model) {
  return typeof model === 'string' ? model.trim().toLowerCase() : ''
}

export function isChatgptWebWorkModelSlug(model) {
  return normalizeChatgptWebModelSlug(model).endsWith('-wm')
}

export function isChatgptWebThinkingEffort(value) {
  return THINKING_EFFORT_SET.has(value)
}

export function getChatgptWebThinkingEffortOverride(payload = {}) {
  const value = payload.thinkingEffort ?? payload.thinking_effort ?? payload.reasoning_effort
  if (value == null || value === '') return undefined
  const effort = typeof value === 'string' ? value.trim() : value
  if (!isChatgptWebThinkingEffort(effort)) {
    throw new Error(
      'reasoning_effort/thinking_effort must be one of: min, standard, extended, xhigh, max',
    )
  }
  return effort
}

export function thinkingEffortsForChatgptWebModel(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  if (THINKING_EFFORTS_BY_SLUG[normalized]) return THINKING_EFFORTS_BY_SLUG[normalized]
  if (isChatgptWebWorkModelSlug(normalized)) return CHATGPT_WEB_THINKING_EFFORTS
  if (normalized.endsWith('-thinking')) return CHAT_THINKING_EFFORTS
  return CHATGPT_WEB_THINKING_EFFORTS
}

export function clampChatgptWebThinkingEffort(model, effort) {
  const allowed = thinkingEffortsForChatgptWebModel(model)
  if (allowed.includes(effort)) return effort
  return allowed[allowed.length - 1] || null
}

export function isChatgptWebThinkingModelSlug(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  return (
    normalized.endsWith('-thinking') ||
    normalized.endsWith('-t-mini') ||
    isChatgptWebWorkModelSlug(normalized)
  )
}

export function needsChatgptWebThinkingEffort(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  if (!normalized) return false
  // Chat Instant / Auto / Mini do not take thinking_effort.
  // Deferred (medium, no current impact): keep in view, do not fix yet.
  // `endsWith('-mini')` also matches `-t-mini`. Official catalogs omit
  // thinking_effort there (correct), but every live poll / gateway-timeout /
  // multi-turn path uses this helper, so Thinking Mini is treated as Instant.
  if (normalized.endsWith('-instant') || normalized.endsWith('-mini')) return false
  return (
    normalized.endsWith('-thinking') ||
    isChatgptWebWorkModelSlug(normalized) ||
    (normalized.startsWith('gpt-') && normalized.endsWith('-pro')) ||
    EXTRA_THINKING_EFFORT_MODEL_SLUG_SET.has(normalized)
  )
}

export function requiresChatgptWebExtendedThinkingEffort(model) {
  const normalized = normalizeChatgptWebModelSlug(model)
  return EXTRA_THINKING_EFFORT_MODEL_SLUG_SET.has(normalized)
}
