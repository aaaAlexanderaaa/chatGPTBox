import { describe, expect, it } from 'vitest'
import { acquireGrokWebSessionLock } from '../src/background/grok-proxy-service.mjs'
import {
  handleGrokProxyMessage,
  handleGrokProxyRequest,
} from '../src/content-script/grok-proxy-handlers.mjs'
import { GrokProxyControlAction, RuntimeMessage } from '../src/protocol/messages.mjs'

function signedInSessionFetch({ postStatus = 200, postBody } = {}) {
  return async (url, init) => {
    if (String(url).includes('/api/auth/session')) {
      return new Response(JSON.stringify({ user: { userId: 'u1' } }), { status: 200 })
    }
    if (String(url).includes('/rest/rate-limits')) {
      return new Response(JSON.stringify({ tier: 'super' }), { status: 200 })
    }
    if (String(url).includes('/conversations/new')) {
      expect(init?.method).toBe('POST')
      return new Response(
        postBody ?? `data: ${JSON.stringify({ token: 'ok', conversationId: 'c1' })}\n\n`,
        { status: postStatus },
      )
    }
    throw new Error(`unexpected url ${url}`)
  }
}

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
  it('hard-confirms session then POSTs once and returns folded text', async () => {
    let chatPosts = 0
    const configs = []
    const messages = []
    const result = await handleGrokProxyRequest({
      session: { question: 'hi', modelName: 'grokWebExpert' },
      fetch: async (url, init) => {
        if (String(url).includes('/conversations/new')) chatPosts += 1
        return signedInSessionFetch()(url, init)
      },
      post: (m) => messages.push(m),
      setUserConfig: async (value) => {
        configs.push(value)
      },
    })
    expect(chatPosts).toBe(1)
    expect(result.answer).toBe('ok')
    expect(messages.some((m) => m.done)).toBe(true)
    expect(configs.at(-1)).toMatchObject({
      grokWebSignedIn: true,
      grokWebAccountTier: 'super',
    })
  })

  it('does not POST when session GET is unauthenticated and clears signed-in', async () => {
    let chatPosts = 0
    const configs = []
    await expect(
      handleGrokProxyRequest({
        session: { question: 'hi', modelName: 'grokWebFast' },
        fetch: async (url) => {
          if (String(url).includes('/conversations/new')) chatPosts += 1
          if (String(url).includes('/api/auth/session')) {
            return new Response(JSON.stringify({ status: 'unauthenticated' }), { status: 200 })
          }
          throw new Error(`unexpected url ${url}`)
        },
        setUserConfig: async (value) => {
          configs.push(value)
        },
      }),
    ).rejects.toThrow(/Please login at https:\/\/grok\.com first/)
    expect(chatPosts).toBe(0)
    expect(configs).toEqual([
      {
        grokWebSignedIn: false,
        grokWebAccountTier: '',
        grokWebAccountModels: [],
      },
    ])
  })

  it('does not POST when session GET fails and clears signed-in', async () => {
    let chatPosts = 0
    const configs = []
    await expect(
      handleGrokProxyRequest({
        session: { question: 'hi', modelName: 'grokWebFast' },
        fetch: async (url) => {
          if (String(url).includes('/conversations/new')) chatPosts += 1
          if (String(url).includes('/api/auth/session')) {
            return new Response('nope', { status: 500 })
          }
          throw new Error(`unexpected url ${url}`)
        },
        setUserConfig: async (value) => {
          configs.push(value)
        },
      }),
    ).rejects.toThrow(/Please login at https:\/\/grok\.com first/)
    expect(chatPosts).toBe(0)
    expect(configs.at(-1)).toMatchObject({ grokWebSignedIn: false })
  })

  it('clears signed-in on 401 from writer.send without retrying POST', async () => {
    let chatPosts = 0
    const configs = []
    await expect(
      handleGrokProxyRequest({
        session: { question: 'hi', modelName: 'grokWebFast' },
        fetch: async (url, init) => {
          if (String(url).includes('/api/auth/session')) {
            return new Response(JSON.stringify({ user: { userId: 'u1' } }), { status: 200 })
          }
          if (String(url).includes('/rest/rate-limits')) {
            return new Response(JSON.stringify({ tier: 'basic' }), { status: 200 })
          }
          if (String(url).includes('/conversations/new')) {
            chatPosts += 1
            return new Response('unauthorized', { status: 401 })
          }
          throw new Error(`unexpected ${url} ${init?.method}`)
        },
        setUserConfig: async (value) => {
          configs.push(value)
        },
      }),
    ).rejects.toThrow(/401/)
    expect(chatPosts).toBe(1)
    expect(configs.at(-1)).toMatchObject({ grokWebSignedIn: false })
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
