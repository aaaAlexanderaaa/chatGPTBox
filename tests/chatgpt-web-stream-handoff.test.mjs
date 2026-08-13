import { afterEach, describe, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import {
  canResumeChatgptWebStreamHandoffViaSse,
  extractChatgptWebResumeConversationToken,
  pickChatgptWebResumeSseOption,
  shouldPollChatgptWebConversationAfterStream,
  shouldUseChatgptWebLegacyWebsocketDispatch,
} from '../src/services/clients/chatgpt-web/stream-handoff.mjs'
import {
  buildChatgptWebConversationHeaders,
  buildChatgptWebConversationRequestBody,
  extractChatgptWebConduitTokenFromHeaders,
  extractChatgptWebTurnstileToken,
} from '../src/services/clients/chatgpt-web/request-wire.mjs'
import {
  applyResumePatch,
  consumeChatgptWebResumeDeltaStream,
  createChatgptWebResumeDeltaAccumulator,
} from '../src/services/clients/chatgpt-web/resume-delta.mjs'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: vi.fn(async () => ({
    customChatGptWebApiUrl: 'https://chatgpt.com',
    customChatGptWebApiPath: '/backend-api/f/conversation',
    chatgptWebThinkingEffort: 'extended',
    chatgptWebConversationPollTimeoutSeconds: 30,
    chatgptWebConversationPollIntervalSeconds: 1,
    disableWebModeHistory: true,
    debugChatgptWebRequests: false,
  })),
}))

const handoff = {
  type: 'stream_handoff',
  conversation_id: 'conv-1',
  turn_exchange_id: 'turn-1',
  options: [
    { type: 'resume_sse_endpoint', topic_id: 'topic-1' },
    { type: 'subscribe_ws_topic', topic_id: 'topic-1' },
  ],
}

function finalDelta(text = 'complete answer') {
  return {
    c: 0,
    o: 'add',
    v: {
      message: {
        id: 'assistant-1',
        author: { role: 'assistant' },
        channel: 'final',
        status: 'finished_successfully',
        end_turn: true,
        content: { content_type: 'text', parts: [text] },
      },
    },
  }
}

function sseResponse(events, extraHeaders = {}) {
  return new Response(events.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...extraHeaders },
  })
}

function createTestPort(messages) {
  const messageListeners = new Set()
  const disconnectListeners = new Set()
  return {
    postMessage(message) {
      messages.push(message)
    },
    onMessage: {
      addListener: (listener) => messageListeners.add(listener),
      removeListener: (listener) => messageListeners.delete(listener),
    },
    onDisconnect: {
      addListener: (listener) => disconnectListeners.add(listener),
      removeListener: (listener) => disconnectListeners.delete(listener),
    },
  }
}

function createSession(model) {
  return {
    conversationRecords: [],
    chatgptWebModelSlugOverride: model,
    parentMessageId: null,
    conversationId: null,
    autoClean: false,
  }
}

function completedConversationSnapshot(text) {
  return {
    conversation_id: 'conv-1',
    current_node: 'assistant-1',
    async_status: null,
    mapping: {
      root: { id: 'root', parent: null, message: null },
      'user-1': {
        id: 'user-1',
        parent: 'root',
        message: {
          id: 'user-1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['hello'] },
        },
      },
      'assistant-1': {
        id: 'assistant-1',
        parent: 'user-1',
        message: {
          id: 'assistant-1',
          author: { role: 'assistant' },
          status: 'finished_successfully',
          end_turn: true,
          channel: 'final',
          content: { content_type: 'text', parts: [text] },
        },
      },
    },
  }
}

describe('ChatGPT Web stream handoff policy', () => {
  it('only follows an advertised resume SSE option', () => {
    expect(pickChatgptWebResumeSseOption(handoff)).toEqual({
      type: 'resume_sse_endpoint',
      topicId: 'topic-1',
    })
    expect(canResumeChatgptWebStreamHandoffViaSse(handoff)).toBe(true)
    expect(
      canResumeChatgptWebStreamHandoffViaSse({
        type: 'stream_handoff',
        options: [{ type: 'subscribe_ws_topic', topic_id: 'topic-2' }],
      }),
    ).toBe(false)
  })

  it('extracts token and conversation id without inventing either value', () => {
    expect(
      extractChatgptWebResumeConversationToken({
        type: 'resume_conversation_token',
        token: ' conduit-token ',
        conversation_id: ' conv-9 ',
        kind: 'topic',
      }),
    ).toEqual({ token: 'conduit-token', conversationId: 'conv-9', kind: 'topic' })
    expect(
      extractChatgptWebResumeConversationToken({
        type: 'resume_conversation_token',
        conversation_id: 'conv-9',
      }),
    ).toEqual({ token: '', conversationId: 'conv-9', kind: null })
    expect(extractChatgptWebResumeConversationToken({ type: 'stream_handoff' })).toBeNull()
  })

  it('uses the handoff stream instead of legacy websocket dispatch on /f/conversation', () => {
    expect(
      shouldUseChatgptWebLegacyWebsocketDispatch({
        useWebsocket: true,
        isExtendedThinkingRequest: true,
        apiPath: '/backend-api/f/conversation',
      }),
    ).toBe(false)
    expect(
      shouldUseChatgptWebLegacyWebsocketDispatch({
        useWebsocket: true,
        isExtendedThinkingRequest: true,
        apiPath: '/backend-api/conversation',
      }),
    ).toBe(true)
  })

  it('polls whenever a handoff resume is missing or incomplete', () => {
    expect(
      shouldPollChatgptWebConversationAfterStream({
        hasConversationId: true,
        handoff,
        resumeCompleted: true,
        modelNeedsPolling: true,
      }),
    ).toBe(false)
    expect(
      shouldPollChatgptWebConversationAfterStream({
        hasConversationId: true,
        handoff,
        resumeCompleted: false,
        modelNeedsPolling: false,
      }),
    ).toBe(true)
  })
})

describe('ChatGPT Web request wire', () => {
  it('builds the required target, account, conduit and sentinel headers', () => {
    const headers = buildChatgptWebConversationHeaders({
      accessToken: 'token',
      apiPath: '/backend-api/f/conversation/resume',
      accountId: 'account-1',
      conduitToken: 'conduit-1',
      turnTraceId: 'trace-1',
      requirementsToken: 'requirements-1',
      proofToken: 'proof-1',
      turnstileToken: 'turnstile-1',
      arkoseToken: 'arkose-1',
      needArkoseToken: true,
      sessionId: 'session-1',
    })

    expect(headers).toMatchObject({
      Authorization: 'Bearer token',
      'Chatgpt-Account-Id': 'account-1',
      'X-Conduit-Token': 'conduit-1',
      'X-Oai-Turn-Trace-Id': 'trace-1',
      'X-Openai-Target-Path': '/backend-api/f/conversation/resume',
      'X-Openai-Target-Route': '/backend-api/f/conversation/resume',
      'Openai-Sentinel-Chat-Requirements-Token': 'requirements-1',
      'Openai-Sentinel-Proof-Token': 'proof-1',
      'Openai-Sentinel-Turnstile-Token': 'turnstile-1',
      'Openai-Sentinel-Arkose-Token': 'arkose-1',
      'Oai-Session-Id': 'session-1',
    })
  })

  it('omits optional secrets instead of sending placeholders', () => {
    const headers = buildChatgptWebConversationHeaders({ accessToken: 'token' })
    expect(headers).not.toHaveProperty('X-Conduit-Token')
    expect(headers).not.toHaveProperty('Chatgpt-Account-Id')
    expect(headers).not.toHaveProperty('Openai-Sentinel-Arkose-Token')
  })

  it('builds the v1 request body without changing the selected model', () => {
    const body = buildChatgptWebConversationRequestBody({
      question: 'hello',
      messageId: 'message-1',
      parentMessageId: 'parent-1',
      model: 'gpt-5-5-thinking',
      thinkingEffort: 'extended',
    })
    expect(body.model).toBe('gpt-5-5-thinking')
    expect(body.supported_encodings).toEqual(['v1'])
    expect(body.local_function_names).toEqual(['local.continue_in_work'])
  })

  it('extracts turnstile tokens from observed response shapes', () => {
    expect(extractChatgptWebTurnstileToken({ turnstile: { token: 'turnstile' } })).toBe('turnstile')
  })

  it('reads a conduit token from response headers', () => {
    expect(
      extractChatgptWebConduitTokenFromHeaders(
        new Headers({ 'X-Conduit-Token': ' header-conduit ' }),
      ),
    ).toBe('header-conduit')
    expect(extractChatgptWebConduitTokenFromHeaders(new Headers())).toBe('')
  })
})

describe('ChatGPT Web resume delta completion', () => {
  it('applies JSON pointer patches and blocks prototype pollution', () => {
    const target = { message: { content: { parts: ['hello'] } } }
    expect(
      applyResumePatch(target, {
        p: '/message/content/parts/0',
        o: 'append',
        v: ' world',
      }),
    ).toBe(true)
    applyResumePatch(target, { p: '/__proto__/polluted', o: 'add', v: true })
    expect(target.message.content.parts[0]).toBe('hello world')
    expect({}.polluted).toBeUndefined()
  })

  it('does not accept a final-looking message before authoritative completion', () => {
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta', finalDelta())
    expect(accumulator.getResult()).toMatchObject({
      authoritativeDone: false,
      completed: false,
      bestMessage: { text: 'complete answer', isFinal: true },
    })
  })

  it('requires both [DONE] and a final non-pending answer', () => {
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta', finalDelta())
    accumulator.markAuthoritativeDone()
    expect(accumulator.getResult().completed).toBe(true)
  })

  it('reports premature EOF as incomplete so the caller can poll', async () => {
    const onMessageSnapshot = vi.fn()
    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { Authorization: 'Bearer token' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE: async (_url, options) => {
        options.onEvent({
          type: 'event',
          event: 'delta',
          data: JSON.stringify(finalDelta('partial answer')),
        })
        await options.onEnd()
      },
      onMessageSnapshot,
    })

    expect(result.completed).toBe(false)
    expect(result.bestMessage.text).toBe('partial answer')
    expect(onMessageSnapshot).toHaveBeenCalled()
  })

  it('completes the full handoff resume chain after [DONE]', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify(finalDelta()),
      })
      options.onEvent({ type: 'event', event: '', data: '[DONE]' })
      await options.onEnd()
    })
    const snapshots = []
    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { 'X-Conduit-Token': 'conduit' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
      onMessageSnapshot: (snapshot) => snapshots.push(snapshot),
    })

    expect(fetchSSE).toHaveBeenCalledOnce()
    expect(result.completed).toBe(true)
    expect(result.authoritativeDone).toBe(true)
    expect(result.bestMessage.text).toBe('complete answer')
    expect(snapshots.at(-1).conversation_id).toBe('conv-1')
  })
})

describe('ChatGPT Web client handoff integration', () => {
  it('follows token + handoff through resume and completes without polling', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-5-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([
          `data: ${JSON.stringify({
            type: 'resume_conversation_token',
            token: 'conduit-token',
            conversation_id: 'conv-1',
          })}\n\n`,
          `data: ${JSON.stringify(handoff)}\n\n`,
          'data: [DONE]\n\n',
        ])
      }
      if (url.endsWith('/backend-api/f/conversation/resume')) {
        return sseResponse([
          `event: delta\ndata: ${JSON.stringify(finalDelta())}\n\n`,
          'data: [DONE]\n\n',
        ])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateAnswersWithChatgptWebApi } = await import(
      '../src/services/clients/chatgpt-web/client.mjs'
    )
    await generateAnswersWithChatgptWebApi(
      createTestPort(messages),
      'hello',
      createSession('gpt-5-5-thinking'),
      'access-token',
    )

    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation/resume'),
    )
    expect(resumeCall).toBeTruthy()
    expect(resumeCall[1].headers['X-Conduit-Token']).toBe('conduit-token')
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/conversation/conv-1'),
      ),
    ).toBe(false)
    expect(messages.at(-1)).toMatchObject({ answer: 'complete answer', done: true })
  })

  it('does not call resume without a real token and falls back to polling', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-4' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([`data: ${JSON.stringify(handoff)}\n\n`, 'data: [DONE]\n\n'])
      }
      if (url.endsWith('/backend-api/conversation/conv-1')) {
        return new Response(JSON.stringify(completedConversationSnapshot('polled answer')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateAnswersWithChatgptWebApi } = await import(
      '../src/services/clients/chatgpt-web/client.mjs'
    )
    await generateAnswersWithChatgptWebApi(
      createTestPort(messages),
      'hello',
      createSession('gpt-5-4'),
      'access-token',
    )

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/f/conversation/resume'),
      ),
    ).toBe(false)
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/conversation/conv-1'),
      ),
    ).toBe(true)
    expect(messages.at(-1)).toMatchObject({ answer: 'polled answer', done: true })
  })

  it('resumes from an X-Conduit-Token response header when no token event arrives', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-5-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([`data: ${JSON.stringify(handoff)}\n\n`, 'data: [DONE]\n\n'], {
          'X-Conduit-Token': 'header-conduit-token',
        })
      }
      if (url.endsWith('/backend-api/f/conversation/resume')) {
        return sseResponse([
          `event: delta\ndata: ${JSON.stringify(finalDelta())}\n\n`,
          'data: [DONE]\n\n',
        ])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateAnswersWithChatgptWebApi } = await import(
      '../src/services/clients/chatgpt-web/client.mjs'
    )
    await generateAnswersWithChatgptWebApi(
      createTestPort(messages),
      'hello',
      createSession('gpt-5-5-thinking'),
      'access-token',
    )

    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation/resume'),
    )
    expect(resumeCall).toBeTruthy()
    expect(resumeCall[1].headers['X-Conduit-Token']).toBe('header-conduit-token')
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/conversation/conv-1'),
      ),
    ).toBe(false)
    expect(messages.at(-1)).toMatchObject({ answer: 'complete answer', done: true })
  })
})
