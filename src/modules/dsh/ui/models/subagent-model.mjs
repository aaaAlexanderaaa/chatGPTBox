export function childSessions(parentSessionId, sessions = []) {
  return sessions.filter(
    (session) =>
      session.origin === 'subagent' &&
      (session.parentSessionId === parentSessionId || session.parentId === parentSessionId),
  )
}
