import PropTypes from 'prop-types'
import { useEffect, useMemo, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ExternalLink, MessageSquare } from 'lucide-react'
import ConversationCard from '../components/ConversationCard'
import { useConfig } from '../hooks/use-config.mjs'
import { initSession } from '../services/init-session.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'

// Popup chat surface (roadmap B / D-19): the popup is first an unblocking
// surface — dsh waiting decisions pin to the top, answerable in two clicks
// from anywhere in the browser — and second a quick-ask chat for pages
// where the floating window cannot live. Draft autosave is a hard
// requirement: no keystroke is ever lost to a blur.

const DSH_PORT_NAME = 'dsh-gateway'

function useDshWaiting(enabled) {
  const [sessions, setSessions] = useState([])
  const [updates, setUpdates] = useState({})
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    if (!enabled) return
    let port
    let retryTimer = null
    let cancelled = false
    const connect = () => {
      if (cancelled) return
      try {
        port = Browser.runtime.connect({ name: DSH_PORT_NAME })
      } catch {
        return
      }
      port.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') return
        if (message.type === 'sessions') {
          setSessions(message.items || [])
          setUpdates({})
        } else if (message.type === 'session') {
          setUpdates((prev) => ({ ...prev, [message.summary.sessionId]: message.summary }))
        } else if (message.type === 'hello' || message.type === 'connection') {
          setStatus(message.status)
        }
      })
      port.onDisconnect.addListener(() => {
        if (cancelled) return
        retryTimer = setTimeout(connect, 1000)
      })
    }
    connect()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      try {
        port?.disconnect()
      } catch {
        // already gone
      }
    }
  }, [enabled])

  const merged = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.sessionId, s]))
    for (const [id, update] of Object.entries(updates)) {
      byId.set(id, { ...(byId.get(id) || { sessionId: id }), ...update })
    }
    return [...byId.values()]
  }, [sessions, updates])

  const waiting = merged.flatMap((session) =>
    (session.pendingDecisions || []).map((decision) => ({
      ...decision,
      sessionTitle: session.title || session.sessionId.slice(0, 8),
    })),
  )
  return { waiting, status }
}

function WaitingCard({ decision, sessionTitle }) {
  const { t } = useTranslation()
  const amber = '#d97706'
  const respond = (outcome) => {
    void Browser.runtime
      .sendMessage({
        type: RuntimeMessage.DshModuleRespond,
        data: {
          kind: 'approval',
          rpcId: decision.rpcId,
          sessionId: decision.sessionId,
          approvalId: decision.approvalId,
          outcome,
        },
      })
      .catch(() => {})
  }

  return (
    <div
      className="rounded-lg border p-2.5"
      style={{ borderColor: amber, background: 'rgba(217, 119, 6, 0.07)' }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: amber }}>
        <AlertTriangle size={13} />
        {decision.kind === 'approval'
          ? `${t('Waiting for you')} · ${decision.toolName}`
          : t('The agent is asking')}
        <span className="font-normal text-muted-foreground truncate ml-auto">{sessionTitle}</span>
      </div>
      {decision.kind === 'approval' && (
        <pre className="mt-1.5 mb-2 max-h-24 overflow-auto text-[11px] whitespace-pre-wrap bg-secondary rounded-md p-1.5">
          {decision.args || '(arguments not captured)'}
        </pre>
      )}
      {decision.kind === 'question' && (
        <p className="mt-1.5 mb-2 text-xs">
          {(decision.questions || []).map((q) => q.question).join(' / ') ||
            t('Open the cockpit to answer')}
        </p>
      )}
      {decision.kind === 'approval' ? (
        <div className="flex gap-2">
          <button
            className="text-xs px-2.5 py-1 rounded-md text-white"
            style={{ background: amber }}
            onClick={() => respond('allowed-once')}
          >
            {t('Allow once')} (a)
          </button>
          <button
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
            onClick={() => respond('rejected')}
          >
            {t('Reject')} (r)
          </button>
          <a
            href={Browser.runtime.getURL('dsh.html')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground self-center ml-auto inline-flex items-center gap-1"
          >
            <ExternalLink size={11} /> {t('Cockpit')}
          </a>
        </div>
      ) : (
        <a
          href={Browser.runtime.getURL('dsh.html')}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ExternalLink size={11} /> {t('Answer in the cockpit')}
        </a>
      )}
    </div>
  )
}

WaitingCard.propTypes = {
  decision: PropTypes.object.isRequired,
  sessionTitle: PropTypes.string.isRequired,
}

export function ChatPanel() {
  const { t } = useTranslation()
  const config = useConfig()
  const dshEnabled = config.dshModuleEnabled === true
  const { waiting, status } = useDshWaiting(dshEnabled)
  const [session, setSession] = useState(null)

  useEffect(() => {
    if (!config.modelName && !config.apiMode) return
    setSession(
      initSession({
        modelName: config.modelName,
        apiMode: config.apiMode,
        extraCustomModelName: config.customModelName,
      }),
    )
  }, [config.modelName, config.apiMode, config.customModelName])

  return (
    <div className="flex flex-col h-full">
      {dshEnabled && waiting.length > 0 && (
        <div className="px-3 pt-3 space-y-2 shrink-0">
          {waiting.map((decision) => (
            <WaitingCard
              key={`${decision.kind}:${decision.approvalId ?? decision.rpcId}`}
              decision={decision}
              sessionTitle={decision.sessionTitle}
            />
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 chatgptbox-container">
        {session && (
          <ConversationCard
            session={session}
            notClampSize={true}
            pageMode={true}
            draftKey="popup-draft"
          />
        )}
      </div>

      {dshEnabled && status !== 'online' && waiting.length === 0 && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground shrink-0">
          <MessageSquare size={11} className="inline mr-1" />
          {t('DeepSeek Harness is offline — quick ask uses your default engine.')}
        </p>
      )}
    </div>
  )
}
