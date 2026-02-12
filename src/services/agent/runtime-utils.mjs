const MAX_TOOL_ALIAS_LENGTH = 64

function sanitizeAliasSegment(value, fallback) {
  const normalized = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || fallback
}

export function toToolAlias(serverId, toolName, index) {
  const safeServer = sanitizeAliasSegment(serverId, 'server')
  const safeTool = sanitizeAliasSegment(toolName, 'tool')
  const suffix = `_${String(index || 0)}`
  const base = `mcp_${safeServer}_${safeTool}`
  const maxBaseLength = Math.max(1, MAX_TOOL_ALIAS_LENGTH - suffix.length)
  return `${base.slice(0, maxBaseLength)}${suffix}`
}

export function shouldShortCircuitWithToolLoop(result, options = {}) {
  if (!result || typeof result !== 'object') return false
  if (result.status !== 'succeeded') return false
  if (options.requireToolUse === true && result.usedTools !== true) return false

  const answer = typeof result.answer === 'string' ? result.answer.trim() : ''
  if (options.allowEmptyAnswer === true) return true
  return Boolean(answer)
}
