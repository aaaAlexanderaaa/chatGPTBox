import { describe, expect, it } from 'vitest'
import {
  createDshLedgerFold,
  newestPendingDecision,
  previewToolArgs,
} from '../src/modules/dsh/turn-fold.mjs'

// Frame/event builders matching the harness wire shapes (MuxFrame payloads and
// SessionEvent envelopes from packages/host/apiproxy + packages/core/session).

const event = (type, data, seq = 0, time = 0) => ({ type, seq, time, data })
const frame = (type, payload = {}) => ({ type, sessionId: 's1', ...payload })

function chunk(turn, step, text, seq, time) {
  return event(
    'assistant/chunk',
    { turn, step, chunk: { type: 'text-delta', index: 0, text } },
    seq,
    time,
  )
}

describe('dsh ledger fold', () => {
  it('accumulates streamed text and records the turn boundary', () => {
    const fold = createDshLedgerFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }, 0, 1000) }))
    fold.pushFrame(frame('session/event', { event: chunk(1, 0, 'Hello', 1, 1100) }))
    fold.pushFrame(frame('session/event', { event: chunk(1, 0, ' world', 2, 1200) }))
    fold.pushFrame(
      frame('session/event', {
        event: event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3, 2000),
      }),
    )
    const blocks = fold.getBlocks()
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'turn-end'])
    expect(blocks[0].text).toBe('Hello world')
    expect(blocks[1]).toMatchObject({
      kind: 'turn-end',
      turn: 1,
      reasonKind: 'completed',
      startedAt: 1000,
      endedAt: 2000,
    })
  })

  it('assistant/message replaces the streamed text authoritatively', () => {
    const fold = createDshLedgerFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }, 0) }))
    fold.pushFrame(frame('session/event', { event: chunk(1, 0, 'Hel', 1) }))
    fold.pushFrame(
      frame('session/event', {
        event: event(
          'assistant/message',
          {
            turn: 1,
            step: 0,
            message: { role: 'assistant', content: [{ type: 'text', text: 'Final text' }] },
          },
          2,
        ),
      }),
    )
    expect(fold.getBlocks()[0].text).toBe('Final text')
  })

  it('folds tool calls with full arguments, status, and wall time', () => {
    const fold = createDshLedgerFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }, 0, 1000) }))
    fold.pushFrame(
      frame('session/event', {
        event: event(
          'tool/call',
          {
            turn: 1,
            step: 0,
            callId: 'c1',
            name: 'shell',
            arguments: '{"cmd":"rm -rf node_modules && npm install"}',
          },
          1,
          2000,
        ),
      }),
    )
    fold.pushFrame(
      frame('session/event', {
        event: event(
          'tool/result',
          {
            turn: 1,
            step: 0,
            message: { toolCallId: 'c1', content: [{ type: 'text', text: 'done' }] },
          },
          2,
          32000,
        ),
      }),
    )
    const tool = fold.getBlocks().find((b) => b.kind === 'tool')
    expect(tool).toMatchObject({
      callId: 'c1',
      name: 'shell',
      args: '{"cmd":"rm -rf node_modules && npm install"}',
      status: 'done',
      startedAt: 2000,
      endedAt: 32000,
      resultText: 'done',
    })
  })

  it('turn/end notes the six end shapes distinctly', () => {
    const reasons = [
      [{ kind: 'completed' }, 'completed'],
      [{ kind: 'aborted', reason: { kind: 'user' } }, 'aborted'],
      [{ kind: 'interrupted' }, 'interrupted'],
      [{ kind: 'blocked' }, 'blocked'],
      [{ kind: 'max-tokens' }, 'max-tokens'],
      [{ kind: 'error', error: { message: 'provider down' } }, 'error'],
    ]
    let seq = 0
    for (const [reason, expectedKind] of reasons) {
      const fold = createDshLedgerFold()
      fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }, seq++) }))
      fold.pushFrame(
        frame('session/event', { event: event('turn/end', { turn: 1, reason }, seq++) }),
      )
      const end = fold.getBlocks().at(-1)
      expect(end.reasonKind).toBe(expectedKind)
      if (expectedKind === 'error') expect(end.note).toContain('provider down')
    }
  })

  it('gates on seq: replays (history salvage) never duplicate', () => {
    const fold = createDshLedgerFold()
    const events = [
      event('turn/start', { turn: 1 }, 0),
      chunk(1, 0, 'Hel', 1),
      chunk(1, 0, 'lo', 2),
      event(
        'assistant/message',
        {
          turn: 1,
          step: 0,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        },
        3,
      ),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'ls', arguments: '{}' }, 4),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5),
    ]
    for (const e of events) fold.pushFrame(frame('session/event', { event: e }))
    // getBlocks() returns the live array — snapshot it for the assertions.
    const once = [...fold.getBlocks()]
    expect(fold.getLastSeq()).toBe(5)
    for (const e of events) fold.pushFrame(frame('session/event', { event: e })) // full replay
    expect(fold.getBlocks()).toEqual(once)
    // Strictly-new seq continues the same fold (turn/start itself adds no
    // block; the next chunk does).
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 2 }, 6) }))
    fold.pushFrame(frame('session/event', { event: chunk(2, 0, 'Next', 7) }))
    expect(fold.getBlocks().length).toBe(once.length + 1)
    expect(fold.getBlocks().at(-1).text).toBe('Next')
  })

  it('user prompts become user blocks', () => {
    const fold = createDshLedgerFold()
    fold.pushFrame(
      frame('session/event', {
        event: event(
          'user/message',
          {
            turn: 0,
            message: { role: 'user', content: [{ type: 'text', text: 'fix the build' }] },
          },
          0,
        ),
      }),
    )
    expect(fold.getBlocks()).toEqual([{ kind: 'user', seq: 0, turn: 0, text: 'fix the build' }])
  })

  it('exposes pending approvals/questions and applies outcomes', () => {
    const fold = createDshLedgerFold()
    fold.pushFrame(
      frame('approval/requested', { approvalId: 'ap1', toolName: 'bash', callId: 'c1' }),
      {
        rpcId: 'rpc-1',
      },
    )
    fold.pushFrame(
      frame('question/requested', {
        questions: [
          {
            id: 'q1',
            question: 'Which DB?',
            options: [{ label: 'postgres' }, { label: 'sqlite' }],
          },
        ],
      }),
      { rpcId: 'rpc-2' },
    )
    const pending = fold.getPendingDecisions()
    expect(pending.map((p) => p.type)).toEqual(['approval', 'question'])
    expect(pending[0].block.rpcId).toBe('rpc-1')
    // Full approval arguments come from the matched tool/call block.
    fold.pushFrame(
      frame('session/event', {
        event: event(
          'tool/call',
          { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"reboot"}' },
          0,
        ),
      }),
    )
    expect(fold.getToolCall('c1').args).toBe('{"cmd":"reboot"}')

    fold.markApprovalOutcome('ap1', 'allowed-once')
    fold.markQuestionOutcome('rpc-2', 'answered')
    expect(fold.getPendingDecisions()).toEqual([])
    // approval/resolved from another client settles unknown outcomes too.
    fold.pushFrame(frame('approval/requested', { approvalId: 'ap2', toolName: 'edit_file' }), {
      rpcId: 'rpc-3',
    })
    fold.pushFrame(frame('approval/resolved', { approvalId: 'ap2', outcome: 'rejected' }))
    expect(fold.getBlocks().at(-1).status).toBe('rejected')

    fold.pushFrame(frame('question/requested', { questions: [{ id: 'q2', question: 'Go?' }] }), {
      rpcId: 'rpc-4',
    })
    fold.pushFrame(frame('question/resolved', { rpcId: 'rpc-4', outcome: 'cancelled' }))
    expect(fold.getPendingDecisions()).toEqual([])
    fold.pushFrame(frame('question/requested', { questions: [{ id: 'q3', question: 'Stay?' }] }), {
      rpcId: 'rpc-5',
    })
    fold.pushFrame(frame('question/resolved', { questionRpcId: 'rpc-5', outcome: 'answered' }))
    expect(fold.getPendingDecisions()).toEqual([])
  })

  it('newestPendingDecision walks ledger order from the end', () => {
    expect(
      newestPendingDecision([
        { kind: 'approval', status: 'pending', rpcId: 'old' },
        { kind: 'text', text: 'x' },
        { kind: 'question', status: 'pending', rpcId: 'new' },
      ]).rpcId,
    ).toBe('new')
    expect(newestPendingDecision([{ kind: 'text', text: 'x' }])).toBeNull()
  })

  it('args preview clamps long single lines', () => {
    expect(previewToolArgs('a'.repeat(100), 60)).toHaveLength(61)
    expect(previewToolArgs('a b\n c', 60)).toBe('a b c')
  })

  it('folds tool-workflow run-start through run-end into a workflow-run block', () => {
    const fold = createDshLedgerFold()
    fold.pushEvent(
      event(
        'tool-workflow/run-start',
        { runId: 'r1', phase: 'plan', members: [{ id: 'm1', name: 'researcher' }] },
        1,
        1000,
      ),
    )
    fold.pushEvent(
      event(
        'tool-workflow/member-start',
        { runId: 'r1', memberId: 'm1', name: 'researcher' },
        2,
        1100,
      ),
    )
    fold.pushEvent(
      event('tool-workflow/member-end', { runId: 'r1', memberId: 'm1', status: 'ok' }, 3, 1200),
    )
    fold.pushEvent(event('tool-workflow/run-end', { runId: 'r1', status: 'ok' }, 4, 1300))
    const block = fold.getBlocks().find((b) => b.kind === 'workflow-run')
    expect(block).toMatchObject({
      kind: 'workflow-run',
      runId: 'r1',
      status: 'ok',
    })
    expect(Array.isArray(block.members)).toBe(true)
  })

  it('copies deliverable locations onto turn-end when present', () => {
    const fold = createDshLedgerFold()
    fold.pushEvent(event('turn/start', { turn: 1 }, 0, 1000))
    fold.pushEvent(
      event(
        'turn/end',
        {
          turn: 1,
          reason: { kind: 'completed' },
          locations: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        },
        1,
        2000,
      ),
    )
    expect(fold.getBlocks().at(-1).locations).toEqual([{ path: 'src/a.ts' }, { path: 'src/b.ts' }])
  })
})
