// Session-scoped ledger fold for DeepSeek Harness session events and mux
// frames (roadmap A2: "幂等事件折叠，内部结构化 blocks 正是台账数据源").
//
// The harness emits fine-grained session events (token chunks, tool calls,
// approvals, turn lifecycle) with a monotonic contiguous `seq`. This module
// reduces them into the structured blocks the cockpit ledger renders
// directly — no markdown string intermediate. The fold is idempotent:
//
//   - events are gated on `seq` (only strictly-new seq numbers are folded),
//     so a reconnect that re-pulls session.history after a socket loss
//     replays already-seen events without duplicating anything;
//   - tool calls are keyed by callId, approvals by approvalId, questions by
//     rpcId, text by `${turn}:${step}` — a replay before the seq gate sees
//     them never duplicates either;
//   - unknown event types are ignored on purpose (the harness is
//     merge-extensible and may emit plugin events this fold predates).
//
// Multi-turn by design: the gateway keeps one fold per harness session for
// the process lifetime; a turn/end appends a turn-boundary block instead of
// finishing the fold (the per-prompt `done` semantics of the discarded
// provider bridge live in the gateway, not here).
//
// Wire shapes confirmed against the harness source (tmp/deepseek-harness,
// packages/core/session/src/types.ts + packages/host/apiproxy/src/api/):
//   turn/end reasons: completed | aborted{reason} | blocked | error{error}
//                     | max-tokens | interrupted
//   tool/call:        {turn, step, callId, name, arguments(raw JSON string)}
//   tool/result:      {turn, step, message:{toolCallId, content, isError?}, error?}
//   user/message:     {message:{content:[{type:'text',text}|...]}}
//   assistant/message:{message:{content:[{type:'text',text}|...]}}

export const TOOL_ARGS_PREVIEW_CHARS = 60

/** English fallbacks; the cockpit UI localizes at render time. */
const DEFAULT_STRINGS = {
  turnAborted: 'Stopped',
  turnInterrupted: 'Interrupted (the harness process may have restarted)',
  turnBlocked: 'Blocked before producing an answer',
  turnMaxTokens: 'Reached the output-token ceiling',
  turnErrored: 'Failed',
  turnCompleted: 'Completed',
}

/**
 * @param {{ strings?: Partial<typeof DEFAULT_STRINGS> }} [options]
 */
export function createDshLedgerFold({ strings = {} } = {}) {
  const s = { ...DEFAULT_STRINGS, ...strings }

  /**
   * Block shapes (the ledger's three registers map onto these):
   *   {kind:'user',      seq, turn?, text}
   *   {kind:'text',      seq, turn, step, text}
   *   {kind:'tool',      seq, turn, step, callId, name, args, status:'running'|'done'|'error'|'cancelled', startedAt, endedAt, resultText}
   *   {kind:'approval',  approvalId, toolName, callId?, reason?, status:'pending'|'allowed-once'|'rejected'|'cancelled'|'unavailable', requestedAt}
   *   {kind:'question',  rpcId, questions:[{id,question,header?,detail?,options?,multiSelect?,intent?}], status:'pending'|'answered'|'cancelled', requestedAt}
   *   {kind:'turn-end',  seq, turn, reasonKind, note, steps, tools, startedAt, endedAt}
   * @type {Array<object>}
   */
  const blocks = []
  const textByStepKey = new Map() // `${turn}:${step}` -> block
  const toolByCallId = new Map()
  const approvalByApprovalId = new Map()
  const questionByRpcId = new Map()
  const turnBounds = new Map() // turn -> {startedAt, endedAt, steps:Set, toolCallIds}

  let lastSeq = -1
  let version = 0

  function touch() {
    version += 1
    return version
  }

  function acceptSeq(seq) {
    if (typeof seq !== 'number' || Number.isNaN(seq)) return true // unsequenced frames (approvals) always pass
    if (seq <= lastSeq) return false
    lastSeq = seq
    return true
  }

  function turnBoundsFor(turn, time) {
    let bounds = turnBounds.get(turn)
    if (!bounds) {
      bounds = { startedAt: time ?? null, endedAt: null, steps: new Set(), toolCallIds: [] }
      turnBounds.set(turn, bounds)
    }
    return bounds
  }

  function setStepText(turn, step, text, { replace } = {}) {
    const key = `${turn}:${step}`
    const existing = textByStepKey.get(key)
    if (existing) {
      if (replace) existing.text = text
      else existing.text += text
      return
    }
    if (!text) return
    const block = { kind: 'text', seq: lastSeq, turn, step, text }
    blocks.push(block)
    textByStepKey.set(key, block)
  }

  function describeTurnEnd(data) {
    const reason = data.reason || {}
    switch (reason.kind) {
      case 'error':
        return {
          reasonKind: 'error',
          note: `${s.turnErrored} · ${reason.error?.message || 'unknown error'}`,
        }
      case 'aborted':
        return { reasonKind: 'aborted', note: s.turnAborted }
      case 'interrupted':
        return { reasonKind: 'interrupted', note: s.turnInterrupted }
      case 'blocked':
        return { reasonKind: 'blocked', note: s.turnBlocked }
      case 'max-tokens':
        return { reasonKind: 'max-tokens', note: s.turnMaxTokens }
      default:
        return { reasonKind: 'completed', note: s.turnCompleted }
    }
  }

  /** @param {object} event - SessionEvent ({ type, seq, time, data, ... }). */
  function pushEvent(event) {
    if (!event || typeof event.type !== 'string') return version
    const { type, seq, time } = event
    if (!acceptSeq(seq)) return version
    const data = event.data ?? {}
    switch (type) {
      case 'turn/start':
        turnBoundsFor(data.turn, time)
        break
      case 'turn/end': {
        const bounds = turnBoundsFor(data.turn, time)
        bounds.endedAt = time ?? null
        const { reasonKind, note } = describeTurnEnd(data)
        blocks.push({
          kind: 'turn-end',
          seq,
          turn: data.turn,
          reasonKind,
          note,
          steps: bounds.steps.size,
          tools: bounds.toolCallIds.length,
          startedAt: bounds.startedAt,
          endedAt: bounds.endedAt,
        })
        break
      }
      case 'step/start':
        turnBoundsFor(data.turn, time).steps.add(data.step)
        break
      case 'step/end':
        break
      case 'user/message': {
        const text = (data.message?.content || [])
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n\n')
        if (text) blocks.push({ kind: 'user', seq, turn: data.turn ?? null, text })
        break
      }
      case 'assistant/chunk': {
        const chunk = data.chunk
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          turnBoundsFor(data.turn, time)
          setStepText(data.turn, data.step, chunk.text)
        }
        // reasoning/tool-call deltas and block boundaries are folded via the
        // authoritative assistant/message + tool/call events instead.
        break
      }
      case 'assistant/message': {
        const text = (data.message?.content || [])
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n\n')
        setStepText(data.turn, data.step, text, { replace: true })
        break
      }
      case 'tool/call': {
        if (toolByCallId.has(data.callId)) break
        const bounds = turnBoundsFor(data.turn, time)
        bounds.toolCallIds.push(data.callId)
        const block = {
          kind: 'tool',
          seq,
          turn: data.turn,
          step: data.step,
          callId: data.callId,
          name: data.name,
          args:
            typeof data.arguments === 'string'
              ? data.arguments
              : JSON.stringify(data.arguments ?? ''),
          status: 'running',
          startedAt: time ?? null,
          endedAt: null,
          resultText: null,
        }
        blocks.push(block)
        toolByCallId.set(data.callId, block)
        break
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId
        const block = toolByCallId.get(callId)
        if (!block || block.status !== 'running') break
        block.status = data.error || data.message?.isError ? 'error' : 'done'
        block.endedAt = time ?? null
        const content = data.message?.content
        if (Array.isArray(content)) {
          block.resultText = content
            .map((part) =>
              typeof part?.text === 'string' ? part.text : typeof part === 'string' ? part : '',
            )
            .filter(Boolean)
            .join('\n')
        }
        break
      }
      case 'todo/write':
      case 'request/header':
      case 'request/context':
      case 'session/end-seed':
        break
      default:
        // Unknown event types are ignored on purpose (merge-extensible
        // harness may emit plugin events this fold predates).
        break
    }
    return touch()
  }

  /**
   * @param {object} frame - Mux frame payload (session-scoped by the caller).
   * @param {{ rpcId?: string }} [envelope] - Server-request envelope; the
   *        rpcId is what /api/respond echoes for approvals and questions.
   */
  function pushFrame(frame, envelope = {}) {
    if (!frame || typeof frame.type !== 'string') return version
    switch (frame.type) {
      case 'session/event':
        return pushEvent(frame.event)
      case 'approval/requested': {
        // Frames carry no arguments — the ledger's tool/call block (matched
        // via callId) is the parameter source for the approval card.
        const existing = approvalByApprovalId.get(frame.approvalId)
        if (existing) {
          existing.status = 'pending' // mux reopen replays pending approvals
          break
        }
        const block = {
          kind: 'approval',
          approvalId: frame.approvalId,
          toolName: frame.toolName || 'tool',
          callId: frame.callId ?? null,
          reason: frame.reason ?? null,
          status: 'pending',
          requestedAt: Date.now(),
          rpcId: envelope.rpcId ?? null,
        }
        blocks.push(block)
        approvalByApprovalId.set(frame.approvalId, block)
        break
      }
      case 'approval/resolved': {
        const block = approvalByApprovalId.get(frame.approvalId)
        if (block) block.status = frame.outcome
        break
      }
      case 'question/requested': {
        if (!envelope.rpcId) break
        const existing = questionByRpcId.get(envelope.rpcId)
        if (existing) break // replayed on mux reopen
        const block = {
          kind: 'question',
          rpcId: envelope.rpcId,
          questions: Array.isArray(frame.questions) ? frame.questions : [],
          status: 'pending',
          requestedAt: Date.now(),
        }
        blocks.push(block)
        questionByRpcId.set(envelope.rpcId, block)
        break
      }
      case 'question/resolved': {
        const block = questionByRpcId.get(frame.questionRpcId)
        if (block) block.status = frame.outcome === 'cancelled' ? 'cancelled' : 'answered'
        break
      }
      case 'session/subscribed':
      case 'session/queue':
      case 'session/jobs':
      case 'session/projection':
      case 'stream/error':
        // Handled by the gateway (queue/jobs/projection state), not the fold.
        break
      default:
        break
    }
    return touch()
  }

  return {
    pushEvent,
    pushFrame,
    getBlocks: () => blocks,
    getLastSeq: () => lastSeq,
    getVersion: () => version,
    /** Pending decision points, oldest first — the "waiting" inbox. */
    getPendingDecisions() {
      const pending = []
      for (const block of blocks) {
        if (block.kind === 'approval' && block.status === 'pending') {
          pending.push({ type: 'approval', rpcId: block.rpcId, block })
        } else if (block.kind === 'question' && block.status === 'pending') {
          pending.push({ type: 'question', rpcId: block.rpcId, block })
        }
      }
      return pending
    },
    /** Full arguments for an approval card: the matched tool/call block. */
    getToolCall(callId) {
      return toolByCallId.get(callId) || null
    },
    markApprovalOutcome(approvalId, outcome) {
      const block = approvalByApprovalId.get(approvalId)
      if (block) block.status = outcome
      return touch()
    },
    markQuestionOutcome(rpcId, outcome) {
      const block = questionByRpcId.get(rpcId)
      if (block) block.status = outcome
      return touch()
    },
  }
}

/** One-line preview of tool arguments for the machine register (UI may clamp). */
export function previewToolArgs(args, maxChars = TOOL_ARGS_PREVIEW_CHARS) {
  const oneLine = String(args || '').replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxChars) return oneLine
  return `${oneLine.slice(0, maxChars)}…`
}
