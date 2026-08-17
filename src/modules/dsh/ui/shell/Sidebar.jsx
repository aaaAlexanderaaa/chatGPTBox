import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Plus, Search } from 'lucide-react'
import { canSelectCockpitSession } from '../../session-pick.mjs'
import { groupSessionsForSidebar } from '../models/sidebar-model.mjs'

function sessionDot(session) {
  if (session.waiting > 0) return { symbol: '◐', color: 'var(--dsh-waiting-approval)' }
  if (session.running) return { symbol: '●', color: 'var(--dsh-running)' }
  return { symbol: '○', color: 'var(--dsh-idle)' }
}

export function Sidebar({
  workspaces = [],
  sessions = [],
  archivedSessionIds = [],
  selectedId,
  selectedWorkspaceId,
  onSelect,
  onSelectWorkspace,
  onNewSession,
  searchRef,
  rpc,
}) {
  const [query, setQuery] = useState('')
  const [remoteResults, setRemoteResults] = useState([])
  const debounceRef = useRef(null)

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  const onQuery = (value) => {
    setQuery(value)
    clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setRemoteResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      void rpc('session.search', { query: value.trim() })
        .then((value2) => setRemoteResults(value2?.items || []))
        .catch(() => setRemoteResults([]))
    }, 250)
  }

  const { groups, ungrouped } = useMemo(
    () =>
      groupSessionsForSidebar({
        workspaces,
        sessions,
        archivedSessionIds,
      }),
    [workspaces, sessions, archivedSessionIds],
  )

  const titleFilter = query.trim().toLowerCase()
  const filterSession = (session) =>
    !titleFilter || (session.title || '').toLowerCase().includes(titleFilter)

  const remoteOnly = useMemo(() => {
    const known = new Set(sessions.map((s) => s.sessionId))
    return remoteResults.filter((result) => !known.has(result.sessionId))
  }, [remoteResults, sessions])

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
      <div className="p-2 flex gap-1.5">
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md bg-primary text-primary-foreground"
          onClick={() => onNewSession?.()}
          title="New session"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="px-2 pb-2 flex items-center gap-1.5 text-muted-foreground border-b border-border">
        <Search size={13} className="shrink-0" />
        <input
          ref={searchRef}
          className="w-full bg-transparent text-xs py-1.5 outline-none placeholder:text-muted-foreground"
          placeholder="Search sessions  /"
          value={query}
          onInput={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="dsh-scroll flex-1 p-1.5 flex flex-col gap-1">
        {groups.map(({ workspace, sessions: rows }) => {
          const visible = rows.filter(filterSession)
          return (
            <details
              key={workspace.workspaceId}
              open
              className="text-xs"
              onToggle={(event) => {
                if (event.target.open) onSelectWorkspace?.(workspace.workspaceId)
              }}
            >
              <summary
                className={`cursor-pointer px-2 py-1.5 rounded-md truncate ${
                  workspace.workspaceId === selectedWorkspaceId
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60'
                }`}
                onClick={() => onSelectWorkspace?.(workspace.workspaceId)}
                title={workspace.path || workspace.title || workspace.workspaceId}
              >
                {workspace.title || workspace.path || workspace.workspaceId}
              </summary>
              <div className="flex flex-col gap-0.5 pl-1 mt-0.5">
                {visible.map((session) => {
                  const dot = sessionDot(session)
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded-md ${
                        session.sessionId === selectedId
                          ? 'bg-secondary text-foreground'
                          : 'hover:bg-secondary/60 text-muted-foreground'
                      }`}
                      onClick={() => {
                        onSelectWorkspace?.(workspace.workspaceId)
                        if (canSelectCockpitSession(sessions, session.sessionId)) {
                          onSelect(session.sessionId)
                        }
                      }}
                      title={session.cwd || session.sessionId}
                    >
                      <span style={{ color: dot.color }}>{dot.symbol}</span>
                      <span className="truncate flex-1">
                        {session.title || session.blank
                          ? session.title || 'Untitled'
                          : session.sessionId}
                      </span>
                      {session.waiting > 0 && (
                        <span style={{ color: 'var(--dsh-waiting-approval)' }}>
                          ⧗{session.waiting}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </details>
          )
        })}
        {ungrouped.filter(filterSession).map((session) => {
          const dot = sessionDot(session)
          return (
            <button
              key={session.sessionId}
              type="button"
              className={`flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded-md ${
                session.sessionId === selectedId
                  ? 'bg-secondary text-foreground'
                  : 'hover:bg-secondary/60 text-muted-foreground'
              }`}
              onClick={() => {
                if (canSelectCockpitSession(sessions, session.sessionId)) {
                  onSelect(session.sessionId)
                }
              }}
              title={session.cwd || session.sessionId}
            >
              <span style={{ color: dot.color }}>{dot.symbol}</span>
              <span className="truncate flex-1">
                {session.title || session.blank ? session.title || 'Untitled' : session.sessionId}
              </span>
              {session.waiting > 0 && (
                <span style={{ color: 'var(--dsh-waiting-approval)' }}>⧗{session.waiting}</span>
              )}
            </button>
          )
        })}
        {remoteOnly.map((result) => (
          <div
            key={`remote-${result.sessionId}`}
            className="flex flex-col text-left text-xs px-2 py-1.5 rounded-md text-muted-foreground"
            title="Engine-native session — this list does not import it"
          >
            <span className="truncate">{result.sessionId}</span>
            <span className="truncate text-[11px] opacity-75">{result.snippet}</span>
          </div>
        ))}
        {titleFilter &&
          groups.every(({ sessions: rows }) => rows.filter(filterSession).length === 0) &&
          ungrouped.filter(filterSession).length === 0 &&
          remoteOnly.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1.5">No matches.</p>
          )}
      </div>
    </aside>
  )
}
