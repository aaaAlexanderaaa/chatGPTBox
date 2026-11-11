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

it('ends an owned loading placeholder on Stop without deleting a provider answer', () => {
  const base = {
    items: [new ConversationItemData('answer', '', false)],
    session: {},
    isReady: true,
  }
  const waiting = applyInbound(base, { preparing: true }, t)
  const stopped = applyInbound(waiting, { done: true, outcome: 'stopped' }, t)
  expect(stopped.items[0]).toMatchObject({ content: '', done: true, outcome: 'stopped' })
  expect(stopped.items[0].placeholder).toBeUndefined()
  const realText = '<p class="gpt-loading">A model describing this markup</p>'
  const streamed = applyInbound(waiting, { answer: realText }, t)
  expect(applyInbound(streamed, { done: true, outcome: 'stopped' }, t).items[0].content).toBe(
    realText,
  )
})

it('identifies the successful first answer when the initial question has no rendered row', () => {
  const session = {
    question: 'initial material',
    conversationRecords: [{ question: 'initial material', answer: 'old answer' }],
  }
  const item = Object.assign(new ConversationItemData('answer', 'old answer', true), {
    outcome: 'completed',
  })
  expect(popMatchedRetryRecord(session, [item])).toEqual([])
})

it.each([
  { question: 'different material', answer: 'old answer', outcome: 'completed' },
  { question: 'initial material', answer: 'different answer', outcome: 'completed' },
  { question: 'initial material', answer: 'old answer', outcome: 'stopped' },
])('keeps an unmatched or unsuccessful initial answer: %j', ({ question, answer, outcome }) => {
  const records = [{ question: 'initial material', answer: 'old answer' }]
  const session = { question, conversationRecords: [...records] }
  const item = Object.assign(new ConversationItemData('answer', answer, true), { outcome })
  expect(popMatchedRetryRecord(session, [item])).toEqual(records)
})

it('keeps a combined error/done/outcome message terminal at an initially loading answer', () => {
  const result = applyInbound(
    {
      items: [new ConversationItemData('answer', '<p class="gpt-loading">Waiting</p>')],
      session: {},
      isReady: false,
    },
    { error: 'endpoint changed', done: true, outcome: 'failed' },
    t,
  )
  expect(result.items.at(-1)).toMatchObject({
    type: 'error',
    done: true,
    outcome: 'failed',
    content: 'endpoint changed',
  })
  expect(result.isReady).toBe(true)
})

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
      items: [new ConversationItemData('answer', 'partial text')],
      session: { id: 's' },
      isReady: false,
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

  it('keeps an earlier completed record when retrying a failed repeat of the same question', () => {
    const session = { conversationRecords: [{ question: 'repeat', answer: 'earlier answer' }] }
    const failed = applyInbound(
      {
        session,
        isReady: false,
        items: [
          new ConversationItemData('question', 'repeat'),
          new ConversationItemData('answer', '<p class="gpt-loading">Waiting...</p>'),
        ],
      },
      { error: 'upstream failed' },
      t,
    )
    expect(failed.items.at(-1)).toMatchObject({ type: 'error', done: true, outcome: 'failed' })
    expect(popMatchedRetryRecord(session, failed.items)).toEqual([
      { question: 'repeat', answer: 'earlier answer' },
    ])
  })

  it.each(['stopped', 'incomplete'])(
    'keeps the earlier completed exchange when the repeated question ends %s',
    (outcome) => {
      const session = {
        conversationRecords: [{ question: 'repeat', answer: 'same visible text' }],
      }
      const result = applyInbound(
        {
          session,
          isReady: false,
          items: [
            new ConversationItemData('question', 'repeat'),
            new ConversationItemData('answer', 'same visible text'),
          ],
        },
        { done: true, outcome },
        t,
      )
      expect(popMatchedRetryRecord(session, result.items)).toEqual([
        { question: 'repeat', answer: 'same visible text' },
      ])
    },
  )

  it('keeps a same-question record when the visible answer belongs to another exchange', () => {
    const session = { conversationRecords: [{ question: 'repeat', answer: 'earlier answer' }] }
    expect(
      popMatchedRetryRecord(session, [
        new ConversationItemData('question', 'repeat', true),
        new ConversationItemData('answer', 'different answer', true),
      ]),
    ).toEqual([{ question: 'repeat', answer: 'earlier answer' }])
  })

  it('matches the confirmed final body when display text also contains tool progress', () => {
    const session = { conversationRecords: [{ question: 'task', answer: 'final body' }] }
    const item = Object.assign(
      new ConversationItemData('answer', 'Tool progress\nfinal body', true),
      {
        outcome: 'completed',
        finalContent: 'final body',
      },
    )
    expect(
      popMatchedRetryRecord(session, [new ConversationItemData('question', 'task', true), item]),
    ).toEqual([])
  })
  it('also matches a completed provider record that persists its display form', () => {
    const display = '<details>Reasoning</details>Final body'
    const session = { conversationRecords: [{ question: 'task', answer: display }] }
    const item = Object.assign(new ConversationItemData('answer', display, true), {
      outcome: 'completed',
      finalContent: 'Final body',
    })
    expect(
      popMatchedRetryRecord(session, [new ConversationItemData('question', 'task', true), item]),
    ).toEqual([])
  })
})

it('keeps Stop/error terminal status through trailing done and allows an explicit new run', () => {
  const base = {
    items: [new ConversationItemData('answer', 'partial')],
    session: {},
    isReady: false,
  }
  const stopped = applyInbound(base, { done: true, outcome: 'stopped' }, t)
  expect(applyInbound(stopped, { done: true }, t).items[0].outcome).toBe('stopped')
  const failed = applyInbound(base, { error: 'upstream failed' }, t)
  expect(applyInbound(failed, { done: true }, t).items[0]).toMatchObject({
    content: 'partial',
    outcome: 'failed',
  })
  const restarted = updateLastAnswer(stopped.items, 'new run', false, 'answer')
  expect(restarted[0].outcome).toBeUndefined()
})

it.each(['stopped', 'incomplete', 'failed'])(
  'does not revive a %s result when a late terminal frame also carries answer text',
  (outcome) => {
    const base = {
      items: [new ConversationItemData('answer', 'partial')],
      session: {},
      isReady: false,
    }
    const settled =
      outcome === 'failed'
        ? applyInbound(base, { error: 'upstream failed' }, t)
        : applyInbound(base, { done: true, outcome }, t)
    const trailing = applyInbound(
      settled,
      { answer: 'late text', finalContent: 'late text', done: true, outcome: 'completed' },
      t,
    )
    expect(trailing.items[0]).toMatchObject({ content: 'partial', outcome, done: true })
    expect(trailing.items.some((item) => item.outcome === 'completed')).toBe(false)
    expect(trailing.items.at(-1).finalContent).toBeUndefined()
    expect(trailing.isReady).toBe(true)

    const restarted = {
      ...trailing,
      items: updateLastAnswer(trailing.items, 'retry loading', false, 'answer'),
      isReady: false,
    }
    const complete = applyInbound(
      restarted,
      { answer: 'fresh answer', finalContent: 'fresh answer', done: true, outcome: 'completed' },
      t,
    )
    expect(complete.items.at(-1)).toMatchObject({
      content: 'fresh answer',
      finalContent: 'fresh answer',
      outcome: 'completed',
      done: true,
    })
  },
)
it('keeps completed answers immutable until an explicit new start', () => {
  const completed = applyInbound(
    { items: [new ConversationItemData('answer', '')], session: { id: 'current' }, isReady: false },
    { answer: 'final', finalContent: 'final', done: true, outcome: 'completed' },
    t,
  )
  const late = applyInbound(
    completed,
    { answer: 'late delta', error: 'late error', session: { id: 'stale' }, done: true },
    t,
  )
  expect(late).toBe(completed)
  expect(late.items[0]).toMatchObject({
    done: true,
    outcome: 'completed',
    content: 'final',
    finalContent: 'final',
  })
  const started = applyInbound(completed, { started: true, session: { id: 'new' } }, t)
  expect(started.isReady).toBe(false)
  expect(started.items[0].done).toBe(false)
  expect(started.items[0].finalContent).toBeUndefined()
  const fresh = applyInbound(
    started,
    { answer: 'new answer', finalContent: 'new answer', done: true, outcome: 'completed' },
    t,
  )
  expect(fresh.items[0].finalContent).toBe('new answer')
})
it('appends a prepared UI retry without replacing an earlier identical question', async () => {
  const { pushRecord } = await import('../src/services/apis/shared.mjs')
  const records = [
    { question: 'repeat', answer: 'first answer' },
    { question: 'repeat', answer: 'second answer' },
  ]
  const prepared = { conversationRecords: [...records] }
  popMatchedRetryRecord(prepared, [
    new ConversationItemData('question', 'repeat', true),
    new ConversationItemData('answer', 'second answer', true),
  ])
  const retry = { ...prepared, isRetry: true, appendRetryRecord: true }
  pushRecord(retry, 'repeat', 'replacement for second answer')
  expect(retry.conversationRecords).toEqual([
    { question: 'repeat', answer: 'first answer' },
    { question: 'repeat', answer: 'replacement for second answer' },
  ])
  expect(records).toEqual([
    { question: 'repeat', answer: 'first answer' },
    { question: 'repeat', answer: 'second answer' },
  ])
})
it('keeps a changed replacement target in request context and appends without overwriting it', async () => {
  const { pushRecord, getRequestConversationRecords } = await import(
    '../src/services/apis/shared.mjs'
  )
  const session = {
    question: 'repeat',
    isRetry: true,
    appendRetryRecord: true,
    conversationRecords: [{ question: 'repeat', answer: 'Changed saved answer' }],
    retryReplacement: { index: 0, question: 'repeat', answer: 'Earlier target answer' },
  }
  expect(getRequestConversationRecords(session)).toEqual(session.conversationRecords)
  pushRecord(session, 'repeat', 'New completed answer')
  expect(session.conversationRecords).toEqual([
    { question: 'repeat', answer: 'Changed saved answer' },
    { question: 'repeat', answer: 'New completed answer' },
  ])
  expect(session.retryReplacement).toBeUndefined()
})
