export function emptyPortState() {
  return {
    connection: { status: 'connecting', endpoint: '', version: null, lastError: null, home: null },
    sessions: [],
    sessionUpdates: {},
    workspaces: { items: [], archivedSessionIds: [] },
  }
}

export function applyPortMessage(state, message) {
  if (!message || typeof message !== 'object') return state
  switch (message.type) {
    case 'hello':
    case 'connection':
      return {
        ...state,
        connection: {
          status: message.status,
          endpoint: message.endpoint,
          version: message.version,
          lastError: message.lastError,
          home: message.home ?? null,
        },
      }
    case 'sessions':
      return { ...state, sessions: message.items || [], sessionUpdates: {} }
    case 'session':
      return {
        ...state,
        sessionUpdates: {
          ...state.sessionUpdates,
          [message.summary.sessionId]: message.summary,
        },
      }
    case 'workspaces':
      return {
        ...state,
        workspaces: {
          items: message.items || [],
          archivedSessionIds: message.archivedSessionIds || [],
        },
      }
    default:
      return state
  }
}
