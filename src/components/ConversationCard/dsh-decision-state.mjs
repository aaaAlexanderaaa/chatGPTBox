/** Floating-window decision cards: collapse only after the harness accepted. */

function decisionKey(decision) {
  return `${decision.kind}:${decision.approvalId ?? decision.rpcId}`
}

/**
 * @param {object[]} prev
 * @param {object} decision
 * @param {{ accepted?: boolean } | null | undefined} receipt
 * @returns {object[]}
 */
export function decisionsAfterRespond(prev, decision, receipt) {
  if (receipt?.accepted !== true) return prev
  if (decision?.kind !== 'approval' && decision?.kind !== 'question') return prev
  const key = decisionKey(decision)
  return prev.filter((item) => decisionKey(item) !== key)
}

/** Core twin of the module helper — popup/floating cards cannot import module internals. */
export function cockpitHrefForSession(baseUrl, sessionId) {
  if (!sessionId || typeof baseUrl !== 'string') return baseUrl
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('session', sessionId)
    return url.href
  } catch {
    const join = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${join}session=${encodeURIComponent(sessionId)}`
  }
}

export function buildQuestionAnswers(questions, selected = {}, customById = {}) {
  return (questions || []).map((question) => ({
    id: question.id,
    selected: selected[question.id] || [],
    custom: !question.options && customById[question.id] ? customById[question.id] : undefined,
  }))
}
