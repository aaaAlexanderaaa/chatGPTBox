import { describe, expect, it } from 'vitest'

// Coverage extension for the chatgpt-web API bridge READ path (architecture
// plan step 9). The existing chatgpt-web-state.test.mjs covers the thinking
// predicates, status flags, and selectChatgptWebRefreshResult. The functions
// the local API Server Bridge calls to SHAPE responses — the conversation-
// list formatter, snapshot formatter, list-item extractor, and the conversation
// result/query/messages extractors — had no coverage. These tests fill that
// gap so the bridge's happy path (list -> get -> format) has a safety net.

import {
  extractChatgptWebConversationListItems,
  extractChatgptWebConversationMessages,
  extractChatgptWebConversationResult,
  extractChatgptWebConversationThinking,
  formatChatgptWebConversationListItem,
  formatChatgptWebConversationSnapshot,
  formatChatgptWebThoughtDurationText,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'

describe('extractChatgptWebConversationListItems', () => {
  it('returns the array when the response is itself an array', () => {
    expect(extractChatgptWebConversationListItems([{ id: 'a' }])).toEqual([{ id: 'a' }])
  })

  it('reads response.items', () => {
    expect(extractChatgptWebConversationListItems({ items: [{ id: 'a' }] })).toEqual([{ id: 'a' }])
  })

  it('reads response.conversations as a fallback shape', () => {
    expect(extractChatgptWebConversationListItems({ conversations: [{ id: 'a' }] })).toEqual([
      { id: 'a' },
    ])
  })

  it('returns [] for shapes it does not recognize', () => {
    expect(extractChatgptWebConversationListItems(null)).toEqual([])
    expect(extractChatgptWebConversationListItems({})).toEqual([])
    expect(extractChatgptWebConversationListItems({ foo: [] })).toEqual([])
  })
})

describe('formatChatgptWebConversationListItem', () => {
  it('maps the upstream item fields to the bridge list shape', () => {
    const out = formatChatgptWebConversationListItem({
      id: 'c1',
      title: 'Hello',
      create_time: 1_700_000_000,
      update_time: 1_700_000_500,
      async_status: 'completed',
      is_archived: false,
      is_starred: true,
      workspace_id: 'w1',
      snippet: 'hi there',
      safe_urls: ['u1', 'u2'],
      blocked_urls: ['x1'],
    })
    // Verify each mapped field; `pending` is derived by isPendingChatgptWebConversation
    // and exercised in chatgpt-web-state.test.mjs, so here we just assert it's a boolean.
    expect(out.id).toBe('c1')
    expect(out.title).toBe('Hello')
    expect(out.createTime).toBe(1_700_000_000)
    expect(out.updateTime).toBe(1_700_000_500)
    expect(out.asyncStatus).toBe('completed')
    expect(typeof out.pending).toBe('boolean')
    expect(out.isArchived).toBe(false)
    expect(out.isStarred).toBe(true)
    expect(out.workspaceId).toBe('w1')
    expect(out.snippet).toBe('hi there')
    expect(out.safeUrlCount).toBe(2)
    expect(out.blockedUrlCount).toBe(1)
  })

  it('defaults gracefully for an empty item', () => {
    const out = formatChatgptWebConversationListItem({})
    expect(out.id).toBeNull()
    expect(out.title).toBe('')
    expect(out.createTime).toBeNull()
    expect(out.updateTime).toBeNull()
    expect(out.asyncStatus).toBeNull()
    expect(typeof out.pending).toBe('boolean')
    expect(out.isArchived).toBe(false)
    expect(out.isStarred).toBe(false)
    expect(out.workspaceId).toBeNull()
    expect(out.snippet).toBeNull()
    expect(out.safeUrlCount).toBe(0)
    expect(out.blockedUrlCount).toBe(0)
  })
})

// A minimal two-turn conversation mapping (user -> assistant) used by the
// extractors below. The shape mirrors what the ChatGPT Web backend returns.
function twoTurnConversation() {
  return {
    current_node: 'a2',
    async_status: null,
    mapping: {
      root: { id: 'root', message: null, parent: null },
      u1: {
        id: 'u1',
        parent: 'root',
        message: {
          id: 'u1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Hello'] },
          create_time: 1,
        },
      },
      a1: {
        id: 'a1',
        parent: 'u1',
        message: {
          id: 'a1',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['Hi there'] },
          status: 'finished_successfully',
          end_turn: true,
        },
      },
      u2: {
        id: 'u2',
        parent: 'a1',
        message: {
          id: 'u2',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Bye'] },
          create_time: 2,
        },
      },
      a2: {
        id: 'a2',
        parent: 'u2',
        message: {
          id: 'a2',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['Goodbye'] },
          status: 'finished_successfully',
          end_turn: true,
        },
      },
    },
  }
}

function thinkingConversation({
  finishedDurationSec = 90,
  finishedText = 'Thought for 1m 30s',
  extraThinkingNodes = [],
} = {}) {
  const mapping = {
    root: { id: 'root', message: null, parent: null },
    u1: {
      id: 'u1',
      parent: 'root',
      message: {
        id: 'u1',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Think hard'] },
        create_time: 1,
      },
    },
    t1: {
      id: 't1',
      parent: 'u1',
      message: {
        id: 't1',
        author: { role: 'assistant' },
        content: { content_type: 'thoughts', thoughts: [{ summary: 'plan', content: 'step' }] },
        status: 'finished_successfully',
        create_time: 10,
        update_time: 100,
        metadata: {
          reasoning_status: 'reasoning_ended',
          finished_duration_sec: finishedDurationSec,
          finished_text: finishedText,
        },
      },
    },
    a1: {
      id: 'a1',
      parent: extraThinkingNodes.at(-1)?.id || 't1',
      message: {
        id: 'a1',
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['Done'] },
        status: 'finished_successfully',
        end_turn: true,
      },
    },
  }

  extraThinkingNodes.forEach((node, index) => {
    const parent = index === 0 ? 't1' : extraThinkingNodes[index - 1].id
    mapping[node.id] = { ...node, parent }
  })

  return {
    conversation_id: 'c-think',
    current_node: 'a1',
    async_status: null,
    mapping,
  }
}

// A reasoning thread the way ChatGPT Web actually returns one: every turn owns a
// `thoughts` node without official timing plus a `reasoning_recap` node that
// carries `finished_duration_sec`. Both nodes span the same reasoning window, so
// a timestamp-derived duration would count each turn twice.
function reasoningThread(turns) {
  const mapping = { root: { id: 'root', message: null, parent: null } }
  let parent = 'root'

  turns.forEach(({ thought, finishedText, answer }, index) => {
    const n = index + 1
    const base = 1_757_000_000 + index * 600

    mapping[`u${n}`] = {
      id: `u${n}`,
      parent,
      message: {
        id: `u${n}`,
        author: { role: 'user' },
        content: { content_type: 'text', parts: [`question ${n}`] },
        create_time: base,
      },
    }
    mapping[`t${n}`] = {
      id: `t${n}`,
      parent: `u${n}`,
      message: {
        id: `t${n}`,
        author: { role: 'assistant' },
        content: { content_type: 'thoughts', thoughts: [{ summary: 'plan', content: 'step' }] },
        status: 'finished_successfully',
        create_time: base + 1,
        update_time: base + 1 + thought,
        metadata: { reasoning_status: 'reasoning_ended' },
      },
    }
    mapping[`r${n}`] = {
      id: `r${n}`,
      parent: `t${n}`,
      message: {
        id: `r${n}`,
        author: { role: 'assistant' },
        content: { content_type: 'reasoning_recap', parts: [finishedText] },
        status: 'finished_successfully',
        create_time: base + 1 + thought,
        update_time: base + 1 + thought,
        metadata: { finished_duration_sec: thought, finished_text: finishedText },
      },
    }
    mapping[`a${n}`] = {
      id: `a${n}`,
      parent: `r${n}`,
      message: {
        id: `a${n}`,
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: [answer] },
        status: 'finished_successfully',
        channel: 'final',
        end_turn: true,
        create_time: base + 2 + thought,
      },
    }
    parent = `a${n}`
  })

  return {
    conversation_id: 'c-reasoning',
    current_node: `a${turns.length}`,
    async_status: null,
    mapping,
  }
}

describe('extractChatgptWebConversationMessages', () => {
  it('walks the root path and emits alternating user/assistant turns', () => {
    const messages = extractChatgptWebConversationMessages(twoTurnConversation())
    expect(messages.length).toBeGreaterThanOrEqual(3) // 2 user + (1 or 2 assistant)
    // First message is the first user turn
    expect(messages[0].role).toBe('user')
    expect(messages[0].text).toBe('Hello')
    // The assistant reply follows
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].text).toBe('Hi there')
  })

  it('returns [] when there is no mapping', () => {
    expect(extractChatgptWebConversationMessages({})).toEqual([])
    expect(extractChatgptWebConversationMessages({ mapping: null })).toEqual([])
  })

  it('keeps each turn thinking time on that turn answer, not on the conversation', () => {
    const messages = extractChatgptWebConversationMessages(
      reasoningThread([
        { thought: 300, finishedText: 'Thought for 5m 0s', answer: 'long first answer' },
        { thought: 45, finishedText: 'Thought for 45 seconds', answer: 'second' },
        { thought: 20, finishedText: 'Thought for 20 seconds', answer: 'third' },
      ]),
    )
    const assistants = messages.filter((message) => message.role === 'assistant')
    expect(assistants.map((message) => message.messageId)).toEqual(['a1', 'a2', 'a3'])
    expect(assistants.map((message) => message.thoughtDurationSec)).toEqual([300, 45, 20])
    expect(assistants.map((message) => message.thoughtDurationText)).toEqual(['5m', '45s', '20s'])
  })

  it('leaves user messages free of thinking time', () => {
    const messages = extractChatgptWebConversationMessages(
      reasoningThread([{ thought: 20, finishedText: 'Thought for 20 seconds', answer: 'ok' }]),
    )
    const user = messages.find((message) => message.role === 'user')
    expect(user).toBeDefined()
    expect(user).not.toHaveProperty('thoughtDurationSec')
  })
})

describe('extractChatgptWebConversationResult', () => {
  it('returns the final assistant message from the current node', () => {
    const result = extractChatgptWebConversationResult(twoTurnConversation())
    expect(result).not.toBeNull()
    expect(result.status).toBe('finished_successfully')
    expect(result.text).toBe('Goodbye')
    expect(result.isFinal).toBe(true)
    expect(result.messageId).toBe('a2')
  })

  it('picks the latest turn even when an earlier answer is far longer', () => {
    // Text length used to be worth up to 4000 points against 2500 for being the
    // current node, so a long opening answer won over short follow-ups and the
    // snapshot reported the wrong turn's answer, query, and thinking time.
    const conversation = reasoningThread([
      { thought: 300, finishedText: 'Thought for 5m 0s', answer: 'A'.repeat(4000) },
      { thought: 45, finishedText: 'Thought for 45 seconds', answer: 'short' },
      { thought: 20, finishedText: 'Thought for 20 seconds', answer: 'shorter' },
    ])
    const result = extractChatgptWebConversationResult(conversation)
    expect(result.messageId).toBe('a3')
  })

  it('lets an explicit assistantMessageId outrank the current node', () => {
    const conversation = reasoningThread([
      { thought: 300, finishedText: 'Thought for 5m 0s', answer: 'first' },
      { thought: 20, finishedText: 'Thought for 20 seconds', answer: 'second' },
    ])
    expect(conversation.current_node).toBe('a2')
    const result = extractChatgptWebConversationResult(conversation, {
      assistantMessageId: 'a1',
    })
    expect(result.messageId).toBe('a1')
  })

  it('returns null when the candidate is not an assistant message', () => {
    const convo = { ...twoTurnConversation(), current_node: 'u2' }
    // current_node is the user turn; result should fall back to nearest assistant
    const result = extractChatgptWebConversationResult(convo)
    expect(result).not.toBeNull()
    expect(result.text).toBe('Hi there')
  })
})

// The moment right after a follow-up send: the previous turn is complete, and
// the new user message either has not reached the snapshot yet or is there
// without an answer. `current_node` still points at the previous answer.
function conversationAfterSend({ includeNewUserTurn = false, answerText = null } = {}) {
  const conversation = twoTurnConversation()
  conversation.mapping.root.children = ['u1']
  conversation.mapping.u1.children = ['a1']
  conversation.mapping.a1.children = ['u2']
  conversation.mapping.u2.children = ['a2']
  conversation.mapping.a2.children = []
  if (includeNewUserTurn) {
    conversation.mapping.a2.children = ['u3']
    conversation.mapping.u3 = {
      id: 'u3',
      parent: 'a2',
      children: [],
      message: {
        id: 'u3',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Follow-up'] },
        create_time: 3,
      },
    }
    if (answerText !== null) {
      conversation.mapping.u3.children = ['a3']
      conversation.mapping.a3 = {
        id: 'a3',
        parent: 'u3',
        children: [],
        message: {
          id: 'a3',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: [answerText] },
          status: 'in_progress',
          create_time: 4,
        },
      }
    }
  }
  return conversation
}

describe('user_message_id anchoring', () => {
  it('falls back to the current branch when the anchored user turn is not in the snapshot', () => {
    // An id the snapshot does not know cannot narrow the selection. The client
    // poller relies on this: its fixtures carry a user id that differs from the
    // session's, and polling must still complete. Callers that need to know the
    // turn is missing look for it in `messages`.
    const snapshot = formatChatgptWebConversationSnapshot(conversationAfterSend(), {
      userMessageId: 'u3',
    })
    expect(snapshot.message.messageId).toBe('a2')
    expect(snapshot.query).toBe('Bye')
    expect(snapshot.messages.map((message) => message.messageId)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(snapshot.messages.some((message) => message.messageId === 'u3')).toBe(false)
  })

  it('reports no top-level thinking time when the anchored turn has no answer', () => {
    const conversation = reasoningThread([
      { thought: 300, finishedText: 'Thought for 5m 0s', answer: 'first' },
    ])
    conversation.mapping.a1.children = ['u2']
    conversation.mapping.u2 = {
      id: 'u2',
      parent: 'a1',
      children: [],
      message: {
        id: 'u2',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['question 2'] },
        create_time: 1_757_000_900,
      },
    }
    const snapshot = formatChatgptWebConversationSnapshot(conversation, { userMessageId: 'u2' })
    expect(snapshot.message).toBeNull()
    expect(snapshot.thoughtDurationSec).toBeNull()
    expect(snapshot.thoughtDurationText).toBeNull()
  })

  it('reports no answer when the anchored user turn has no assistant beneath it', () => {
    const snapshot = formatChatgptWebConversationSnapshot(
      conversationAfterSend({ includeNewUserTurn: true }),
      { userMessageId: 'u3' },
    )
    expect(snapshot.message).toBeNull()
    expect(snapshot.query).toBe('Follow-up')
    expect(snapshot.queryMessage.messageId).toBe('u3')
  })

  it('includes the anchored user turn in messages even before current_node moves to it', () => {
    const conversation = conversationAfterSend({ includeNewUserTurn: true })
    expect(conversation.current_node).toBe('a2')
    const snapshot = formatChatgptWebConversationSnapshot(conversation, { userMessageId: 'u3' })
    expect(snapshot.messages.map((message) => message.messageId)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3',
    ])
    expect(snapshot.messages.at(-1)).toMatchObject({ role: 'user', text: 'Follow-up' })
  })

  it('follows the anchored turn down to its in-progress answer', () => {
    const snapshot = formatChatgptWebConversationSnapshot(
      conversationAfterSend({ includeNewUserTurn: true, answerText: 'partial' }),
      { userMessageId: 'u3' },
    )
    expect(snapshot.message).toMatchObject({
      messageId: 'a3',
      text: 'partial',
      status: 'in_progress',
    })
    expect(snapshot.messages.map((message) => message.messageId)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3',
      'a3',
    ])
  })

  it('still honors an explicit assistantMessageId when the user anchor is unknown', () => {
    const result = extractChatgptWebConversationResult(conversationAfterSend(), {
      userMessageId: 'ghost',
      assistantMessageId: 'a1',
    })
    expect(result.messageId).toBe('a1')
  })

  it('keeps the unanchored behavior when no userMessageId is given', () => {
    const snapshot = formatChatgptWebConversationSnapshot(
      conversationAfterSend({ includeNewUserTurn: true }),
    )
    expect(snapshot.message.messageId).toBe('a2')
    expect(snapshot.messages.map((message) => message.messageId)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })
})

describe('formatChatgptWebThoughtDurationText', () => {
  it('formats seconds the way ChatGPT shows thought timing', () => {
    expect(formatChatgptWebThoughtDurationText(12)).toBe('12s')
    expect(formatChatgptWebThoughtDurationText(60)).toBe('1m')
    expect(formatChatgptWebThoughtDurationText(90)).toBe('1m 30s')
  })
})

describe('extractChatgptWebConversationThinking', () => {
  it('returns an array (possibly empty) without throwing', () => {
    const thinking = extractChatgptWebConversationThinking(twoTurnConversation())
    expect(Array.isArray(thinking)).toBe(true)
  })

  it('returns [] for a conversation with no mapping', () => {
    expect(extractChatgptWebConversationThinking({})).toEqual([])
  })

  it('exposes official finished_duration_sec as durationSec', () => {
    const thinking = extractChatgptWebConversationThinking(thinkingConversation())
    expect(thinking).toHaveLength(1)
    expect(thinking[0].finishedDurationSec).toBe(90)
    expect(thinking[0].finishedText).toBe('Thought for 1m 30s')
    expect(thinking[0].durationSec).toBe(90)
    expect(thinking[0].durationText).toBe('1m 30s')
  })

  it('falls back to update_time - reasoning_start_time when duration is missing', () => {
    const conversation = thinkingConversation({
      finishedDurationSec: null,
      finishedText: '',
    })
    conversation.mapping.t1.message.create_time = 1
    conversation.mapping.t1.message.update_time = 45
    conversation.mapping.t1.message.metadata = {
      reasoning_status: 'reasoning_ended',
      reasoning_start_time: 10,
    }
    const thinking = extractChatgptWebConversationThinking(conversation)
    expect(thinking[0].finishedDurationSec).toBeNull()
    expect(thinking[0].durationSec).toBe(35)
    expect(thinking[0].durationText).toBe('35s')
  })
})

describe('formatChatgptWebConversationSnapshot', () => {
  it('composes the assistant result + user query + messages into the bridge snapshot shape', () => {
    const snapshot = formatChatgptWebConversationSnapshot(twoTurnConversation())
    // The snapshot exposes the assistant message under `message` and the user
    // query under `query`/`queryMessage`.
    expect(snapshot).toHaveProperty('message')
    expect(snapshot.message).not.toBeNull()
    expect(snapshot.message.text).toBe('Goodbye')
    expect(snapshot.query).toBe('Bye')
    expect(snapshot.queryMessage).not.toBeNull()
    expect(Array.isArray(snapshot.messages)).toBe(true)
    expect(snapshot.messages.length).toBeGreaterThan(0)
  })

  it('leaves thinking undefined when think is not requested', () => {
    const snapshot = formatChatgptWebConversationSnapshot(twoTurnConversation())
    expect(snapshot.thinking).toBeUndefined()
  })

  it('includes thinking as an array when think=true', () => {
    const snapshot = formatChatgptWebConversationSnapshot(twoTurnConversation(), {
      think: true,
    })
    expect(Array.isArray(snapshot.thinking)).toBe(true)
  })

  it('does not throw on an empty conversation', () => {
    const snapshot = formatChatgptWebConversationSnapshot({})
    expect(snapshot.messages).toEqual([])
    expect(snapshot.message).toBeNull()
    expect(snapshot.thoughtDurationSec).toBeNull()
    expect(snapshot.thoughtDurationText).toBeNull()
  })

  it('returns thought duration even when think is not requested', () => {
    const snapshot = formatChatgptWebConversationSnapshot(thinkingConversation())
    expect(snapshot.thinking).toBeUndefined()
    expect(snapshot.thoughtDurationSec).toBe(90)
    expect(snapshot.thoughtDurationText).toBe('1m 30s')
  })

  it('counts a turn once when only the recap node carries official timing', () => {
    // The `thoughts` node spans the same 90s window as the recap node. Summing a
    // timestamp-derived duration alongside the official one reported 3m for a
    // 1m 30s turn.
    const snapshot = formatChatgptWebConversationSnapshot(
      reasoningThread([{ thought: 90, finishedText: 'Thought for 1m 30s', answer: 'done' }]),
    )
    expect(snapshot.thoughtDurationSec).toBe(90)
    expect(snapshot.thoughtDurationText).toBe('1m 30s')
  })

  it("reuses ChatGPT's own finished_text when the turn has a single timed segment", () => {
    const snapshot = formatChatgptWebConversationSnapshot(
      reasoningThread([{ thought: 3, finishedText: 'Thought for a few seconds', answer: 'done' }]),
    )
    expect(snapshot.thoughtDurationLabel).toBe('Thought for a few seconds')
  })

  it('reports no timing rather than inventing one from node timestamps', () => {
    const conversation = reasoningThread([
      { thought: 90, finishedText: 'Thought for 1m 30s', answer: 'done' },
    ])
    conversation.mapping.a1.parent = 't1'
    delete conversation.mapping.r1

    const snapshot = formatChatgptWebConversationSnapshot(conversation)
    expect(snapshot.thoughtDurationSec).toBeNull()
    expect(snapshot.thoughtDurationText).toBeNull()
    expect(snapshot.thoughtDurationLabel).toBeNull()
  })

  it('reports the timing of whichever turn produced `message`', () => {
    // Which answer `message` points at is decided by assistant-candidate
    // scoring, so assert the invariant instead: the top-level timing always
    // describes the same turn as the answer the snapshot returns.
    const threads = [
      reasoningThread([
        { thought: 300, finishedText: 'Thought for 5m 0s', answer: 'A'.repeat(4000) },
        { thought: 20, finishedText: 'Thought for 20 seconds', answer: 'short' },
      ]),
      reasoningThread([
        { thought: 20, finishedText: 'Thought for 20 seconds', answer: 'short' },
        { thought: 300, finishedText: 'Thought for 5m 0s', answer: 'A'.repeat(4000) },
      ]),
    ]

    for (const conversation of threads) {
      const snapshot = formatChatgptWebConversationSnapshot(conversation)
      const answer = snapshot.messages.find(
        (message) => message.messageId === snapshot.message.messageId,
      )
      expect(answer).toBeDefined()
      expect(snapshot.thoughtDurationSec).toBe(answer.thoughtDurationSec)
      expect(snapshot.thoughtDurationText).toBe(answer.thoughtDurationText)
    }
  })

  it('sums thinking-node durations and exposes them on each entry when think=true', () => {
    const snapshot = formatChatgptWebConversationSnapshot(
      thinkingConversation({
        extraThinkingNodes: [
          {
            id: 't2',
            message: {
              id: 't2',
              author: { role: 'assistant' },
              content: { content_type: 'reasoning_recap', parts: ['recap'] },
              status: 'finished_successfully',
              metadata: { finished_duration_sec: 12 },
            },
          },
        ],
      }),
      { think: true },
    )
    expect(snapshot.thinking.map((entry) => entry.durationSec)).toEqual([90, 12])
    expect(snapshot.thoughtDurationSec).toBe(102)
    expect(snapshot.thoughtDurationText).toBe('1m 42s')
  })
})
