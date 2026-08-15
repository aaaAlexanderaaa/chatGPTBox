import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ArrowDown, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { previewToolArgs } from '../turn-fold.mjs'

// The ledger (ui-console.md): three registers stacked vertically —
// prose (assistant text, full width readable), machine rows (one line per
// tool activity, expandable), decision cards (approval/question, the
// loudest element and the only full-width color allowed).
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

function ToolRow({ block }) {
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
        {toolCall ? toolCall.args : '(arguments not captured)'}
      </div>
      {block.reason && <p className="text-xs text-muted-foreground mb-2">{block.reason}</p>}
      {settled ? (
        <p className="text-xs text-muted-foreground">
          {block.status === 'allowed-once'
            ? '✓ Allowed'
            : block.status === 'rejected'
            ? '✗ Rejected — the tool did not run'
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
            Allow once (a)
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
            Reject (r)
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1"
            onClick={onSessionAuto}
            title="Auto-approve every decision in this session"
          >
            {autoApprove ? '✓ auto this session' : 'auto this session ›'}
          </button>
        </div>
      )}
    </div>
  )
}

function QuestionCard({ block, onRespond, onCancel }) {
  const settled = block.status !== 'pending'
  const [selected, setSelected] = useState({})
  const [custom, setCustom] = useState('')

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
      custom: !question.options && custom ? custom : undefined,
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
              value={custom}
              onInput={(event) => setCustom(event.target.value)}
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
    </div>
  )
}

export function Ledger({ session, blocks, onRespond, rpc }) {
  const scrollRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)

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

  // A newly arriving pending decision focuses its card when the ledger has focus.
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
    <div className="relative flex-1 min-h-0">
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
          switch (block.kind) {
            case 'user':
              return (
                <div key={key} className="dsh-user-block my-3">
                  {block.text}
                </div>
              )
            case 'text':
              return (
                <div key={key} className="dsh-prose my-3">
                  <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{block.text}</Markdown>
                </div>
              )
            case 'tool':
              return <ToolRow key={key} block={block} />
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
