/** Which cockpit session to open: explicit query, else a waiting row, else first real session. */
export function pickCockpitSessionId(sessions, requestedId) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null
  if (requestedId && sessions.some((session) => session.sessionId === requestedId)) {
    return requestedId
  }
  const waiting = sessions.find((session) => (session.waiting || 0) > 0)
  if (waiting) return waiting.sessionId
  return sessions.find((session) => !session.blank)?.sessionId ?? sessions[0].sessionId
}

export function canSelectCockpitSession(sessions, sessionId) {
  return (
    Boolean(sessionId) &&
    Array.isArray(sessions) &&
    sessions.some((session) => session.sessionId === sessionId)
  )
}

/** First-fit plus a late ?session= row. A manual pick is sticky. */
export function resolveCockpitSelection({
  sessions,
  requestedId,
  currentId,
  userPicked = false,
} = {}) {
  if (!userPicked && requestedId && canSelectCockpitSession(sessions, requestedId)) {
    return requestedId
  }
  if (currentId && canSelectCockpitSession(sessions, currentId)) return currentId
  return pickCockpitSessionId(sessions, userPicked ? null : requestedId)
}

export function cockpitUrlForSession(baseUrl, sessionId) {
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
