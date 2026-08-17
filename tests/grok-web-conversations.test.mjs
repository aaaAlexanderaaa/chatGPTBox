import { describe, expect, it } from 'vitest'
import {
  getGrokConversation,
  listGrokConversations,
  normalizeGrokConversationList,
  normalizeGrokConversationSnapshot,
} from '../src/services/clients/grok-web/conversations.mjs'

describe('normalizeGrokConversationList', () => {
  it('reads conversations[]', () => {
    const out = normalizeGrokConversationList({
      conversations: [{ conversationId: 'c1', title: 'Hello' }],
    })
    expect(out.items[0]).toMatchObject({ conversationId: 'c1', title: 'Hello' })
    expect(out.total).toBe(1)
  })
})

describe('normalizeGrokConversationSnapshot', () => {
  it('flattens response nodes into messages', () => {
    const out = normalizeGrokConversationSnapshot(
      {
        responseNodes: [
          { sender: 'human', message: 'q', responseId: 'u1' },
          { sender: 'assistant', message: 'a', responseId: 'a1' },
        ],
      },
      'c1',
    )
    expect(out.conversationId).toBe('c1')
    expect(out.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ])
    expect(out.previousResponseID).toBe('u1')
  })

  it('uses the last human responseId as the chat/SSE parent, not the assistant id', () => {
    const out = normalizeGrokConversationSnapshot(
      {
        responseNodes: [
          { sender: 'human', message: 'q1', responseId: 'u1' },
          { sender: 'assistant', message: 'a1', responseId: 'a1' },
          { sender: 'human', message: 'q2', responseId: 'u2' },
          { sender: 'assistant', message: 'a2', responseId: 'a2' },
        ],
      },
      'c1',
    )
    expect(out.previousResponseID).toBe('u2')
  })
})

describe('list/get use GET only', () => {
  it('lists with GET', async () => {
    const methods = []
    await listGrokConversations({
      pageSize: 20,
      fetch: async (url, init) => {
        methods.push(init?.method || 'GET')
        expect(String(url)).toContain('/rest/app-chat/conversations')
        return new Response(JSON.stringify({ conversations: [] }), { status: 200 })
      },
    })
    expect(methods).toEqual(['GET'])
  })

  it('gets a snapshot with GET', async () => {
    const methods = []
    await getGrokConversation({
      conversationId: 'c1',
      fetch: async (url, init) => {
        methods.push(init?.method || 'GET')
        expect(String(url)).toContain('/conversations/c1/response-node')
        return new Response(JSON.stringify({ responseNodes: [] }), { status: 200 })
      },
    })
    expect(methods).toEqual(['GET'])
  })

  it('surfaces 429 on GET without POST', async () => {
    const methods = []
    await expect(
      listGrokConversations({
        pageSize: 20,
        fetch: async (_url, init) => {
          methods.push(init?.method || 'GET')
          return new Response('rate limited', { status: 429 })
        },
      }),
    ).rejects.toThrow(/429/)
    expect(methods).toEqual(['GET'])
  })
})
