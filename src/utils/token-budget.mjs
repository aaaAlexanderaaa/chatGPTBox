const DEFAULT_CHARS_PER_TOKEN = 4

function normalizeNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function estimateTokenCount(text, options = {}) {
  const source = typeof text === 'string' ? text : ''
  if (!source) return 0
  const charsPerToken = normalizeNumber(options.charsPerToken, DEFAULT_CHARS_PER_TOKEN)
  return Math.max(1, Math.ceil(source.length / charsPerToken))
}

export function truncateToTokenBudget(text, maxTokens, options = {}) {
  const source = typeof text === 'string' ? text : ''
  const tokenLimit = normalizeNumber(maxTokens, 0)
  if (!source || !tokenLimit) return ''

  const suffix = typeof options.suffix === 'string' ? options.suffix : '\n...[truncated]'
  const charsPerToken = normalizeNumber(options.charsPerToken, DEFAULT_CHARS_PER_TOKEN)
  const maxChars = Math.max(0, Math.floor(tokenLimit * charsPerToken))
  if (source.length <= maxChars) return source

  const suffixChars = suffix.length
  if (maxChars <= suffixChars + 1) return source.slice(0, maxChars)
  return source.slice(0, maxChars - suffixChars) + suffix
}

export function clampTokenBudget(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}
