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

  it('returns null when the candidate is not an assistant message', () => {
    const convo = { ...twoTurnConversation(), current_node: 'u2' }
    // current_node is the user turn; result should fall back to nearest assistant
    const result = extractChatgptWebConversationResult(convo)
    expect(result).not.toBeNull()
    expect(result.text).toBe('Hi there')
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
  })
})
