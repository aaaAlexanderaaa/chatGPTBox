// Pure fold of DeepSeek Harness mux frames into a chatGPTBox answer stream.
//
// The harness emits fine-grained session events (token chunks, tool calls,
// approvals, turn lifecycle). This module reduces them to the coarser shape
// the extension's chat port expects: one rendered string (markdown), a done
// flag, and an optional error — with tool/approval activity rendered as
// blockquote lines so the existing markdown UI shows them without any new
// rendering concepts.
//
// Turn ownership: the orchestrator opens the mux socket BEFORE sending the
// prompt, so the turn our prompt starts always has its turn/start streamed to
// us. turn/end is only treated as completion for a turn whose turn/start we
// saw — activity from turns already running on the same harness session (the
// user driving the same session from the harness web UI) is ignored.
//
// The fold is session-agnostic by design: the mux stream multiplexes ALL
// sessions, and the orchestrator filters frames by sessionId before pushing
// (it also owns idle-timer semantics, which foreign frames must not touch).

const MAX_TOOL_ARGS_PREVIEW_CHARS = 100

/** English defaults; the orchestrator injects localized strings via i18next. */
const DEFAULT_STRINGS = {
  toolStatusRunning: '',
  toolStatusError: ' ✗',
  approvalPending: (toolName) =>
    `⏳ The harness is waiting for approval to run \`${toolName}\` — answer it in the Harness web UI, or enable auto-approve in ChatGPTBox settings.`,
  approvalAllowed: (toolName) => `✓ Approved \`${toolName}\`.`,
  approvalRejected: (toolName) => `✗ Rejected \`${toolName}\` (the tool did not run).`,
  turnAborted: 'Generation was stopped.',
  turnBlocked: 'The turn was blocked before producing an answer.',
  turnMaxTokens: 'The turn hit its output-token ceiling.',
  turnInterrupted: 'The turn was interrupted (the harness process may have restarted).',
}

function previewArguments(rawArguments) {
  if (typeof rawArguments !== 'string' || !rawArguments) return ''
  const oneLine = rawArguments.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= MAX_TOOL_ARGS_PREVIEW_CHARS) return oneLine
  return `${oneLine.slice(0, MAX_TOOL_ARGS_PREVIEW_CHARS)}…`
}

/**
 * @param {{ strings?: Partial<typeof DEFAULT_STRINGS> }} [options]
 */
export function createDshTurnFold({ strings = {} } = {}) {
  const s = { ...DEFAULT_STRINGS, ...strings }

  /** @type {Array<{kind:'text',text:string}|{kind:'tool',callId:string,name:string,args:string,status:'running'|'done'|'error'}|{kind:'approval',approvalId:string,toolName:string,status:'pending'|'allowed-once'|'rejected'}|{kind:'notice',text:string}>} */
  const blocks = []
  const openTextByStep = new Map() // `${turn}:${step}` -> block index
  const toolByCallId = new Map()
  const approvalByApprovalId = new Map()
  const pendingApprovals = [] // { rpcId, approvalId, toolName }
  const seenTurnStarts = new Set()
  const seenQuestionRpcIds = new Set()

  let done = false
  let error = null
  let lastAnswer = ''
  let lastTurnSeen = 0

  function textFor(block) {
    return block.text
  }

  function renderBlock(block) {
    if (block.kind === 'text') return textFor(block)
    if (block.kind === 'notice') return `> ${block.text}`
    if (block.kind === 'tool') {
      const suffix =
        block.status === 'error' ? s.toolStatusError : block.status === 'running' ? s.toolStatusRunning : ''
      const args = block.args ? ` \`${block.args}\`` : ''
      return `> 🔧 \`${block.name}\`${args}${suffix}`
    }
    // approval
    if (block.status === 'pending') return `> ${s.approvalPending(block.toolName)}`
    if (block.status === 'allowed-once') return `> ${s.approvalAllowed(block.toolName)}`
    return `> ${s.approvalRejected(block.toolName)}`
  }

  function render() {
    return blocks
      .map(renderBlock)
      .filter((line) => line !== null && line !== undefined && line.trim() !== '')
      .join('\n\n')
  }

  function emit() {
    const answer = render()
    const changed = answer !== lastAnswer
    lastAnswer = answer
    return { answer, changed, done, error }
  }  /** Set (or replace, once the authoritative message arrives) a step's text. */
  function setStepText(turn, step, text, { replace } = {}) {
    const key = `${turn}:${step}`
    const index = openTextByStep.get(key)
    if (index !== undefined) {
      if (replace) blocks[index].text = text
      else blocks[index].text += text
      return
    }
    if (!text) return
    blocks.push({ kind: 'text', text })
    openTextByStep.set(key, blocks.length - 1)
  }

  /** @param {object} event - SessionEvent ({ type, seq, data, ... }). */
  function pushEvent(event) {
    if (!event || typeof event.type !== 'string' || done) return emit()
    const data = event.data ?? {}
    switch (event.type) {
      case 'turn/start':
        seenTurnStarts.add(data.turn)
        lastTurnSeen = Math.max(lastTurnSeen, data.turn ?? 0)
        break
      case 'turn/end': {
        lastTurnSeen = Math.max(lastTurnSeen, data.turn ?? 0)
        if (!seenTurnStarts.has(data.turn)) break // someone else's turn on this session
        done = true
        const kind = data.reason?.kind
        if (kind === 'error') {
          error = data.reason.error?.message || 'the harness turn failed'
        } else if (kind === 'aborted' || kind === 'interrupted') {
          blocks.push({ kind: 'notice', text: s.turnAborted })
        } else if (kind === 'blocked') {
          blocks.push({ kind: 'notice', text: s.turnBlocked })
        } else if (kind === 'max-tokens') {
          blocks.push({ kind: 'notice', text: s.turnMaxTokens })
        }
        break
      }
      case 'step/start':
      case 'step/end':
        break
      case 'assistant/chunk': {
        const chunk = data.chunk
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          setStepText(data.turn, data.step, chunk.text)
        }
        // reasoning-delta / tool-call-delta / block boundaries are folded via
        // the authoritative assistant/message + tool/call events instead.
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
        // Idempotent on callId: history salvage replays events the live
        // stream already folded.
        if (toolByCallId.has(data.callId)) break
        const block = {
          kind: 'tool',
          callId: data.callId,
          name: data.name,
          args: previewArguments(data.arguments),
          status: 'running',
        }
        blocks.push(block)
        toolByCallId.set(data.callId, block)
        break
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId
        const block = toolByCallId.get(callId)
        if (block) block.status = data.error || data.message?.isError ? 'error' : 'done'
        break
      }
      case 'user/message':
      case 'todo/write':
      case 'request/header':
      case 'request/context':
      case 'session/end-seed':
        break
      default:
        // Unknown event types are ignored on purpose: the harness is
        // merge-extensible and may emit plugin events this fold predates.
        break
    }
    return emit()
  }

  /**
   * @param {object} frame - MuxFrame payload.
   * @param {{ rpcId?: string }} [envelope] - Server-request envelope (rpcId needed to answer approvals).
   */
  function pushFrame(frame, envelope = {}) {
    if (!frame || typeof frame.type !== 'string' || done) return emit()
    switch (frame.type) {
      case 'session/event':
        return pushEvent(frame.event)
      case 'approval/requested': {
        // Mux (re)opens replay still-pending approvals with a reused rpcId —
        // re-arm the existing block instead of duplicating it.
        const existing = approvalByApprovalId.get(frame.approvalId)
        if (existing) {
          existing.status = 'pending'
          if (envelope.rpcId) {
            pendingApprovals.push({
              rpcId: envelope.rpcId,
              approvalId: frame.approvalId,
              toolName: existing.toolName,
            })
          }
          break
        }
        const block = {
          kind: 'approval',
          approvalId: frame.approvalId,
          toolName: frame.toolName || 'tool',
          status: 'pending',
        }
        blocks.push(block)
        approvalByApprovalId.set(frame.approvalId, block)
        if (envelope.rpcId) {
          pendingApprovals.push({
            rpcId: envelope.rpcId,
            approvalId: frame.approvalId,
            toolName: block.toolName,
          })
        }
        break
      }
      case 'approval/resolved': {
        const block = approvalByApprovalId.get(frame.approvalId)
        if (block) block.status = frame.outcome === 'allowed-once' ? 'allowed-once' : 'rejected'
        break
      }
      case 'question/requested': {
        // Replayed on mux reopen — one notice per rpcId.
        if (envelope.rpcId && seenQuestionRpcIds.has(envelope.rpcId)) break
        if (envelope.rpcId) seenQuestionRpcIds.add(envelope.rpcId)
        const questions = Array.isArray(frame.questions) ? frame.questions : []
        const text = questions.map((q) => q?.question).filter(Boolean).join('\n')
        if (text) {
          blocks.push({
            kind: 'notice',
            text: `❓ ${text} (answer in the Harness web UI)`,
          })
        }
        break
      }
      case 'question/resolved':
      case 'session/subscribed':
      case 'session/queue':
      case 'session/jobs':
      case 'session/projection':
        break
      case 'stream/error':
        done = true
        error = frame.error?.message || `stream error (${frame.error?.code || 'unknown'})`
        break
      default:
        break
    }
    return emit()
  }

  return {
    pushEvent,
    pushFrame,
    /** Approvals the harness is waiting on that we have not answered ourselves. */
    takePendingApprovals() {
      return pendingApprovals.splice(0, pendingApprovals.length)
    },
    markApprovalOutcome(approvalId, outcome) {
      const block = approvalByApprovalId.get(approvalId)
      if (block) block.status = outcome
    },
    getAnswer: () => render(),
    getLastTurnSeen: () => lastTurnSeen,
    isDone: () => done,
    getError: () => error,
  }
}
