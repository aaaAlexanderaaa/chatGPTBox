import { describe, expect, it } from 'vitest'

// Unit tests for the conversation runtime reducers (architecture plan step 4).
//
// Covers the core conversation state machine — send -> stream -> done, the
// error path (UNAUTHORIZED/CLOUDFLARE/default), and retry record-popping — as
// PURE functions with no React, no DOM, no transport. useConversationRuntime
// is a thin React wrapper over these reducers; verifying the reducer behavior
// here is what gives the runtime its safety net.

import {
  applyInbound,
  formatErrorMessage,
  popMatchedRetryRecord,
  updateLastAnswer,
} from '../src/hooks/conversation-runtime-reducers.mjs'
import { ConversationItemData } from '../src/components/ConversationCard/conversation-item.mjs'

const t = (s) => s

describe('formatErrorMessage', () => {
  it('maps UNAUTHORIZED to a login prompt mentioning chatgpt.com', () => {
    const msg = formatErrorMessage('UNAUTHORIZED', t)
    expect(msg).toContain('UNAUTHORIZED')
    expect(msg).toContain('chatgpt.com')
  })

  it('maps CLOUDFLARE to a security-check prompt', () => {
    const msg = formatErrorMessage('CLOUDFLARE', t)
    expect(msg).toContain('Security Check Required')
    expect(msg).toContain('chatgpt.com')
  })

  it('pretty-prints a JSON error body', () => {
    const json = '{"error":"bad request","code":42}'
    const out = formatErrorMessage(json, t)
    expect(out).toContain('"code": 42')
    expect(out).toContain('"bad request"')
  })

  it('passes through a plain string error', () => {
    expect(formatErrorMessage('something broke', t)).toBe('something broke')
  })
})

describe('updateLastAnswer', () => {
  it('replaces the last answer/error content when appended=false', () => {
    const items = [
      new ConversationItemData('question', 'q'),
      new ConversationItemData('answer', 'old'),
    ]
    const out = updateLastAnswer(items, 'new', false, 'answer')
    expect(out[1].content).toBe('new')
    expect(out[1].type).toBe('answer')
    expect(out).not.toBe(items) // new array, no mutation
  })

  it('appends to existing content when appended=true', () => {
    const items = [new ConversationItemData('answer', 'Hello')]
    const out = updateLastAnswer(items, ' world', true, 'answer', true)
    expect(out[0].content).toBe('Hello world')
    expect(out[0].done).toBe(true)
  })

  it('returns the array unchanged when there is no answer/error target', () => {
    const items = [new ConversationItemData('question', 'q')]
    expect(updateLastAnswer(items, 'x', false, 'answer')).toBe(items)
  })

  it('targets the LAST answer/error item, not an earlier one', () => {
    const items = [
      new ConversationItemData('answer', 'first'),
      new ConversationItemData('question', 'q2'),
      new ConversationItemData('error', 'err'),
    ]
    const out = updateLastAnswer(items, 'fixed', false, 'answer')
    expect(out[0].content).toBe('first') // untouched
    expect(out[2].content).toBe('fixed') // updated
  })
})

describe('applyInbound (send -> stream -> done -> error)', () => {
  it('streaming: answer chunks replace the last answer, done marks it done + ready', () => {
    const base = {
      items: [new ConversationItemData('answer', '')],
      session: { id: 's' },
      isReady: false,
    }

    const a = applyInbound(base, { answer: 'Hello ' }, t)
    expect(a.items[0].content).toBe('Hello ')
    expect(a.items[0].done).toBe(false)

    const b = applyInbound({ ...base, items: a.items }, { answer: 'world' }, t)
    expect(b.items[0].content).toBe('world')

    const c = applyInbound(
      { ...base, items: b.items },
      { answer: 'final', session: { id: 's', isRetry: true }, done: true },
      t,
    )
    expect(c.items[0].content).toBe('final')
    expect(c.items[0].done).toBe(true)
    expect(c.isReady).toBe(true)
    // done clears the isRetry flag on the inbound session
    expect(c.session.isRetry).toBe(false)
  })

  it('error path: replaces a loading placeholder; appends when the last row is a finished answer', () => {
    const loading = {
      items: [new ConversationItemData('answer', '<p class="gpt-loading">Waiting...</p>')],
      session: { id: 's' },
      isReady: false,
    }
    const err = applyInbound(loading, { error: 'UNAUTHORIZED' }, t)
    expect(err.items).toHaveLength(1)
    expect(err.items[0].type).toBe('error')
    expect(err.items[0].content).toContain('UNAUTHORIZED')
    expect(err.isReady).toBe(true)

    // last item is a finished answer -> append a new error row
    const finished = {
      items: [new ConversationItemData('answer', 'done text', true)],
      session: { id: 's' },
      isReady: true,
    }
    const err2 = applyInbound(finished, { error: 'boom' }, t)
    expect(err2.items).toHaveLength(2)
    expect(err2.items[1].type).toBe('error')
    expect(err2.items[1].content).toBe('boom')
  })

  it('leaves state unchanged for a message with no recognized fields', () => {
    const base = {
      items: [new ConversationItemData('answer', 'x')],
      session: { id: 's' },
      isReady: true,
    }
    const out = applyInbound(base, { unrelated: true }, t)
    expect(out.items).toBe(base.items)
    expect(out.session).toBe(base.session)
    expect(out.isReady).toBe(base.isReady)
  })
})

describe('popMatchedRetryRecord', () => {
  it('pops the last record when items exactly mirror the last Q/A exchange', () => {
    const session = {
      conversationRecords: [
        { question: 'q1', answer: 'a1' },
        { question: 'q2', answer: 'a2' },
      ],
    }
    const items = [
      new ConversationItemData('question', 'q1', true),
      new ConversationItemData('answer', 'a1', true),
      new ConversationItemData('question', 'q2', true),
      new ConversationItemData('answer', 'a2', true), // done, matches last record
    ]
    const out = popMatchedRetryRecord(session, items)
    expect(out).toHaveLength(1)
    expect(out[0].question).toBe('q1')
  })

  it('does NOT pop when the last item is not done (streaming)', () => {
    const session = { conversationRecords: [{ question: 'q1', answer: 'a1' }] }
    const items = [
      new ConversationItemData('question', 'q1', true),
      new ConversationItemData('answer', 'a1', false), // not done
    ]
    const out = popMatchedRetryRecord(session, items)
    expect(out).toHaveLength(1)
  })

  it('does NOT pop when the last question does not match the second-to-last item', () => {
    const session = { conversationRecords: [{ question: 'q1', answer: 'a1' }] }
    const items = [
      new ConversationItemData('question', 'DIFFERENT', true),
      new ConversationItemData('answer', 'a1', true),
    ]
    const out = popMatchedRetryRecord(session, items)
    expect(out).toHaveLength(1)
  })

  it('handles empty/missing records gracefully', () => {
    expect(popMatchedRetryRecord({}, [])).toEqual([])
    expect(popMatchedRetryRecord({ conversationRecords: [] }, [])).toEqual([])
  })
})
