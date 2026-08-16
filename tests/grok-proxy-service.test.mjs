import { describe, expect, it } from 'vitest'
import { acquireGrokWebSessionLock } from '../src/background/grok-proxy-service.mjs'
import {
  handleGrokProxyMessage,
  handleGrokProxyRequest,
} from '../src/content-script/grok-proxy-handlers.mjs'
import { GrokProxyControlAction, RuntimeMessage } from '../src/protocol/messages.mjs'

describe('acquireGrokWebSessionLock', () => {
  it('serializes one session and rejects a second locker', () => {
    const posts = []
    const port = { postMessage: (m) => posts.push(m) }
    const release = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    expect(typeof release).toBe('function')
    const second = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    expect(second).toBeNull()
    expect(posts.some((p) => /already in progress/i.test(p.error || ''))).toBe(true)
    release()
  })
})

describe('handleGrokProxyRequest', () => {
  it('uses the injected fetch once and returns folded text', async () => {
    let posts = 0
    const messages = []
    const result = await handleGrokProxyRequest({
      session: { question: 'hi', modelName: 'grokWebExpert' },
      fetch: async () => {
        posts += 1
        return new Response(`data: ${JSON.stringify({ token: 'ok', conversationId: 'c1' })}\n\n`, {
          status: 200,
        })
      },
      post: (m) => messages.push(m),
    })
    expect(posts).toBe(1)
    expect(result.answer).toBe('ok')
    expect(messages.some((m) => m.done)).toBe(true)
  })
})

describe('grok proxy control create/send', () => {
  it('creates with a single POST via createGrokChatWriter', async () => {
    let posts = 0
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.CreateConversation,
          payload: { query: 'hi', model: 'grok-chat-fast' },
        },
      },
      {
        fetch: async (_url, init) => {
          posts += 1
          expect(init?.method).toBe('POST')
          return new Response(
            `data: ${JSON.stringify({ token: 'ok', conversationId: 'c1', responseId: 'r1' })}\n\n`,
            { status: 200 },
          )
        },
      },
    )
    expect(posts).toBe(1)
    expect(result.handled).toBe(true)
    expect(result.data).toMatchObject({
      conversationId: 'c1',
      previousResponseID: 'r1',
      answer: 'ok',
      query: 'hi',
    })
  })

  it('sends a follow-up with a single POST and no auto-replay', async () => {
    let posts = 0
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.SendConversationMessage,
          payload: {
            conversationId: 'c1',
            query: 'again',
            model: 'grok-chat-expert',
            previousResponseID: 'r1',
          },
        },
      },
      {
        fetch: async (_url, init) => {
          posts += 1
          expect(init?.method).toBe('POST')
          const body = JSON.parse(init.body)
          expect(body.conversationId).toBe('c1')
          expect(body.parentResponseId).toBe('r1')
          return new Response(
            `data: ${JSON.stringify({ token: 'yo', conversationId: 'c1', responseId: 'r2' })}\n\n`,
            { status: 200 },
          )
        },
      },
    )
    expect(posts).toBe(1)
    expect(result.data).toMatchObject({
      conversationId: 'c1',
      previousResponseID: 'r2',
      answer: 'yo',
    })
  })
})
