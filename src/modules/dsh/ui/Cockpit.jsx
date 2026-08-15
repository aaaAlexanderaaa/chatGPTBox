import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AlertTriangle, CircleDot, Loader2, Plus, RefreshCw } from 'lucide-react'
import { useGatewayPort } from './useGatewayPort.js'
import { Sidebar } from './Sidebar.jsx'
import { SessionBar } from './SessionBar.jsx'
import { Ledger } from './Ledger.jsx'
import { Composer } from './Composer.jsx'

// Full-page cockpit per ui-console.md: global header (identity + health +
// waiting pill), sidebar (session list + search), session bar (title / model /
// auto-approve), ledger (three registers), composer.

export function Cockpit() {
  const { connection, sessions, sessionUpdates, rpc, subscribeLedger } = useGatewayPort()

  const merged = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.sessionId, s]))
    for (const [id, update] of Object.entries(sessionUpdates)) {
      byId.set(id, { ...(byId.get(id) || { sessionId: id }), ...update })
    }
    return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [sessions, sessionUpdates])

  const [selectedId, setSelectedId] = useState(null)
  const [ledger, setLedger] = useState({ blocks: [], lastSeq: -1 })
  const [diagnosis, setDiagnosis] = useState(null)
  const searchRef = useRef(null)
  const composerRef = useRef(null)

  useEffect(() => {
    if (!selectedId && merged.length > 0) setSelectedId(merged.find((s) => !s.blank)?.sessionId ?? merged[0].sessionId)
  }, [merged, selectedId])

  const selected = merged.find((s) => s.sessionId === selectedId) || null

  // Ledger subscription follows the selected session.
  useEffect(() => {
    if (!selectedId) return
    setLedger({ blocks: [], lastSeq: -1 })
    return subscribeLedger(selectedId, (message) => {
      if (message.sessionId === selectedId) setLedger({ blocks: message.blocks, lastSeq: message.lastSeq })
    })
  }, [selectedId, subscribeLedger])

  const createSession = useCallback(async () => {
    try {
      const value = await rpc('session.create')
      setSelectedId(value.sessionId)
      composerRef.current?.focus()
    } catch {
      // surfaced through the connection state; nothing else to do honestly
    }
  }, [rpc])

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

  // Keyboard: j/k move, Enter open, a/r decide, / search, ⌘↩ send.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const inEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (event.key === 'Escape' && inEditable) {
        target.blur()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return // composer handles its own
      if (inEditable || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'j' || event.key === 'k') {
        const index = merged.findIndex((s) => s.sessionId === selectedId)
        const next = merged[index + (event.key === 'j' ? 1 : -1)]
        if (next) setSelectedId(next.sessionId)
        return
      }
      if (!selected) return
      if (event.key === 'a' || event.key === 'r') {
        // Direct decision on the newest pending card of the open session.
        const pending = ledger.blocks.find(
          (block) =>
            (block.kind === 'approval' || block.kind === 'question') && block.status === 'pending' && block.rpcId,
        )
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
  }, [merged, selected, selectedId, ledger, respondDecision, rpc])

  const waitingTotal = merged.reduce((sum, s) => sum + (s.waiting || 0), 0)
  const online = connection.status === 'online'

  const runDiagnose = useCallback(async () => {
    setDiagnosis({ running: true })
    try {
      setDiagnosis(await rpc('gateway.diagnoseFull'))
    } catch (error) {
      setDiagnosis({ ok: false, stage: 'port', message: error.message })
    }
  }, [rpc])

  return (
    <div className="dsh-app">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-border bg-card shrink-0">
        <span className="font-semibold text-sm">◆ DeepSeek Harness</span>
        <CircleDot
          size={12}
          className={online ? 'text-emerald-500' : 'text-red-500'}
          aria-label={online ? 'online' : connection.status}
        />
        <span className="text-xs text-muted-foreground truncate">
          {connection.endpoint}
          {connection.version ? ` · v${connection.version}` : ''}
        </span>
        {!online && (
          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={runDiagnose}>
            <RefreshCw size={12} className={diagnosis?.running ? 'animate-spin' : ''} /> diagnose
          </button>
        )}
        {waitingTotal > 0 && (
          <button
            className="ml-auto text-xs font-medium rounded-full px-3 py-1 border"
            style={{ borderColor: 'var(--dsh-waiting-approval)', color: 'var(--dsh-waiting-approval)' }}
            onClick={() => {
              const target = merged.find((s) => s.waiting > 0)
              if (target) setSelectedId(target.sessionId)
            }}
          >
            {waitingTotal} waiting for you
          </button>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar
          sessions={merged}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={createSession}
          searchRef={searchRef}
          rpc={rpc}
        />

        <main className="flex-1 min-w-0 flex flex-col">
          {!online ? (
            <OfflineState connection={connection} diagnosis={diagnosis} onDiagnose={runDiagnose} onRetry={createSession} />
          ) : !selected ? (
            <EmptyState onCreate={createSession} />
          ) : (
            <>
              <SessionBar session={selected} rpc={rpc} />
              <Ledger session={selected} blocks={ledger.blocks} onRespond={respondDecision} rpc={rpc} />
              <Composer apiRef={composerRef} session={selected} rpc={rpc} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function EmptyState({ onCreate }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <p className="text-sm">No sessions yet</p>
      <button
        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
        onClick={onCreate}
      >
        <Plus size={14} /> New session
      </button>
      <p className="text-xs">Selection tools on any page can also dispatch work here (Phase B).</p>
    </div>
  )
}

function OfflineState({ connection, diagnosis, onDiagnose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertTriangle size={28} className="text-red-500" />
      <p className="text-sm font-medium">The harness is unreachable</p>
      <p className="text-xs text-muted-foreground font-mono">{connection.endpoint}</p>
      <p className="text-xs text-muted-foreground max-w-md">
        {connection.lastError || 'Is `dsh web` running? The session list lives on the engine side, so an offline engine shows no list.'}
      </p>
      {diagnosis && !diagnosis.running && (
        <pre className="text-xs text-left bg-secondary rounded-md p-3 max-w-md overflow-auto">
          {JSON.stringify(diagnosis, null, 2)}
        </pre>
      )}
      <button
        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-secondary"
        onClick={onDiagnose}
      >
        <Loader2 size={14} className={diagnosis?.running ? 'animate-spin' : 'hidden'} /> Run diagnosis
      </button>
    </div>
  )
}
