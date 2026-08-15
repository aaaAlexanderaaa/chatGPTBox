import { describe, expect, it } from 'vitest'
import { createDshTurnFold } from '../src/modules/dsh/turn-fold.mjs'

// Frame/event builders matching the harness wire shapes (MuxFrame payloads and
// SessionEvent envelopes from packages/host/apiproxy + packages/core/session).

const event = (type, data) => ({ type, seq: 0, time: 0, data })
const frame = (type, payload = {}) => ({ type, sessionId: 's1', ...payload })

function chunk(turn, step, text) {
  return event('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } })
}

describe('dsh turn fold', () => {
  it('accumulates streamed text and completes on turn/end', () => {
    const fold = createDshTurnFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }) }))
    let r = fold.pushFrame(frame('session/event', { event: chunk(1, 0, 'Hello') }))
    expect(r.answer).toBe('Hello')
    r = fold.pushFrame(frame('session/event', { event: chunk(1, 0, ' world') }))
    expect(r.answer).toBe('Hello world')
    expect(r.done).toBe(false)
    r = fold.pushFrame(
      frame('session/event', {
        event: event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      }),
    )
    expect(r.done).toBe(true)
    expect(r.error).toBeNull()
    expect(fold.getAnswer()).toBe('Hello world')
  })

  it('assistant/message replaces the streamed text authoritatively', () => {
    const fold = createDshTurnFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }) }))
    fold.pushFrame(frame('session/event', { event: chunk(1, 0, 'Hel') }))
    fold.pushFrame(
      frame('session/event', {
        event: event('assistant/message', {
          turn: 1,
          step: 0,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Final text' }] },
        }),
      }),
    )
    expect(fold.getAnswer()).toBe('Final text')
  })

  it('renders tool calls and results as activity lines', () => {
    const fold = createDshTurnFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }) }))
    fold.pushFrame(
      frame('session/event', {
        event: event('tool/call', {
          turn: 1,
          step: 0,
          callId: 'c1',
          name: 'read_file',
          arguments: '{"path":"a.txt"}',
        }),
      }),
    )
    fold.pushFrame(
      frame('session/event', {
        event: event('tool/result', {
          turn: 1,
          step: 0,
          message: { toolCallId: 'c1', content: [] },
        }),
      }),
    )
    expect(fold.getAnswer()).toContain('🔧 `read_file`')
    expect(fold.getAnswer()).toContain('a.txt')
  })

  it('does not complete on a turn/end of a turn it never saw start', () => {
    const fold = createDshTurnFold()
    const r = fold.pushFrame(
      frame('session/event', {
        event: event('turn/end', { turn: 7, reason: { kind: 'completed' } }),
      }),
    )
    expect(r.done).toBe(false)
  })

  it('exposes approval requests and applies outcomes', () => {
    const fold = createDshTurnFold()
    fold.pushFrame(frame('approval/requested', { approvalId: 'ap1', toolName: 'bash' }), {
      rpcId: 'rpc-1',
    })
    const pending = fold.takePendingApprovals()
    expect(pending).toEqual([{ rpcId: 'rpc-1', approvalId: 'ap1', toolName: 'bash' }])
    expect(fold.getAnswer()).toContain('bash')
    fold.markApprovalOutcome('ap1', 'allowed-once')
    expect(fold.getAnswer()).toContain('Approved')
  })

  it('turn/end with an error surfaces the failure message', () => {
    const fold = createDshTurnFold()
    fold.pushFrame(frame('session/event', { event: event('turn/start', { turn: 1 }) }))
    const r = fold.pushFrame(
      frame('session/event', {
        event: event('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { message: 'provider down' } },
        }),
      }),
    )
    expect(r.done).toBe(true)
    expect(r.error).toBe('provider down')
  })

  it('re-folding the same events (history salvage) does not duplicate output', () => {
    const fold = createDshTurnFold()
    const events = [
      event('turn/start', { turn: 1 }),
      chunk(1, 0, 'Hel'),
      chunk(1, 0, 'lo'),
      event('assistant/message', {
        turn: 1,
        step: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      }),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'ls', arguments: '{}' }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    for (const e of events) fold.pushFrame(frame('session/event', { event: e }))
    const once = fold.getAnswer()
    for (const e of events) fold.pushFrame(frame('session/event', { event: e }))
    expect(fold.getAnswer()).toBe(once)
    expect(fold.getAnswer()).toBe('Hello\n\n> 🔧 `ls` `{}`')
  })

  it('stream/error fails the fold', () => {
    const fold = createDshTurnFold()
    const r = fold.pushFrame(
      frame('stream/error', { error: { code: 'internal', message: 'boom' } }),
    )
    expect(r.done).toBe(true)
    expect(r.error).toContain('boom')
  })
})
