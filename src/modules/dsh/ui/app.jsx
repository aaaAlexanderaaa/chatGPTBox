import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useGatewayPort } from './adapter/useGatewayPort.js'
import { canCompose, groupSessionsForSidebar } from './models/sidebar-model.mjs'
import { defaultPresetId, pickerPresets } from './models/preset-model.mjs'
import { resolveCockpitSelection } from '../session-pick.mjs'
import { PresetSelect } from './chrome/PresetSelect.jsx'
import { WorkspaceEmpty } from './chrome/WorkspaceEmpty.jsx'
import { Header } from './shell/Header.jsx'
import { Sidebar } from './shell/Sidebar.jsx'
import { SessionHeader } from './shell/SessionHeader.jsx'
import { Shell } from './shell/Shell.jsx'
import { Composer } from './Composer.jsx'
import { getPage } from './pages/registry.mjs'
import { newestPendingDecision } from '../turn-fold.mjs'
import './pages/conversation/index.mjs'

function useNarrowLayout(breakpoint = 520) {
  const [narrow, setNarrow] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${breakpoint}px)`).matches
      : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const listener = (event) => setNarrow(event.matches)
    query.addEventListener?.('change', listener)
    return () => query.removeEventListener?.('change', listener)
  }, [breakpoint])
  return narrow
}

function flattenSidebarRows({ groups, ungrouped }) {
  const rows = []
  for (const { workspace, sessions } of groups) {
    for (const session of sessions) {
      rows.push({
        sessionId: session.sessionId,
        workspaceId: workspace.workspaceId,
        label: `${workspace.title || workspace.path || workspace.workspaceId} · ${
          session.title || (session.blank ? 'Untitled' : session.sessionId.slice(0, 8))
        }`,
        session,
      })
    }
  }
  for (const session of ungrouped) {
    rows.push({
      sessionId: session.sessionId,
      workspaceId: null,
      label: session.title || (session.blank ? 'Untitled' : session.sessionId.slice(0, 8)),
      session,
    })
  }
  return rows
}

export function App() {
  const { connection, sessions, sessionUpdates, workspaces, rpc, subscribeLedger } =
    useGatewayPort()
  const narrow = useNarrowLayout()

  const merged = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.sessionId, s]))
    for (const [id, update] of Object.entries(sessionUpdates)) {
      byId.set(id, { ...(byId.get(id) || { sessionId: id }), ...update })
    }
    return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [sessions, sessionUpdates])

  const workspaceItems = workspaces?.items || []
  const archivedSessionIds = workspaces?.archivedSessionIds || []

  const sidebarModel = useMemo(
    () =>
      groupSessionsForSidebar({
        workspaces: workspaceItems,
        sessions: merged,
        archivedSessionIds,
      }),
    [workspaceItems, merged, archivedSessionIds],
  )
  const flatRows = useMemo(() => flattenSidebarRows(sidebarModel), [sidebarModel])

  const requestedId =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('session')
      : null
  const [selectedId, setSelectedId] = useState(null)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null)
  const [activePage, setActivePage] = useState('conversation')
  const [presetList, setPresetList] = useState(null)
  const [presetId, setPresetId] = useState(null)
  const [pickerError, setPickerError] = useState(null)
  const [ledger, setLedger] = useState({ blocks: [], lastSeq: -1 })
  const [diagnosis, setDiagnosis] = useState(null)
  const searchRef = useRef(null)
  const composerRef = useRef(null)
  const userPickedRef = useRef(false)

  const selectSession = useCallback((sessionId) => {
    if (!sessionId) return
    userPickedRef.current = true
    setSelectedId(sessionId)
    setActivePage('conversation')
  }, [])

  useEffect(() => {
    const next = resolveCockpitSelection({
      sessions: merged,
      requestedId,
      currentId: selectedId,
      userPicked: userPickedRef.current,
    })
    if (next && next !== selectedId) setSelectedId(next)
  }, [merged, selectedId, requestedId])

  useEffect(() => {
    if (selectedWorkspaceId && workspaceItems.some((w) => w.workspaceId === selectedWorkspaceId)) {
      return
    }
    const fromSession = flatRows.find((row) => row.sessionId === selectedId)?.workspaceId
    const fallback = fromSession || workspaceItems[0]?.workspaceId || null
    if (fallback !== selectedWorkspaceId) setSelectedWorkspaceId(fallback)
  }, [workspaceItems, selectedWorkspaceId, selectedId, flatRows])

  useEffect(() => {
    if (connection.status !== 'online') return
    let cancelled = false
    void rpc('agentPreset.list')
      .then((list) => {
        if (cancelled) return
        setPresetList(list)
        setPresetId((current) => current || defaultPresetId(list))
      })
      .catch(() => {
        if (!cancelled) setPresetList({ presets: [] })
      })
    return () => {
      cancelled = true
    }
  }, [connection.status, rpc])

  const selected = merged.find((s) => s.sessionId === selectedId) || null

  useEffect(() => {
    if (!selectedId) return
    setLedger({ blocks: [], lastSeq: -1 })
    return subscribeLedger(selectedId, (message) => {
      if (message.sessionId === selectedId)
        setLedger({ blocks: message.blocks, lastSeq: message.lastSeq })
    })
  }, [selectedId, subscribeLedger])

  const addWorkspace = useCallback(async () => {
    setPickerError(null)
    try {
      const path = await rpc('host.pickDirectory')
      if (path) await rpc('workspace.create', { path })
    } catch (error) {
      if (error?.message === 'directory-picker-unavailable') {
        setPickerError('directory-picker-unavailable')
      }
    }
  }, [rpc])

  const createSession = useCallback(async () => {
    if (!selectedWorkspaceId) return
    try {
      const args = { workspaceId: selectedWorkspaceId }
      const roster = pickerPresets(presetList)
      if (roster.length > 0) {
        args.agentPreset = presetId || defaultPresetId(presetList)
      }
      const value = await rpc('session.create', args)
      selectSession(value.sessionId)
      composerRef.current?.focus()
    } catch {
      // surfaced through the connection state
    }
  }, [rpc, selectSession, selectedWorkspaceId, presetList, presetId])

  const respondDecision = useCallback(
    async (kind, payload) => {
      try {
        await rpc(kind === 'approval' ? 'approval.respond' : 'question.respond', payload)
      } catch {
        // late/failed answers stay visible — the card's state is the truth
      }
    },
    [rpc],
  )

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const inEditable =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (event.key === 'Escape' && inEditable) {
        target.blur()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return
      if (inEditable || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'j' || event.key === 'k') {
        const index = merged.findIndex((s) => s.sessionId === selectedId)
        const next = merged[index + (event.key === 'j' ? 1 : -1)]
        if (next) selectSession(next.sessionId)
        return
      }
      if (!selected) return
      if (event.key === 'a' || event.key === 'r') {
        const pending = newestPendingDecision(ledger.blocks)
        if (!pending) return
        event.preventDefault()
        if (pending.kind === 'approval') {
          void respondDecision('approval', {
            rpcId: pending.rpcId,
            sessionId: selected.sessionId,
            approvalId: pending.approvalId,
            outcome: event.key === 'a' ? 'allowed-once' : 'rejected',
          })
        } else if (event.key === 'r') {
          void rpc('question.cancel', { rpcId: pending.rpcId, sessionId: selected.sessionId })
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [merged, selected, selectedId, ledger, respondDecision, rpc, selectSession])

  const waitingTotal = merged.reduce((sum, s) => sum + (s.waiting || 0), 0)
  const online = connection.status === 'online'
  const composeOk = canCompose({
    workspaceCount: workspaceItems.length,
    selectedWorkspaceId,
  })

  const runDiagnose = useCallback(async () => {
    setDiagnosis({ running: true })
    try {
      setDiagnosis(await rpc('gateway.diagnoseFull'))
    } catch (error) {
      setDiagnosis({ ok: false, stage: 'port', message: error.message })
    }
  }, [rpc])

  const page = getPage(activePage)
  const ConversationPage = getPage('conversation')?.render

  let main = null
  if (!online) {
    main = <OfflineState connection={connection} diagnosis={diagnosis} onDiagnose={runDiagnose} />
  } else if (!composeOk) {
    main = <WorkspaceEmpty onAdd={addWorkspace} pickerError={pickerError} />
  } else if (activePage === 'settings') {
    const SettingsPage = page?.render
    main = SettingsPage ? (
      <SettingsPage rpc={rpc} />
    ) : (
      <div className="dsh-empty" aria-hidden="true" />
    )
  } else if (!selected) {
    main = (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-3">
          <PresetSelect
            list={presetList}
            session={{ blank: true }}
            value={presetId}
            onChange={setPresetId}
          />
        </div>
        <div className="dsh-empty">
          <p>No sessions yet</p>
          <button type="button" onClick={createSession}>
            New session
          </button>
        </div>
      </div>
    )
  } else {
    main = (
      <>
        <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-3">
          <PresetSelect
            list={presetList}
            session={selected}
            value={presetId}
            onChange={setPresetId}
          />
        </div>
        <SessionHeader session={selected} rpc={rpc} onSelect={selectSession} />
        {ConversationPage ? (
          <ConversationPage
            session={selected}
            blocks={ledger.blocks}
            onRespond={respondDecision}
            rpc={rpc}
          />
        ) : null}
        <Composer apiRef={composerRef} session={selected} rpc={rpc} />
      </>
    )
  }

  return (
    <Shell
      header={
        <Header
          connection={connection}
          waitingCount={waitingTotal}
          onOpenSettings={() => setActivePage('settings')}
          onWaitingClick={() => {
            const target = merged.find((s) => s.waiting > 0)
            if (target) selectSession(target.sessionId)
          }}
        />
      }
      sidebar={
        narrow ? null : (
          <Sidebar
            workspaces={workspaceItems}
            sessions={merged}
            archivedSessionIds={archivedSessionIds}
            selectedId={selectedId}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelect={selectSession}
            onSelectWorkspace={setSelectedWorkspaceId}
            onNewSession={createSession}
            searchRef={searchRef}
            rpc={rpc}
          />
        )
      }
    >
      {narrow && composeOk && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <select
            className="w-full text-xs bg-secondary border border-border rounded-md px-1.5 py-1"
            value={selectedId || ''}
            onChange={(event) => {
              const row = flatRows.find((entry) => entry.sessionId === event.target.value)
              if (row?.workspaceId) setSelectedWorkspaceId(row.workspaceId)
              selectSession(event.target.value)
            }}
            title="Switch session"
          >
            {flatRows.map((row) => (
              <option key={row.sessionId} value={row.sessionId}>
                {row.session.waiting > 0 ? '◐ ' : row.session.running ? '● ' : '○ '}
                {row.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {main}
    </Shell>
  )
}

function OfflineState({ connection, diagnosis, onDiagnose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertTriangle size={28} className="text-red-500" />
      <p className="text-sm font-medium">The harness is unreachable</p>
      <p className="text-xs text-muted-foreground font-mono">{connection.endpoint}</p>
      <p className="text-xs text-muted-foreground max-w-md">
        {connection.lastError ||
          'Is `dsh web` running? The session list lives on the engine side, so an offline engine shows no list.'}
      </p>
      {diagnosis && !diagnosis.running && (
        <pre className="text-xs text-left bg-secondary rounded-md p-3 max-w-md overflow-auto">
          {JSON.stringify(diagnosis, null, 2)}
        </pre>
      )}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-secondary"
        onClick={onDiagnose}
      >
        <Loader2 size={14} className={diagnosis?.running ? 'animate-spin' : 'hidden'} /> Run
        diagnosis
      </button>
    </div>
  )
}
