export function isGrokWebPrePostControlError(error) {
  const msg = error?.message || String(error || '')
  return (
    /Grok Web request already in progress/i.test(msg) ||
    /Grok proxy tab is unavailable/i.test(msg) ||
    /Content script could not be loaded/i.test(msg)
  )
}

export function grokPrePostStatus(message) {
  if (/Please login/i.test(message || '')) return 401
  if (/\b429\b/.test(message || '')) return 429
  return 400
}

export function grokPrePostRetryable(message) {
  return grokPrePostStatus(message) === 401
}
