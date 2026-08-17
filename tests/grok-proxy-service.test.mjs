import { describe, expect, it } from 'vitest'
import {
  acquireGrokWebSessionLock,
  executeGrokWebControlRequest,
  handleGrokProxyResponsePort,
  sendGrokProxyRequest,
} from '../src/background/grok-proxy-service.mjs'
import {
  handleGrokProxyMessage,
  handleGrokProxyRequest,
} from '../src/content-script/grok-proxy-handlers.mjs'
import { GrokProxyControlAction, RuntimeMessage } from '../src/protocol/messages.mjs'

function grok2apiSse({ token = 'ok', conversationId = 'c1', parentId = 'r1' } = {}) {
  const frames = [
    { result: { conversation: { conversationId } } },
    { result: { response: { userResponse: { responseId: parentId } } } },
    { result: { response: { token, isThinking: false, messageTag: 'final' } } },
  ]
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
}

function signedInSessionFetch({ postStatus = 200, postBody } = {}) {
  return async (url, init) => {
    if (String(url).includes('/api/auth/session')) {
      return new Response(JSON.stringify({ user: { userId: 'u1' } }), { status: 200 })
    }
    if (String(url).includes('/rest/rate-limits')) {
      return new Response(JSON.stringify({ tier: 'super' }), { status: 200 })
    }
    if (String(url).includes('/conversations/new') || String(url).includes('/responses')) {
      expect(init?.method).toBe('POST')
      return new Response(postBody ?? grok2apiSse(), { status: postStatus })
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

  it('rejects a second write even for a different session', () => {
    const port = { postMessage: () => {} }
    const release = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    expect(acquireGrokWebSessionLock({ sessionId: 's2' }, port)).toBeNull()
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
      hostname: 'grok.com',
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
        hostname: 'grok.com',
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
        hostname: 'grok.com',
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
        hostname: 'grok.com',
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

  it('does not POST when rate-limits returns 429', async () => {
    let chatPosts = 0
    await expect(
      handleGrokProxyRequest({
        session: { question: 'hi', modelName: 'grokWebFast' },
        hostname: 'grok.com',
        fetch: async (url) => {
          if (String(url).includes('/api/auth/session')) {
            return new Response(JSON.stringify({ user: { userId: 'u1' } }), { status: 200 })
          }
          if (String(url).includes('/rest/rate-limits')) {
            return new Response('rate limited', { status: 429 })
          }
          if (String(url).includes('/conversations/new')) {
            chatPosts += 1
            return new Response('nope', { status: 200 })
          }
          throw new Error(`unexpected url ${url}`)
        },
        setUserConfig: async () => {},
      }),
    ).rejects.toThrow(/429/)
    expect(chatPosts).toBe(0)
  })

  it('aborts the in-flight POST when signal is aborted', async () => {
    const controller = new AbortController()
    let sawAbort = false
    const pending = handleGrokProxyRequest({
      session: { question: 'hi', modelName: 'grokWebFast' },
      hostname: 'grok.com',
      signal: controller.signal,
      fetch: async (url, init) => {
        if (String(url).includes('/api/auth/session')) {
          return new Response(JSON.stringify({ user: { userId: 'u1' } }), { status: 200 })
        }
        if (String(url).includes('/rest/rate-limits')) {
          return new Response(JSON.stringify({ tier: 'basic' }), { status: 200 })
        }
        if (String(url).includes('/conversations/new')) {
          return await new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => {
              sawAbort = true
              reject(new DOMException('aborted', 'AbortError'))
            })
          })
        }
        throw new Error(`unexpected ${url}`)
      },
      setUserConfig: async () => {},
    })
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted|AbortError/)
    expect(sawAbort).toBe(true)
  })

  it('aborts hard-confirm GETs when the signal is aborted', async () => {
    const controller = new AbortController()
    let sessionFetchSawAbort = false
    const pending = handleGrokProxyRequest({
      session: { question: 'hi', modelName: 'grokWebFast' },
      hostname: 'grok.com',
      signal: controller.signal,
      fetch: async (url, init) => {
        if (String(url).includes('/api/auth/session')) {
          return await new Promise((_, reject) => {
            const onAbort = () => {
              sessionFetchSawAbort = true
              reject(new DOMException('aborted', 'AbortError'))
            }
            if (init?.signal?.aborted) return onAbort()
            init?.signal?.addEventListener?.('abort', onAbort)
          })
        }
        throw new Error(`unexpected ${url}`)
      },
      setUserConfig: async () => {},
    })
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted|AbortError/)
    expect(sessionFetchSawAbort).toBe(true)
  })
})

describe('grok proxy control create/send', () => {
  it('hard-confirms then creates with a single POST', async () => {
    const methods = []
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.CreateConversation,
          payload: { query: 'hi', model: 'grok-chat-fast' },
        },
      },
      {
        hostname: 'grok.com',
        setUserConfig: async () => {},
        fetch: async (url, init) => {
          methods.push(init?.method || 'GET')
          return signedInSessionFetch()(url, init)
        },
      },
    )
    expect(methods.filter((m) => m === 'POST')).toHaveLength(1)
    expect(methods[0]).not.toBe('POST')
    expect(result.handled).toBe(true)
    expect(result.data).toMatchObject({
      conversationId: 'c1',
      previousResponseID: 'r1',
      answer: 'ok',
      query: 'hi',
    })
  })

  it('does not POST create when session GET is unauthenticated', async () => {
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
        hostname: 'grok.com',
        setUserConfig: async () => {},
        fetch: async (url, init) => {
          if (init?.method === 'POST') posts += 1
          if (String(url).includes('/api/auth/session')) {
            return new Response(JSON.stringify({ status: 'unauthenticated' }), { status: 200 })
          }
          throw new Error(`unexpected url ${url}`)
        },
      },
    )
    expect(posts).toBe(0)
    expect(result).toMatchObject({
      handled: true,
      data: { dispatched: false },
    })
    expect(result.data.error).toMatch(/Please login at https:\/\/grok\.com first/)
  })

  it('sends a follow-up on /responses with responseId', async () => {
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
        hostname: 'grok.com',
        setUserConfig: async () => {},
        fetch: async (url, init) => {
          if (
            String(url).includes('/api/auth/session') ||
            String(url).includes('/rest/rate-limits')
          ) {
            return signedInSessionFetch()(url, init)
          }
          posts += 1
          expect(init?.method).toBe('POST')
          expect(url).toBe('https://grok.com/rest/app-chat/conversations/c1/responses')
          const body = JSON.parse(init.body)
          expect(body.responseId).toBe('r1')
          expect(body.modeId).toBe('expert')
          return new Response(grok2apiSse({ token: 'yo', conversationId: 'c1', parentId: 'r2' }), {
            status: 200,
          })
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

  it('omitted model uses the hard-confirmed account default', async () => {
    let config = { grokWebAccountTier: '' }
    let postedBody
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.CreateConversation,
          payload: { query: 'hi' },
        },
      },
      {
        hostname: 'grok.com',
        getUserConfig: async () => config,
        setUserConfig: async (value) => {
          config = { ...config, ...value }
        },
        fetch: async (url, init) => {
          if (String(url).includes('/api/auth/session')) {
            return new Response(JSON.stringify({ user: { userId: 'u1' } }), { status: 200 })
          }
          if (String(url).includes('/rest/rate-limits')) {
            return new Response(JSON.stringify({ tier: 'heavy' }), { status: 200 })
          }
          if (String(url).includes('/conversations/new')) {
            postedBody = JSON.parse(init.body)
            return new Response(grok2apiSse(), { status: 200 })
          }
          throw new Error(`unexpected url ${url}`)
        },
      },
    )
    expect(postedBody.modeId).toBe('heavy')
    expect(result.data.defaultModel).toBe('grok-chat-heavy')
  })

  it('refuses a follow-up without previousResponseID and does not POST', async () => {
    let posts = 0
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.SendConversationMessage,
          payload: { conversationId: 'c1', query: 'again', model: 'grok-chat-fast' },
        },
      },
      {
        hostname: 'grok.com',
        setUserConfig: async () => {},
        fetch: async (url, init) => {
          if (init?.method === 'POST') posts += 1
          return signedInSessionFetch()(url, init)
        },
      },
    )
    expect(posts).toBe(0)
    expect(result).toMatchObject({
      handled: true,
      data: { dispatched: false },
    })
    expect(result.data.error).toMatch(/previousResponseID/)
  })

  it('aborts a hung hard-confirm before POST and reports dispatched false', async () => {
    let posts = 0
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.CreateConversation,
          payload: { query: 'hi', model: 'grok-chat-fast', timeoutMs: 20 },
        },
      },
      {
        hostname: 'grok.com',
        setUserConfig: async () => {},
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            if (init?.method === 'POST') posts += 1
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }),
      },
    )
    expect(posts).toBe(0)
    expect(result).toMatchObject({
      handled: true,
      data: { dispatched: false },
    })
  }, 1000)

  it('rejects a non-Grok model slug without dispatching', async () => {
    const result = await handleGrokProxyMessage(
      {
        type: RuntimeMessage.GrokProxyControlRequest,
        data: {
          action: GrokProxyControlAction.CreateConversation,
          payload: { query: 'hi', model: 'gpt-5-6-thinking' },
        },
      },
      {
        hostname: 'grok.com',
        setUserConfig: async () => {},
        fetch: signedInSessionFetch(),
      },
    )
    expect(result).toMatchObject({
      handled: true,
      data: { dispatched: false },
    })
    expect(result.data.error).toMatch(/Unsupported Grok model/)
  })

  it('refuses control writes off grok.com', async () => {
    await expect(
      handleGrokProxyMessage(
        {
          type: RuntimeMessage.GrokProxyControlRequest,
          data: {
            action: GrokProxyControlAction.CreateConversation,
            payload: { query: 'hi', model: 'grok-chat-fast' },
          },
        },
        { hostname: 'example.com', fetch: async () => new Response('nope') },
      ),
    ).rejects.toThrow(/grok\.com/)
  })
})

describe('sendGrokProxyRequest', () => {
  it('rejects when the response port never connects', async () => {
    await expect(
      sendGrokProxyRequest(
        1,
        { sessionId: 'timeout' },
        { postMessage() {} },
        { sendMessage: async () => undefined, connectTimeoutMs: 20 },
      ),
    ).rejects.toThrow(/did not accept the request in time/)
  }, 1000)

  it('releases the write lock after a connect timeout', async () => {
    const port = { postMessage() {} }
    const release = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    const pending = sendGrokProxyRequest(1, { sessionId: 's1' }, port, {
      sendMessage: async () => undefined,
      connectTimeoutMs: 20,
    })
    await expect(pending).rejects.toThrow(/did not accept the request in time/)
    release()
    const next = acquireGrokWebSessionLock({ sessionId: 's2' }, port)
    expect(typeof next).toBe('function')
    next()
  }, 1000)
})

describe('executeGrokWebControlRequest', () => {
  it('takes the write lock so a second control write is refused', async () => {
    let releaseControl
    const first = executeGrokWebControlRequest(
      GrokProxyControlAction.CreateConversation,
      { query: 'hi' },
      {
        tabs: { query: async () => [{ id: 1, url: 'https://grok.com/?chatgptbox_proxy=1' }] },
        sendMessage: () =>
          new Promise((resolve) => {
            releaseControl = resolve
          }),
      },
    )
    await expect(
      executeGrokWebControlRequest(
        GrokProxyControlAction.CreateConversation,
        { query: 'other' },
        {
          tabs: { query: async () => [{ id: 1, url: 'https://grok.com/?chatgptbox_proxy=1' }] },
          sendMessage: async () => ({ ok: true, data: {} }),
        },
      ),
    ).resolves.toMatchObject({
      dispatched: false,
      error: expect.stringMatching(/already in progress/),
    })
    releaseControl({ ok: true, data: { conversationId: 'c1' } })
    await first
  })

  it('returns dispatched false when the proxy tab cannot be opened', async () => {
    await expect(
      executeGrokWebControlRequest(
        GrokProxyControlAction.CreateConversation,
        { query: 'hi' },
        {
          tabs: { query: async () => [] },
          createTab: async () => null,
        },
      ),
    ).resolves.toMatchObject({
      dispatched: false,
      error: expect.stringMatching(/proxy tab is unavailable/),
    })
    const next = acquireGrokWebSessionLock({ sessionId: 'after-missing-tab' }, { postMessage() {} })
    expect(typeof next).toBe('function')
    next()
  })

  it('returns dispatched false when the content script cannot be injected', async () => {
    await expect(
      executeGrokWebControlRequest(
        GrokProxyControlAction.SendConversationMessage,
        { conversationId: 'c1', query: 'again', previousResponseID: 'r1' },
        {
          tabs: { query: async () => [{ id: 1, url: 'https://grok.com/?chatgptbox_proxy=1' }] },
          sendMessage: async () => {
            throw new Error('Could not establish connection. Receiving end does not exist.')
          },
        },
      ),
    ).resolves.toMatchObject({
      dispatched: false,
      error: expect.stringMatching(/Content script could not be loaded/),
    })
    const next = acquireGrokWebSessionLock({ sessionId: 'after-inject' }, { postMessage() {} })
    expect(typeof next).toBe('function')
    next()
  })

  it('does not take the write lock for list or get', async () => {
    const port = { postMessage() {} }
    const release = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    await expect(
      executeGrokWebControlRequest(
        GrokProxyControlAction.ListConversations,
        {},
        {
          tabs: { query: async () => [{ id: 1, url: 'https://grok.com/?chatgptbox_proxy=1' }] },
          sendMessage: async () => ({ ok: true, data: { items: [] } }),
        },
      ),
    ).resolves.toEqual({ items: [] })
    release()
  })
})

describe('handleGrokProxyResponsePort', () => {
  it('settles and disconnects the proxy port when the UI port drops', async () => {
    let requestId
    const uiDisconnectListeners = []
    const uiPort = {
      postMessage() {},
      onMessage: { addListener() {}, removeListener() {} },
      onDisconnect: { addListener: (fn) => uiDisconnectListeners.push(fn) },
    }
    const pending = sendGrokProxyRequest(1, { sessionId: 's' }, uiPort, {
      sendMessage: async (_id, message) => {
        requestId = message.data.requestId
      },
      connectTimeoutMs: 5_000,
    })
    expect(requestId).toBeTruthy()

    let disconnected = 0
    const stops = []
    const proxyPort = {
      name: `grok-proxy-response:${requestId}`,
      postMessage(msg) {
        stops.push(msg)
      },
      disconnect() {
        disconnected += 1
      },
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
    }
    handleGrokProxyResponsePort(proxyPort)
    for (const fn of uiDisconnectListeners) fn()
    await pending
    expect(stops.some((msg) => msg?.stop)).toBe(true)
    expect(disconnected).toBe(1)
  })
})
