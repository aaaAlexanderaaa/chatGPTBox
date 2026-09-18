import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ArrowDown, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { previewToolArgs } from '../../../turn-fold.mjs'
import { feedbackSubmitListed } from '../../models/feedback-model.mjs'

// Conversation flow on fold blocks: assistant prose, expandable tool rows,
// and decision cards (approval/question — the loudest element).
//
// Contracts honored here: a running tool row is the status line (no silent
// period without one); turn endings always get their note; full arguments
// are always directly visible on decision cards; autoscroll follows only
// when the user is already at the bottom.

function statusSymbol(status) {
  if (status === 'running') return <span className="dsh-status-running">◌</span>
  if (status === 'done') return <Check size={13} className="text-emerald-500 shrink-0" />
  if (status === 'error') return <X size={13} className="text-red-500 shrink-0" />
  return <span className="text-muted-foreground">⊘</span>
}

function formatDuration(ms) {
  if (ms == null) return ''
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`
}

function ToolRow({ block, onInspect }) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (block.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [block.status])

  const duration =
    block.status === 'running'
      ? block.startedAt
        ? formatDuration(now - block.startedAt)
        : ''
      : formatDuration((block.endedAt ?? 0) - (block.startedAt ?? 0))

  return (
    <div className="py-0.5">
      <div
        className="dsh-machine-row"
        role="button"
        tabIndex={-1}
        onClick={() => setExpanded((value) => !value)}
        data-status={block.status}
      >
        {expanded ? (
          <ChevronDown size={13} className="shrink-0" />
        ) : (
          <ChevronRight size={13} className="shrink-0" />
        )}
        <span className="shrink-0">🔧 {block.name}</span>
        <span className="dsh-args-preview">{previewToolArgs(block.args)}</span>
        {duration && <span className="shrink-0 text-muted-foreground">{duration}</span>}
        <span className="shrink-0">{statusSymbol(block.status)}</span>
        {onInspect && (
          <button
            type="button"
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground px-1"
            onClick={(event) => {
              event.stopPropagation()
              onInspect(block)
            }}
          >
            Inspect
          </button>
        )}
      </div>
      {expanded && (
        <div className="dsh-machine-detail my-1">
          <div>
            <span className="text-muted-foreground">args </span>
            {block.args}
          </div>
          {block.resultText != null && (
            <div className={block.status === 'error' ? 'text-red-500' : ''}>
              <span className="text-muted-foreground">result </span>
              {block.resultText || '(empty)'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApprovalCard({ block, toolCall, onRespond, onSessionAuto, autoApprove }) {
  const { t } = useTranslation()
  const settled = block.status !== 'pending'
  return (
    <div
      className="dsh-decision-card my-3"
      data-kind="approval"
      data-settled={settled}
      tabIndex={-1}
    >
      <div
        className="flex items-center gap-2 text-xs font-semibold"
        style={{ color: 'var(--dsh-waiting-approval)' }}
      >
        ⚠ {settled ? `Decision · ${block.toolName}` : `Waiting for you · ${block.toolName}`}
      </div>
      <div className="dsh-decision-args my-2">
        {toolCall ? toolCall.args : t('(arguments not captured)')}
      </div>
      {block.reason && <p className="text-xs text-muted-foreground mb-2">{block.reason}</p>}
      {settled ? (
        <p className="text-xs text-muted-foreground">
          {block.status === 'allowed-once'
            ? t('✓ Allowed')
            : block.status === 'rejected'
            ? t('✗ Rejected — the tool did not run')
            : `· ${block.status}`}
        </p>
      ) : (
        <div className="dsh-decision-actions">
          <button
            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
            onClick={() =>
              onRespond('approval', {
                rpcId: block.rpcId,
                sessionId: block.sessionId,
                approvalId: block.approvalId,
                outcome: 'allowed-once',
              })
            }
          >
            {t('Allow once (a)')}
          </button>
          <button
            className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-secondary"
            onClick={() =>
              onRespond('approval', {
                rpcId: block.rpcId,
                sessionId: block.sessionId,
                approvalId: block.approvalId,
                outcome: 'rejected',
              })
            }
          >
            {t('Reject (r)')}
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1"
            onClick={onSessionAuto}
            title={t('Auto-approve every decision in this session')}
          >
            {autoApprove ? t('✓ auto this session') : t('auto this session ›')}
          </button>
        </div>
      )}
    </div>
  )
}

function QuestionCard({ block, onRespond, onCancel }) {
  const settled = block.status !== 'pending'
  const [selected, setSelected] = useState({})
  const [custom, setCustom] = useState({})

  if (settled) {
    return (
      <div className="dsh-decision-card my-3" data-kind="question" data-settled="true">
        <div className="text-xs font-semibold" style={{ color: 'var(--dsh-waiting-question)' }}>
          ? Question
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {block.status === 'answered' ? '✓ Answered' : '· Cancelled'}
        </p>
      </div>
    )
  }

  const submit = () => {
    const answers = block.questions.map((question) => ({
      id: question.id,
      selected: selected[question.id] || [],
      custom: !question.options && custom[question.id] ? custom[question.id] : undefined,
    }))
    onRespond('question', { rpcId: block.rpcId, sessionId: block.sessionId, answers })
  }

  return (
    <div className="dsh-decision-card my-3" data-kind="question">
      <div className="text-xs font-semibold" style={{ color: 'var(--dsh-waiting-question)' }}>
        ? The agent is asking
      </div>
      {block.questions.map((question) => (
        <div key={question.id} className="my-2">
          {question.header && <p className="text-xs font-medium">{question.header}</p>}
          <p className="text-sm">{question.question}</p>
          {question.detail && <p className="text-xs text-muted-foreground">{question.detail}</p>}
          {question.options && (
            <div className="flex flex-col gap-1 mt-1">
              {question.options.map((option) => {
                const picked = (selected[question.id] || []).includes(option.label)
                return (
                  <label
                    key={option.label}
                    className="flex items-start gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                      name={`q-${block.rpcId}-${question.id}`}
                      checked={picked}
                      onChange={() =>
                        setSelected((prev) => {
                          const current = prev[question.id] || []
                          if (question.multiSelect) {
                            return {
                              ...prev,
                              [question.id]: picked
                                ? current.filter((l) => l !== option.label)
                                : [...current, option.label],
                            }
                          }
                          return { ...prev, [question.id]: [option.label] }
                        })
                      }
                    />
                    <span>
                      {option.label}
                      {option.description && (
                        <span className="text-xs text-muted-foreground block">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          {!question.options && (
            <textarea
              className="w-full mt-1 text-sm bg-secondary border border-border rounded-md p-2"
              rows={2}
              placeholder="Type your answer…"
              value={custom[question.id] || ''}
              onInput={(event) =>
                setCustom((prev) => ({ ...prev, [question.id]: event.target.value }))
              }
            />
          )}
        </div>
      ))}
      <div className="dsh-decision-actions">
        <button
          className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
          onClick={submit}
        >
          Submit
        </button>
        <button
          className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-secondary"
          onClick={onCancel}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function TurnEnd({ block }) {
  return (
    <div className="dsh-turn-end" data-reason={block.reasonKind}>
      <span>
        {block.note} · {block.steps} step{block.steps === 1 ? '' : 's'} · {block.tools} tool
        {block.tools === 1 ? '' : 's'}
        {block.startedAt != null && block.endedAt != null
          ? ` · ${formatDuration(block.endedAt - block.startedAt)}`
          : ''}
      </span>
      {Array.isArray(block.locations) && block.locations.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {block.locations.map((location, index) => (
            <span
              key={`${location?.path || index}`}
              className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-secondary font-mono"
              title={location?.path}
            >
              {location?.path || 'file'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkflowRun({ block }) {
  return (
    <div
      className="my-2 rounded-md border border-border px-3 py-2 text-xs"
      data-kind="workflow-run"
    >
      <div className="flex items-center gap-2 font-medium">
        <span>Workflow {block.runId || ''}</span>
        {block.phase != null && <span className="text-muted-foreground">· {block.phase}</span>}
        <span className="ml-auto text-muted-foreground">{block.status}</span>
      </div>
      {Array.isArray(block.members) && block.members.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
          {block.members.map((member, index) => (
            <li key={member.id ?? member.memberId ?? index}>
              {member.name || member.id || member.memberId || 'member'}
              {member.status ? ` · ${member.status}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AssistantText({ block, session, rpc, showFeedback }) {
  return (
    <div className="dsh-prose my-3">
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{block.text}</Markdown>
      {showFeedback && (
        <div className="flex items-center gap-1 mt-1">
          <button
            type="button"
            className="text-xs px-1.5 py-0.5 rounded border border-border hover:bg-secondary"
            title="Helpful"
            onClick={() =>
              void rpc('feedback.submit', {
                sessionId: session.sessionId,
                seq: block.seq,
                rating: 'up',
              })
            }
          >
            👍
          </button>
          <button
            type="button"
            className="text-xs px-1.5 py-0.5 rounded border border-border hover:bg-secondary"
            title="Not helpful"
            onClick={() =>
              void rpc('feedback.submit', {
                sessionId: session.sessionId,
                seq: block.seq,
                rating: 'down',
              })
            }
          >
            👎
          </button>
        </div>
      )}
    </div>
  )
}

export function Conversation({ session, blocks, onRespond, rpc, onInspectTool }) {
  const scrollRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const [listedCommands, setListedCommands] = useState([])

  useEffect(() => {
    const sessionId = session?.sessionId
    if (!sessionId || !rpc) {
      setListedCommands([])
      return
    }
    let cancelled = false
    void rpc('command.list', { sessionId })
      .then((result) => {
        if (cancelled) return
        setListedCommands(result?.commands || result?.items || [])
      })
      .catch(() => {
        if (!cancelled) setListedCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [session?.sessionId, rpc])

  const showFeedback =
    Boolean(session?.projections?.feedback) || feedbackSubmitListed(listedCommands)

  const toolCalls = useMemo(() => {
    const map = new Map()
    for (const block of blocks) if (block.kind === 'tool') map.set(block.callId, block)
    return map
  }, [blocks])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !atBottom) return
    element.scrollTop = element.scrollHeight
  }, [blocks, atBottom])

  // A newly arriving pending decision focuses its card when the conversation has focus.
  const pendingRef = useRef(null)
  useEffect(() => {
    const pending = blocks.find(
      (b) => (b.kind === 'approval' || b.kind === 'question') && b.status === 'pending',
    )
    if (pending && document.activeElement === scrollRef.current && pendingRef.current !== pending) {
      pendingRef.current = pending
      // focus ring lands on the card via data-attribute styling
    }
  }, [blocks])

  return (
    <div className="dsh-conversation relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        className="dsh-scroll h-full px-6 py-4"
        tabIndex={0}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.target
          setAtBottom(scrollHeight - scrollTop - clientHeight < 40)
        }}
      >
        {blocks.length === 0 && session?.blank !== false && (
          <p className="text-sm text-muted-foreground dsh-prose">
            Blank session — type below. Long tasks, tools and approvals all unfold here.
          </p>
        )}
        {blocks.map((block, index) => {
          const key = `${block.kind}-${block.seq ?? block.approvalId ?? block.rpcId ?? index}`
          if (block.kind === 'user') {
            return (
              <div key={key} className="dsh-user-bubble my-3">
                {block.text}
              </div>
            )
          }
          switch (block.kind) {
            case 'text':
              return (
                <AssistantText
                  key={key}
                  block={block}
                  session={session}
                  rpc={rpc}
                  showFeedback={showFeedback}
                />
              )
            case 'tool':
              return <ToolRow key={key} block={block} onInspect={onInspectTool} />
            case 'approval':
              return (
                <ApprovalCard
                  key={key}
                  block={{ ...block, sessionId: session.sessionId }}
                  toolCall={block.callId ? toolCalls.get(block.callId) : null}
                  onRespond={onRespond}
                  autoApprove={session.autoApprove}
                  onSessionAuto={() =>
                    void rpc('autoApprove.set', {
                      sessionId: session.sessionId,
                      value: !session.autoApprove,
                    })
                  }
                />
              )
            case 'question':
              return (
                <QuestionCard
                  key={key}
                  block={{ ...block, sessionId: session.sessionId }}
                  onRespond={onRespond}
                  onCancel={() =>
                    void rpc('question.cancel', {
                      rpcId: block.rpcId,
                      sessionId: session.sessionId,
                    })
                  }
                />
              )
            case 'workflow-run':
              return <WorkflowRun key={key} block={block} />
            case 'turn-end':
              return <TurnEnd key={key} block={block} />
            default:
              return null
          }
        })}
      </div>
      {!atBottom && (
        <button
          className="absolute bottom-3 right-4 text-xs rounded-full border border-border bg-card px-3 py-1.5 shadow flex items-center gap-1"
          onClick={() => {
            const element = scrollRef.current
            if (element) element.scrollTop = element.scrollHeight
            setAtBottom(true)
          }}
        >
          <ArrowDown size={12} /> Latest
        </button>
      )}
    </div>
  )
}
