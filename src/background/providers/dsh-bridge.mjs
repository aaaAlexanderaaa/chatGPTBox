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
  const decisions = []
  for (const block of blocks) {
    if (block.kind !== 'approval' && block.kind !== 'question') continue
    decisions.push({
      kind: block.kind,
      status: block.status,
      rpcId: block.rpcId,
      approvalId: block.approvalId,
      toolName: block.toolName,
      args: block.args ?? null,
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
    let stopRequested = false
    const { cleanController } = setAbortController(
      port,
      () => {
        // user pressed stop — cancel the running turn, honestly
        stopRequested = true
        if (dshSessionId) {
          void gateway.rpc('session.cancel', { sessionId: dshSessionId }).catch(() => {})
        }
      },
      () => {
        // port gone: stop watching. The turn itself keeps running engine-side
        // (记忆即所属 — closing the window never kills work).
        unwatch?.()
      },
    )

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
      let baseline = null
      let turnEndBaseline = null

      const finish = () => {
        if (finished) return
        finished = true
        const answer = lastAnswer || ''
        pushRecord(session, session.question, answer)
        port.postMessage({
          session: {
            ...session,
            dshSessionId,
            conversationRecords: session.conversationRecords,
          },
          answer,
          done: true,
        })
      }

      unwatch = gateway.watchLedger(dshSessionId, (message) => {
        if (message.sessionId !== dshSessionId) return
        const { blocks } = message
        if (baseline === null) {
          // First (history) replay: everything before this position is the
          // session's past — the cockpit owns its display.
          baseline = baselinePosition(blocks)
          turnEndBaseline = blocks.filter((b) => b.kind === 'turn-end').length
        }
        const fresh = blocks.slice(baseline)

        const answer = renderLedgerMarkdown(fresh)
        if (answer !== lastAnswer) {
          lastAnswer = answer
          port.postMessage({ answer })
        }

        for (const decision of collectDecisionStates(blocks, dshSessionId)) {
          const key = decisionKey(decision)
          const known = knownDecisions.get(key)
          if (known && known.status === decision.status) continue
          knownDecisions.set(key, decision)
          port.postMessage({ dshDecision: decision })
        }

        const turnEnds = blocks.filter((b) => b.kind === 'turn-end').length
        if (!stopRequested && turnEnds > turnEndBaseline) finish()
      })

      try {
        await gateway.rpc('session.prompt', {
          sessionId: dshSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: session.question }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        // The turn usually completes inside the watcher; a stop cancels it
        // engine-side and the mux will deliver that turn-end too.
      } catch (error) {
        unwatch()
        port.postMessage({ error: error?.message || String(error) })
        port.postMessage({ done: true })
        return
      }
    } finally {
      cleanController()
    }
  },
}
