// dsh bridge provider (roadmap B, "A 路径薄适配").
//
// The floating window / popup treat DeepSeek Harness as just another engine:
// a question goes in over the normal conversation port and the answer
// streams back. This thin adapter forwards the prompt to a gateway session
// (creating one per conversation, D-4: sessions born in the extension keep
// their engine-side binding in session.dshSessionId) and translates the
// ledger into the port protocol:
//
//   - assistant text + tool activity + turn notes → the markdown answer
//     stream (a running tool row is the contract's status line);
//   - pending approvals/questions → {dshDecision} cards the conversation
//     surface renders (D-5: the floating window grows approval cards);
//   - answers flow back through DSH_MODULE_RESPOND, never this port.
//
// Only blocks that arrive after the bridge attaches flow into the bubble —
// engine-side history belongs to the cockpit ledger, not the bubble. The
// gateway lives in the dsh module; core reaches it only through the
// modules/background-services.mjs aggregation point.

import { isUsingDshHarnessModel } from '../../config/predicates.mjs'
import { getDshGateway } from '../../modules/background-services.mjs'
import { pushRecord, setAbortController } from '../../services/apis/shared.mjs'

const TOOL_ARGS_PREVIEW_CHARS = 120

// Local twin of the fold's preview formatter — the module boundary forbids
// importing module internals from core, and dragging this through the seam
// would cost more than the eight lines it saves.
function previewToolArgs(args, maxChars = TOOL_ARGS_PREVIEW_CHARS) {
  const oneLine = String(args || '').replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxChars) return oneLine
  return `${oneLine.slice(0, maxChars)}…`
}

/**
 * Render the readable part of a ledger slice as markdown for the bubble
 * stream. Pure: the same blocks always render to the same text, so
 * re-sending the full string on every push is idempotent on the receiver.
 *
 * @param {object[]} blocks - ledger blocks (internal fold shape)
 * @returns {string}
 */
export function renderLedgerMarkdown(blocks) {
  const lines = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        lines.push(block.text || '')
        break
      case 'tool': {
        const symbol =
          block.status === 'running'
            ? '◌'
            : block.status === 'error'
              ? '✗'
              : block.status === 'done'
                ? '✓'
                : '⊘'
        lines.push(`\`${symbol} 🔧 ${block.name} ${previewToolArgs(block.args)}\``)
        break
      }
      case 'turn-end':
        lines.push(`*— ${block.note || 'turn finished'} —*`)
        break
      default:
        // user echoes and decision cards render outside the answer stream
        break
    }
  }
  return lines.filter((line) => line !== '').join('\n\n')
}

/**
 * Compact decision snapshot for the conversation surfaces: every approval/
 * question block (pending or settled), so cards can be announced and later
 * collapsed in place.
 *
 * @param {object[]} blocks
 * @param {string} sessionId
 * @returns {Array<object>}
 */
export function collectDecisionStates(blocks, sessionId) {
  // Approval blocks carry no arguments themselves — they live on the tool
  // block matched by callId (same resolution the gateway's summaries use),
  // resolved here so no surface ever asks the user to decide blind.
  const toolBlocks = new Map()
  for (const block of blocks) {
    if (block.kind === 'tool' && block.callId) toolBlocks.set(block.callId, block)
  }
  const decisions = []
  for (const block of blocks) {
    if (block.kind !== 'approval' && block.kind !== 'question') continue
    decisions.push({
      kind: block.kind,
      status: block.status,
      rpcId: block.rpcId,
      approvalId: block.approvalId,
      toolName: block.toolName,
      args: block.callId ? toolBlocks.get(block.callId)?.args ?? null : null,
      questions: block.questions ?? null,
      sessionId,
    })
  }
  return decisions
}

function decisionKey(decision) {
  return `${decision.kind}:${decision.approvalId ?? decision.rpcId}`
}

/** Index of the first block this bridge has not seen yet (seq gate:
 *  decision blocks carry no seq, so the baseline is positional). */
function baselinePosition(blocks) {
  return blocks.length
}

export default {
  route: 'dsh-bridge',
  match: (session) => isUsingDshHarnessModel(session),
  async run({ port, session, config }) {
    if (config.dshModuleEnabled !== true) {
      port.postMessage({
        error:
          'DeepSeek Harness module is disabled. Enable it in Settings → Engines → DeepSeek Harness.',
      })
      port.postMessage({ done: true })
      return
    }
    const gateway = getDshGateway()
    if (!gateway || gateway.getState().status !== 'online') {
      port.postMessage({
        error:
          'DeepSeek Harness is not connected. Is `dsh web` running? (Settings → Engines → Diagnose)',
      })
      port.postMessage({ done: true })
      return
    }

    let dshSessionId = session.dshSessionId || null
    let unwatch = null
    let cleanedUp = false

    // The abort listeners must live for the TURN's lifetime, not run()'s:
    // session.prompt resolves on acceptance, seconds before the turn ends.
    // finish() / stop / disconnect do the cleanup — never a finally block.
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      unwatch?.()
      cleanController()
    }

    const { cleanController } = setAbortController(
      port,
      () => {
        // user pressed stop — cancel the running turn, honestly, and end
        // the stream even if the engine's turn-end never arrives.
        finishRef.current?.()
        if (dshSessionId) {
          void gateway.rpc('session.cancel', { sessionId: dshSessionId }).catch(() => {})
        }
      },
      () => {
        // port gone: stop watching. The turn itself keeps running engine-side
        // (记忆即所属 — closing the window never kills work).
        cleanup()
      },
    )
    const finishRef = { current: null }

    try {
      if (!dshSessionId) {
        const created = await gateway.rpc('session.create')
        dshSessionId = created.sessionId
        // The conversation keeps its engine-side binding (D-4).
        port.postMessage({ dshSessionId })
      }

      let lastAnswer = null
      let finished = false
      const knownDecisions = new Map()
      let latestBlocks = []
      let baseline = null
      let turnEndBaseline = null
      let promptAccepted = false

      const finish = () => {
        if (finished) return
        finished = true
        const answer = lastAnswer || ''
        pushRecord(session, session.question, answer)
        try {
          port.postMessage({
            session: {
              ...session,
              dshSessionId,
              conversationRecords: session.conversationRecords,
            },
            answer,
            done: true,
          })
        } catch {
          // port died mid-finish; the disconnect cleanup follows
        }
        cleanup()
      }
      finishRef.current = finish

      unwatch = gateway.watchLedger(dshSessionId, (message) => {
        if (message.sessionId !== dshSessionId) return
        const { blocks } = message
        latestBlocks = blocks

        // Pending approvals/questions are relevant no matter when they were
        // raised; announce every state change.
        for (const decision of collectDecisionStates(blocks, dshSessionId)) {
          const key = decisionKey(decision)
          const known = knownDecisions.get(key)
          if (known && known.status === decision.status) continue
          knownDecisions.set(key, decision)
          port.postMessage({ dshDecision: decision })
        }

        // The answer stream only starts once this prompt has been accepted:
        // anything on the ledger before that belongs to earlier turns
        // (a still-running turn included — its end must not finish us).
        if (!promptAccepted || baseline === null) return
        const fresh = blocks.slice(baseline)

        const answer = renderLedgerMarkdown(fresh)
        if (answer !== lastAnswer) {
          lastAnswer = answer
          port.postMessage({ answer })
        }

        const turnEnds = blocks.filter((b) => b.kind === 'turn-end').length
        if (turnEnds > turnEndBaseline) finish()
      })

      try {
        await gateway.rpc('session.prompt', {
          sessionId: dshSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: session.question }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        // Snapshot the baseline at acceptance: everything already on the
        // ledger predates this turn. Blocks arriving between acceptance and
        // this assignment are captured on the next push (blocks is the full
        // fold, the slice is monotone).
        promptAccepted = true
        baseline = baselinePosition(latestBlocks)
        turnEndBaseline = latestBlocks.filter((b) => b.kind === 'turn-end').length
        const fresh = latestBlocks.slice(baseline)
        const answer = renderLedgerMarkdown(fresh)
        if (answer !== lastAnswer) {
          lastAnswer = answer
          port.postMessage({ answer })
        }
      } catch (error) {
        port.postMessage({ error: error?.message || String(error) })
        port.postMessage({ done: true })
        cleanup()
        return
      }
    } catch (error) {
      port.postMessage({ error: error?.message || String(error) })
      port.postMessage({ done: true })
      cleanup()
    }
  },
}
