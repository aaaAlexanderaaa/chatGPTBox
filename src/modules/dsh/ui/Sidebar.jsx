import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Plus, Search } from 'lucide-react'
import { canSelectCockpitSession } from '../session-pick.mjs'

// Sidebar: session list driven live by the host stream, plus search.
// Status colors (ui-console.md): ● blue running / ◐ amber waiting /
// ○ gray idle. Search filters by title locally and falls through to
// session.search for full-text with snippets.

function sessionDot(session) {
  if (session.waiting > 0) return { symbol: '◐', color: 'var(--dsh-waiting-approval)' }
  if (session.running) return { symbol: '●', color: 'var(--dsh-running)' }
  return { symbol: '○', color: 'var(--dsh-idle)' }
}

export function Sidebar({ sessions, selectedId, onSelect, onCreate, searchRef, rpc }) {
  const [query, setQuery] = useState('')
  const [remoteResults, setRemoteResults] = useState([]) // {sessionId, snippet}
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

  const titleFilter = query.trim().toLowerCase()
  const filtered = titleFilter
    ? sessions.filter((s) => (s.title || '').toLowerCase().includes(titleFilter))
    : sessions
  const remoteOnly = useMemo(() => {
    const known = new Set(sessions.map((s) => s.sessionId))
    return remoteResults.filter((result) => !known.has(result.sessionId))
  }, [remoteResults, sessions])

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
      <div className="p-2 flex gap-1.5">
        <button
          className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md bg-primary text-primary-foreground"
          onClick={onCreate}
        >
          <Plus size={13} /> New session
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
      <div className="dsh-scroll flex-1 p-1.5 flex flex-col gap-0.5">
        {filtered.map((session) => {
          const dot = sessionDot(session)
          return (
            <button
              key={session.sessionId}
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
            title="Engine-native session — open it in dsh web; the cockpit does not import foreign sessions"
          >
            <span className="truncate">{result.sessionId}</span>
            <span className="truncate text-[11px] opacity-75">{result.snippet}</span>
          </div>
        ))}
        {filtered.length === 0 && remoteOnly.length === 0 && query && (
          <p className="text-xs text-muted-foreground px-2 py-1.5">No matches.</p>
        )}
      </div>
    </aside>
  )
}
