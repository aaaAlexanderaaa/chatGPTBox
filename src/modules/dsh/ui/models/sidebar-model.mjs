export function isSubagentSession(session) {
  return session?.origin === 'subagent'
}

export function canCompose({ workspaceCount, selectedWorkspaceId }) {
  return Boolean(selectedWorkspaceId) && Number(workspaceCount) > 0
}

export function groupSessionsForSidebar({
  workspaces = [],
  sessions = [],
  archivedSessionIds = [],
} = {}) {
  const archived = new Set(archivedSessionIds)
  const byId = new Map(
    sessions
      .filter((session) => session && !isSubagentSession(session) && !archived.has(session.sessionId))
      .map((session) => [session.sessionId, session]),
  )
  const groupedIds = new Set()
  const groups = workspaces.map((workspace) => {
    const rows = (workspace.sessionIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
    for (const row of rows) groupedIds.add(row.sessionId)
    return { workspace, sessions: rows }
  })
  const ungrouped = [...byId.values()].filter((session) => !groupedIds.has(session.sessionId))
  return { groups, ungrouped }
}
