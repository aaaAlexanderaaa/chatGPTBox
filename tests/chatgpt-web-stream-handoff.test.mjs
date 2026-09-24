import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { fetchSSE } from '../src/utils/fetch-sse.mjs'
import {
  canFollowChatgptWebTurnViaHttpResume,
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
  CHATGPT_WEB_STREAM_MAX_RETRIES,
  consumeChatgptWebResumeDeltaStream,
  createChatgptWebResumeDeltaAccumulator,
} from '../src/services/clients/chatgpt-web/resume-delta.mjs'

beforeEach(() => {
  vi.spyOn(Browser.runtime, 'sendMessage').mockResolvedValue({
    ok: true,
    baseHeaders: {
      authorization: 'Bearer page-access-token',
      'oai-session-id': 'page-session-id',
      'oai-device-id': 'page-device-id',
      'oai-client-version': 'page-version',
      'chatgpt-account-id': 'page-account-id',
    },
    integrityHeaders: { 'Openai-Sentinel-Chat-Requirements-Token': 'requirements-token' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: vi.fn(async () => ({
    customChatGptWebApiUrl: 'https://chatgpt.com',
    customChatGptWebApiPath: '/backend-api/f/conversation',
    chatgptWebThinkingEffort: 'max',
    chatgptWebConversationPollTimeoutSeconds: 30,
    chatgptWebConversationPollIntervalSeconds: 1,
    disableWebModeHistory: false,
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

const wsOnlyHandoff = {
  type: 'stream_handoff',
  conversation_id: 'conv-1',
  turn_exchange_id: 'turn-1',
  options: [{ type: 'subscribe_ws_topic', topic_id: 'topic-1' }],
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

function assistantMessageDelta(text, extra = {}) {
  return {
    c: 0,
    o: 'add',
    p: '',
    v: {
      message: {
        id: 'assistant-1',
        author: { role: 'assistant' },
        channel: 'final',
        status: 'in_progress',
        end_turn: false,
        content: { content_type: 'text', parts: [text] },
        ...extra,
      },
    },
  }
}

function pendingConversationSnapshot(text) {
  return {
    conversation_id: 'conv-1',
    current_node: 'assistant-1',
    async_status: 'IS_STREAMING',
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
          status: 'in_progress',
          end_turn: false,
          channel: 'final',
          content: { content_type: 'text', parts: [text] },
        },
      },
    },
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
  it('accepts an SSE handoff without a WebSocket topic id', () => {
    expect(
      pickChatgptWebResumeSseOption({
        ...handoff,
        options: [{ type: 'resume_sse_endpoint' }],
      }),
    ).toEqual({ type: 'resume_sse_endpoint', topicId: null })
  })

  it('allows tokenless HTTP resume only at offset zero with a known conversation', () => {
    expect(canFollowChatgptWebTurnViaHttpResume({ conversationId: 'conv-1' })).toBe(true)
    expect(canFollowChatgptWebTurnViaHttpResume({ conversationId: 'conv-1', offset: 1 })).toBe(
      false,
    )
    expect(canFollowChatgptWebTurnViaHttpResume({ conduitToken: 'token' })).toBe(false)
    expect(
      canFollowChatgptWebTurnViaHttpResume({
        conversationId: 'conv-1',
        conduitToken: 'token',
        isTemporaryChat: true,
      }),
    ).toBe(false)
    expect(
      canFollowChatgptWebTurnViaHttpResume({
        conversationId: 'conv-1',
        conduitToken: 'token',
        offset: 1,
      }),
    ).toBe(true)
  })
  it('parses an advertised resume SSE option when present', () => {
    expect(pickChatgptWebResumeSseOption(handoff)).toEqual({
      type: 'resume_sse_endpoint',
      topicId: 'topic-1',
    })
    expect(canResumeChatgptWebStreamHandoffViaSse(handoff)).toBe(true)
    expect(canResumeChatgptWebStreamHandoffViaSse(wsOnlyHandoff)).toBe(false)
    expect(pickChatgptWebResumeSseOption(wsOnlyHandoff)).toBeNull()
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

  it('builds the observed GPT-5.6 max request body', () => {
    const body = buildChatgptWebConversationRequestBody({
      question: 'hello',
      messageId: 'message-1',
      parentMessageId: 'parent-1',
      model: 'gpt-5-6-thinking',
      thinkingEffort: 'max',
    })
    expect(body.model).toBe('gpt-5-6-thinking')
    expect(body.thinking_effort).toBe('max')
    expect(body.supported_encodings).toEqual(['v1'])
    expect(body.local_function_names).toEqual(['local.continue_in_work'])
  })

  it('keeps the legacy extended effort available on the wire', () => {
    const body = buildChatgptWebConversationRequestBody({
      question: 'hello',
      messageId: 'message-1',
      parentMessageId: 'parent-1',
      model: 'gpt-5-5-thinking',
      thinkingEffort: 'extended',
    })
    expect(body.thinking_effort).toBe('extended')
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
  it.each(['v1', '"v1"', '  "v1"  ', { encoding: 'v1' }])(
    'decodes a supported encoding announcement: %j',
    (encoding) => {
      const accumulator = createChatgptWebResumeDeltaAccumulator()
      accumulator.feedEvent('delta_encoding', encoding)
      accumulator.feedEvent('delta', finalDelta())
      accumulator.markAuthoritativeDone()
      expect(accumulator.getResult()).toMatchObject({
        completed: true,
        bestMessage: { text: 'complete answer' },
      })
    },
  )

  it.each(['v2', '"v2"', '"v1'])('rejects unsupported or malformed encoding %j', (encoding) => {
    expect(() =>
      createChatgptWebResumeDeltaAccumulator().feedEvent('delta_encoding', encoding),
    ).toThrow('[delta] unknown delta encoding:')
  })

  it('parses a JSON-encoded v1 announcement through the real resume SSE reader', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: delta_encoding\ndata: "v1"\n\n',
          `event: delta\ndata: ${JSON.stringify(finalDelta())}\n\n`,
          'data: [DONE]\n\n',
        ]),
      ),
    )
    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: {},
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
    })
    expect(result).toMatchObject({
      completed: true,
      offset: 2,
      bestMessage: { text: 'complete answer' },
    })
  })

  it('uses rotated response-header tokens and resets consecutive retries after progress', async () => {
    let attempt = 0
    const fetchSSE = vi.fn(async (_url, options) => {
      attempt += 1
      if (attempt > 1) expect(options.headers['X-Conduit-Token']).toBe(`token-${attempt - 1}`)
      options.onResponse(new Response(null, { headers: { 'X-Conduit-Token': `token-${attempt}` } }))
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify(finalDelta(`answer-${attempt}`)),
      })
      if (attempt < 4) throw new TypeError('Failed to fetch')
      options.onEvent({ type: 'event', data: '[DONE]' })
    })
    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: {},
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
      maxRetries: 1,
      waitForRetry: async () => {},
    })
    expect(result).toMatchObject({ completed: true, retryCount: 3, offset: 4 })
    expect(result.bestMessage.text).toBe('answer-4')
  })

  it('does not retry a tokenless stream at a nonzero offset', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      options.onEvent({ type: 'event', event: 'delta_encoding', data: 'v1' })
      throw new TypeError('Failed to fetch')
    })
    await expect(
      consumeChatgptWebResumeDeltaStream({
        url: 'https://chatgpt.com/backend-api/f/conversation/resume',
        headers: {},
        body: { conversation_id: 'conv-1', offset: 0 },
        fetchSSE,
        waitForRetry: async () => {},
      }),
    ).rejects.toThrow('Failed to fetch')
    expect(fetchSSE).toHaveBeenCalledOnce()
  })

  it('recognizes completion from legacy full-message events during resume', async () => {
    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: {},
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE: async (_url, options) => {
        options.onEvent({ type: 'event', data: JSON.stringify(finalDelta().v) })
        options.onEvent({ type: 'event', data: '[DONE]' })
      },
    })
    expect(result).toMatchObject({ completed: true, bestMessage: { text: 'complete answer' } })
  })

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

  it('reconstructs compressed delta v1 appends into the full message text', () => {
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta_encoding', 'v1')
    accumulator.feedEvent('delta', assistantMessageDelta('Hello'))
    accumulator.feedEvent('delta', {
      o: 'append',
      p: '/message/content/parts/0',
      v: ' world',
    })
    accumulator.feedEvent('delta', { v: '!' })
    expect(accumulator.getResult().bestMessage.text).toBe('Hello world!')
  })

  it('applies truncate to reconstructed delta v1 text', () => {
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta', assistantMessageDelta('Hello world'))
    accumulator.feedEvent('delta', {
      o: 'truncate',
      p: '/message/content/parts/0',
      v: 5,
    })
    expect(accumulator.getResult().bestMessage.text).toBe('Hello')
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

  it('reconnects resume streams up to 12 times by default', async () => {
    expect(CHATGPT_WEB_STREAM_MAX_RETRIES).toBe(12)
    const fetchSSE = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(
      consumeChatgptWebResumeDeltaStream({
        url: 'https://chatgpt.com/backend-api/f/conversation/resume',
        headers: { 'X-Conduit-Token': 'conduit' },
        body: { conversation_id: 'conv-1', offset: 0 },
        fetchSSE,
        waitForRetry: async () => {},
      }),
    ).rejects.toThrow(/Failed to fetch/)
    expect(fetchSSE).toHaveBeenCalledTimes(13)
  })

  it('treats a missing [DONE] as a retryable resume error', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify(finalDelta('partial answer')),
      })
      await options.onEnd()
    })

    await expect(
      consumeChatgptWebResumeDeltaStream({
        url: 'https://chatgpt.com/backend-api/f/conversation/resume',
        headers: { Authorization: 'Bearer token' },
        body: { conversation_id: 'conv-1', offset: 0 },
        fetchSSE,
        maxRetries: 0,
        waitForRetry: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'CHATGPT_WEB_STREAM_NO_DONE' })
    expect(fetchSSE).toHaveBeenCalledOnce()
  })

  it('reconnects after a missing [DONE] and completes from the consumed offset', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      if (fetchSSE.mock.calls.length === 1) {
        options.onEvent({
          type: 'event',
          event: 'delta',
          data: JSON.stringify(finalDelta()),
        })
        await options.onEnd()
        return
      }

      expect(JSON.parse(options.body)).toEqual({ conversation_id: 'conv-1', offset: 1 })
      options.onEvent({ type: 'event', event: '', data: '[DONE]' })
      await options.onEnd()
    })

    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { 'X-Conduit-Token': 'conduit' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
      maxRetries: 1,
      waitForRetry: async () => {},
    })

    expect(fetchSSE).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      completed: true,
      offset: 1,
      retryCount: 1,
    })
  })

  it('does not count ping, empty, or [DONE] events in the resume offset', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      options.onEvent({ type: 'event', event: 'ping', data: 'ping' })
      options.onEvent({ type: 'event', event: '', data: '' })
      options.onEvent({
        type: 'event',
        event: 'delta_encoding',
        data: 'v1',
      })
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify(finalDelta('Hello')),
      })
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify({
          o: 'append',
          p: '/message/content/parts/0',
          v: ' world',
        }),
      })
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify({ v: '!' }),
      })
      options.onEvent({ type: 'event', event: '', data: '[DONE]' })
      await options.onEnd()
    })

    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { 'X-Conduit-Token': 'conduit' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
    })

    expect(result.completed).toBe(true)
    expect(result.bestMessage.text).toBe('Hello world!')
    expect(result.offset).toBe(4)
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

  it('reconnects a broken resume stream from the consumed event offset', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      const requestBody = JSON.parse(options.body)
      if (fetchSSE.mock.calls.length === 1) {
        expect(requestBody).toEqual({ conversation_id: 'conv-1', offset: 0 })
        options.onEvent({
          type: 'event',
          event: 'delta',
          data: JSON.stringify(finalDelta()),
        })
        throw new TypeError('Failed to fetch')
      }

      expect(requestBody).toEqual({ conversation_id: 'conv-1', offset: 1 })
      options.onEvent({ type: 'event', event: '', data: '[DONE]' })
      await options.onEnd()
    })

    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { 'X-Conduit-Token': 'conduit' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
      maxRetries: 1,
      waitForRetry: async () => {},
    })

    expect(fetchSSE).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      completed: true,
      offset: 1,
      retryCount: 1,
      bestMessage: { text: 'complete answer' },
    })
  })

  it('uses a refreshed resume token and conversation id after reconnecting', async () => {
    const fetchSSE = vi.fn(async (_url, options) => {
      if (fetchSSE.mock.calls.length === 1) {
        options.onEvent({
          type: 'event',
          event: '',
          data: JSON.stringify({
            type: 'resume_conversation_token',
            token: 'new-conduit',
            conversation_id: 'conv-2',
          }),
        })
        throw new TypeError('Network connection lost')
      }

      expect(options.headers['X-Conduit-Token']).toBe('new-conduit')
      expect(JSON.parse(options.body)).toEqual({ conversation_id: 'conv-2', offset: 1 })
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify(finalDelta()),
      })
      options.onEvent({ type: 'event', event: '', data: '[DONE]' })
      await options.onEnd()
    })

    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { 'X-Conduit-Token': 'old-conduit' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
      maxRetries: 1,
      waitForRetry: async () => {},
    })

    expect(result.completed).toBe(true)
    expect(fetchSSE).toHaveBeenCalledTimes(2)
  })

  it.each([408, 409, 425, 429, 502, 504])('retries resume after HTTP %i', async (status) => {
    const fetchSSE = vi.fn(async (_url, options) => {
      if (fetchSSE.mock.calls.length === 1) {
        throw new Response('', { status })
      }
      options.onEvent({
        type: 'event',
        event: 'delta',
        data: JSON.stringify(finalDelta()),
      })
      options.onEvent({ type: 'event', event: '', data: '[DONE]' })
      await options.onEnd()
    })

    const result = await consumeChatgptWebResumeDeltaStream({
      url: 'https://chatgpt.com/backend-api/f/conversation/resume',
      headers: { 'X-Conduit-Token': 'conduit' },
      body: { conversation_id: 'conv-1', offset: 0 },
      fetchSSE,
      maxRetries: 1,
      waitForRetry: async () => {},
    })

    expect(fetchSSE).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ completed: true, retryCount: 1 })
  })

  it('stops after the configured resume retry limit', async () => {
    const rateLimited = new Response('', { status: 429 })
    const fetchSSE = vi.fn(async () => {
      throw rateLimited
    })

    await expect(
      consumeChatgptWebResumeDeltaStream({
        url: 'https://chatgpt.com/backend-api/f/conversation/resume',
        headers: { 'X-Conduit-Token': 'conduit' },
        body: { conversation_id: 'conv-1', offset: 0 },
        fetchSSE,
        maxRetries: 2,
        waitForRetry: async () => {},
      }),
    ).rejects.toBe(rateLimited)
    expect(fetchSSE).toHaveBeenCalledTimes(3)
  })
})

describe('ChatGPT Web client handoff integration', () => {
  function mockConversationStreams(
    initialResponse,
    resumeResponse,
    prepareResponse = () => new Response(JSON.stringify({ conduit_token: 'prepared-conduit' })),
  ) {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/f/conversation/prepare')) return prepareResponse()
      if (url.endsWith('/f/conversation')) return initialResponse()
      if (url.endsWith('/f/conversation/resume') && resumeResponse) return resumeResponse()
      throw new Error(`Unexpected request (including polling): ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('prepares the selected model and effort before sending exactly one user message', async () => {
    const fetchMock = mockConversationStreams(() =>
      sseResponse([`event: delta\ndata: ${JSON.stringify(finalDelta())}\n\n`, 'data: [DONE]\n\n']),
    )
    const messages = []
    const session = createSession('gpt-5-6-thinking')
    session.chatgptWebThinkingEffortOverride = 'standard'
    session.chatgptWebHistoryDisabledOverride = true
    const { generateAnswersWithChatgptWebApi } = await import(
      '../src/services/clients/chatgpt-web/client.mjs'
    )
    await generateAnswersWithChatgptWebApi(createTestPort(messages), 'hello', session, 'token')
    const prepareCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/prepare'))
    const sendCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/f/conversation'))
    const preparedBody = JSON.parse(prepareCall[1].body)
    expect(preparedBody).toMatchObject({
      model: 'gpt-5-6-thinking',
      thinking_effort: 'standard',
      parent_message_id: 'client-created-root',
      history_and_training_disabled: true,
      client_prepare_state: 'none',
    })
    expect(preparedBody).not.toHaveProperty('messages')
    expect(preparedBody).not.toHaveProperty('websocket_request_id')
    expect(new Headers(prepareCall[1].headers).get('accept')).toBe('application/json')
    expect(prepareCall[1].headers).not.toHaveProperty('openai-sentinel-chat-requirements-token')
    expect(sendCall[1].headers).toMatchObject({
      'x-conduit-token': 'prepared-conduit',
      'x-oai-turn-trace-id': prepareCall[1].headers['x-oai-turn-trace-id'],
      'openai-sentinel-chat-requirements-token': 'requirements-token',
      authorization: 'Bearer page-access-token',
      'oai-session-id': 'page-session-id',
      'oai-device-id': 'page-device-id',
      'chatgpt-account-id': 'page-account-id',
      'oai-client-version': 'page-version',
    })
    expect(JSON.parse(sendCall[1].body)).toMatchObject({
      ...preparedBody,
      client_prepare_state: 'success',
      messages: [{ content: { parts: ['hello'] } }],
    })
    expect(fetchMock.mock.calls.indexOf(prepareCall)).toBeLessThan(
      fetchMock.mock.calls.indexOf(sendCall),
    )
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/f/conversation'))).toHaveLength(1)
    expect(messages.at(-1)).toMatchObject({ done: true, answer: 'complete answer' })
  })

  it.each(['CHATGPT_WEB_INTEGRITY_INCOMPLETE', 'CHATGPT_WEB_RUNTIME_UNSUPPORTED'])(
    'does not submit or prepare a question after page verification fails with %s',
    async (code) => {
      Browser.runtime.sendMessage.mockResolvedValue({
        ok: false,
        code,
        message: 'Verification failed',
      })
      const fetchMock = mockConversationStreams()
      const { generateAnswersWithChatgptWebApi } = await import(
        '../src/services/clients/chatgpt-web/client.mjs'
      )
      await expect(
        generateAnswersWithChatgptWebApi(
          createTestPort([]),
          'hello',
          createSession('gpt-5-6-thinking'),
          'token',
        ),
      ).rejects.toMatchObject({ code })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each(['unavailable', 'invalid', 'network'])(
    'reports a failed %s prepare honestly without a stale token or prompt replay',
    async (failure) => {
      const fetchMock = mockConversationStreams(
        () => sseResponse([`data: ${JSON.stringify(finalDelta().v)}\n\n`, 'data: [DONE]\n\n']),
        undefined,
        () => {
          if (failure === 'network') throw new TypeError('Failed to fetch')
          return new Response('{}', { status: failure === 'unavailable' ? 404 : 200 })
        },
      )
      const { generateAnswersWithChatgptWebApi } = await import(
        '../src/services/clients/chatgpt-web/client.mjs'
      )
      await generateAnswersWithChatgptWebApi(
        createTestPort([]),
        'hello',
        createSession('gpt-5-6-thinking'),
        'token',
      )
      const sendCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/f/conversation'))
      expect(sendCalls).toHaveLength(1)
      expect(JSON.parse(sendCalls[0][1].body).client_prepare_state).toBe('failure')
      expect(sendCalls[0][1].headers).not.toHaveProperty('x-conduit-token')
    },
  )

  it('does not submit a prompt if preparation is aborted', async () => {
    const fetchMock = mockConversationStreams(undefined, undefined, () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    const { generateAnswersWithChatgptWebApi } = await import(
      '../src/services/clients/chatgpt-web/client.mjs'
    )
    await expect(
      generateAnswersWithChatgptWebApi(
        createTestPort([]),
        'hello',
        createSession('gpt-5-6-thinking'),
        'token',
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/f/conversation'))).toBe(false)
  })

  it.each(['initial', 'resume'])(
    'records reasoning evidence from the %s stream while returning only the final answer',
    async (transport) => {
      const thought = {
        id: 'thought-1',
        author: { role: 'assistant' },
        status: 'in_progress',
        content: { content_type: 'thoughts', thoughts: [{ summary: 'Test thought' }] },
        metadata: {
          model_slug: 'gpt-5-6-thinking',
          thinking_effort: 'max',
          reasoning_status: 'is_reasoning',
        },
      }
      const recap = {
        ...thought,
        id: 'recap-1',
        content: { content_type: 'reasoning_recap', content: 'Thought for 2m 44s' },
        metadata: { finished_duration_sec: 164, reasoning_status: 'reasoning_ended' },
      }
      const final = finalDelta('Final answer').v.message
      final.metadata = { resolved_model_slug: 'gpt-5-6-thinking' }
      const events = [
        'event: delta_encoding\ndata: "v1"\n\n',
        ...[thought, recap, final].map(
          (message, c) =>
            `event: delta\ndata: ${JSON.stringify({
              c,
              o: 'add',
              v: { message, conversation_id: 'conv-1' },
            })}\n\n`,
        ),
        'data: [DONE]\n\n',
      ]
      const fetchMock = mockConversationStreams(
        () =>
          transport === 'initial'
            ? sseResponse(events)
            : sseResponse([
                `data: ${JSON.stringify({ conversation_id: 'conv-1', message: thought })}\n\n`,
              ]),
        () => sseResponse(events),
      )
      const messages = []
      const { generateAnswersWithChatgptWebApi } = await import(
        '../src/services/clients/chatgpt-web/client.mjs'
      )
      await generateAnswersWithChatgptWebApi(
        createTestPort(messages),
        'hello',
        createSession('gpt-5-6-thinking'),
        'token',
      )
      expect(messages.at(-1)).toMatchObject({
        answer: 'Final answer',
        done: true,
        session: {
          chatgptWebResponseDiagnostics: {
            reportedModels: ['gpt-5-6-thinking'],
            resolvedModels: ['gpt-5-6-thinking'],
            reportedThinkingEfforts: ['max'],
            reasoningObserved: true,
            reasoningDurationSeconds: 164,
          },
        },
      })
      if (transport === 'resume') {
        const resumeCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/resume'))
        expect(resumeCall[1].headers['x-conduit-token']).toBe('prepared-conduit')
      }
    },
  )

  it.each(['v1', '"v1"'])(
    'decodes initial SSE with encoding %j and ignores control events',
    async (encoding) => {
      const delta = finalDelta('Hello')
      delta.v.conversation_id = 'conv-1'
      const fetchMock = mockConversationStreams(() =>
        sseResponse([
          `event: delta_encoding\ndata: ${encoding}\n\n`,
          `event: delta\ndata: ${JSON.stringify(delta)}\n\n`,
          `data: ${JSON.stringify({
            type: 'streaming_parent_patch',
            conversation_id: 'conv-1',
            logical_answer_id: 'assistant-1',
            revision: 1,
            updates: [{ message_id: 'assistant-1', streaming_parent_id: null }],
          })}\n\n`,
          `event: delta\ndata: ${JSON.stringify({
            o: 'append',
            p: '/message/content/parts/0',
            v: ' world',
          })}\n\n`,
          'event: delta\ndata: {"v":"!"}\n\n',
          `event: delta\ndata: ${JSON.stringify({
            c: 1,
            o: 'add',
            p: '',
            v: {
              message: {
                id: 'tool-1',
                author: { role: 'tool' },
                content: { content_type: 'text', parts: ['raw tool output'] },
              },
            },
          })}\n\n`,
          'data: [DONE]\n\n',
        ]),
      )
      const messages = []
      const { generateAnswersWithChatgptWebApi } = await import(
        '../src/services/clients/chatgpt-web/client.mjs'
      )
      await generateAnswersWithChatgptWebApi(
        createTestPort(messages),
        'hello',
        createSession('gpt-5-6-thinking'),
        'token',
      )
      expect(messages.at(-1)).toMatchObject({ answer: 'Hello world!', done: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )

  it('rejects an empty initial stream without silently completing or replaying it', async () => {
    const fetchMock = mockConversationStreams(() => sseResponse([]))
    const messages = []
    const { generateAnswersWithChatgptWebApi } = await import(
      '../src/services/clients/chatgpt-web/client.mjs'
    )
    await expect(
      generateAnswersWithChatgptWebApi(
        createTestPort(messages),
        'hello',
        createSession('gpt-5-4'),
        'token',
      ),
    ).rejects.toMatchObject({
      message: 'No done event received',
      chatgptWebRequestReplayUnsafe: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(messages.some((message) => message.done === true)).toBe(false)
  })

  it.each(['eof', 'socket_error'])(
    'retains initial delta state across %s without replaying the prompt',
    async (failure) => {
      const delta = assistantMessageDelta('Hello')
      delta.v.conversation_id = 'conv-1'
      const initial =
        'event: delta_encoding\ndata: v1\n\n' +
        `event: delta\ndata: ${JSON.stringify(delta)}\n\n` +
        `event: delta\ndata: ${JSON.stringify({
          o: 'append',
          p: '/message/content/parts/0',
          v: ' world',
        })}\n\n`
      let pulled = false
      const fetchMock = mockConversationStreams(
        () =>
          failure === 'eof'
            ? sseResponse([initial], { 'x-conduit-token': 'conduit' })
            : new Response(
                new ReadableStream({
                  pull(controller) {
                    if (pulled) controller.error(new TypeError('network disconnected'))
                    else {
                      pulled = true
                      controller.enqueue(new TextEncoder().encode(initial))
                    }
                  },
                }),
                { headers: { 'Content-Type': 'text/event-stream', 'x-conduit-token': 'conduit' } },
              ),
        () =>
          sseResponse([
            'event: delta\ndata: {"v":"!"}\n\n',
            `event: delta\ndata: ${JSON.stringify({
              o: 'patch',
              p: '/message',
              v: [
                { o: 'replace', p: '/status', v: 'finished_successfully' },
                { o: 'replace', p: '/end_turn', v: true },
              ],
            })}\n\n`,
            'data: [DONE]\n\n',
          ]),
      )
      const messages = []
      const { generateAnswersWithChatgptWebApi } = await import(
        '../src/services/clients/chatgpt-web/client.mjs'
      )
      await generateAnswersWithChatgptWebApi(
        createTestPort(messages),
        'hello',
        createSession('gpt-5-6-thinking'),
        'token',
      )
      expect(messages.at(-1)).toMatchObject({ answer: 'Hello world!', done: true })
      const resumeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/resume'))
      expect(JSON.parse(resumeCall[1].body)).toEqual({ conversation_id: 'conv-1', offset: 3 })
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/f/conversation')),
      ).toHaveLength(1)
    },
  )

  it('does not replay the initial conversation POST after HTTP 429', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    let initialRequestCount = 0
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-6-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        initialRequestCount += 1
        return new Response('', { status: 429 })
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
    await expect(
      generateAnswersWithChatgptWebApi(
        createTestPort(messages),
        'hello',
        createSession('gpt-5-6-thinking'),
        'access-token',
      ),
    ).rejects.toMatchObject({ code: 'CHATGPT_WEB_AMBIGUOUS_DISPATCH', retryable: false })

    expect(initialRequestCount).toBe(1)
    expect(messages).not.toContainEqual(expect.objectContaining({ done: true }))
  })

  it('preserves a caller-provided message id on the initial POST', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const session = createSession('gpt-5-6-thinking')
    session.messageId = 'operation-1'
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
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
      session,
      'access-token',
    )

    const initialCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation'),
    )
    expect(JSON.parse(initialCall[1].body).messages[0].id).toBe('operation-1')
  })

  it('follows a GPT-5.6 max token + handoff through resume without polling', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-6-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
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
      createSession('gpt-5-6-thinking'),
      'access-token',
    )

    const initialCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation'),
    )
    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation/resume'),
    )
    expect(initialCall).toBeTruthy()
    expect(JSON.parse(initialCall[1].body)).toMatchObject({
      model: 'gpt-5-6-thinking',
      thinking_effort: 'max',
      supported_encodings: ['v1'],
      local_function_names: ['local.continue_in_work'],
    })
    expect(initialCall[1].credentials).toBe('include')
    expect(resumeCall).toBeTruthy()
    expect(resumeCall[1].headers['x-conduit-token']).toBe('conduit-token')
    expect(resumeCall[1].credentials).toBe('include')
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/conversation/conv-1'),
      ),
    ).toBe(false)
    expect(messages.at(-1)).toMatchObject({ answer: 'complete answer', done: true })
  })

  it('tries tokenless handoff resume at zero and polls when it is unavailable', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-4' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([`data: ${JSON.stringify(handoff)}\n\n`, 'data: [DONE]\n\n'])
      }
      if (url.endsWith('/backend-api/f/conversation/resume')) {
        return new Response(JSON.stringify({ code: 'tokenless_resume_unavailable' }), {
          status: 404,
        })
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

    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation/resume'),
    )
    expect(JSON.parse(resumeCall[1].body).offset).toBe(0)
    expect(resumeCall[1].headers).not.toHaveProperty('x-conduit-token')
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
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-5-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([`data: ${JSON.stringify(handoff)}\n\n`, 'data: [DONE]\n\n'], {
          'x-conduit-token': 'header-conduit-token',
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
    const initialCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation'),
    )
    expect(JSON.parse(initialCall[1].body).thinking_effort).toBe('max')
    expect(resumeCall).toBeTruthy()
    expect(resumeCall[1].headers['x-conduit-token']).toBe('header-conduit-token')
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/conversation/conv-1'),
      ),
    ).toBe(false)
    expect(messages.at(-1)).toMatchObject({ answer: 'complete answer', done: true })
  })

  it('follows subscribe_ws_topic via HTTP resume when a conduit token exists', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-6-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([
          `data: ${JSON.stringify({
            type: 'resume_conversation_token',
            token: 'conduit-token',
            conversation_id: 'conv-1',
          })}\n\n`,
          `data: ${JSON.stringify(wsOnlyHandoff)}\n\n`,
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
      createSession('gpt-5-6-thinking'),
      'access-token',
    )

    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation/resume'),
    )
    expect(resumeCall).toBeTruthy()
    expect(JSON.parse(resumeCall[1].body)).toEqual({
      conversation_id: 'conv-1',
      offset: 0,
    })
    expect(resumeCall[1].headers['x-conduit-token']).toBe('conduit-token')
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/backend-api/conversation/conv-1'),
      ),
    ).toBe(false)
    expect(messages.at(-1)).toMatchObject({ answer: 'complete answer', done: true })
  })

  it('resumes an interrupted initial stream from the counted SSE offset', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-6-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([
          `data: ${JSON.stringify({
            type: 'resume_conversation_token',
            token: 'conduit-token',
            conversation_id: 'conv-1',
          })}\n\n`,
          `data: ${JSON.stringify(handoff)}\n\n`,
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
      createSession('gpt-5-6-thinking'),
      'access-token',
    )

    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/backend-api/f/conversation/resume'),
    )
    expect(resumeCall).toBeTruthy()
    expect(JSON.parse(resumeCall[1].body).offset).toBe(2)
    expect(messages.at(-1)).toMatchObject({ answer: 'complete answer', done: true })
  })

  it('keeps polling after a failed resume until the conversation snapshot is final', async () => {
    Browser.cookies.getAll = vi.fn(async () => [])
    Browser.cookies.get = vi.fn(async () => null)
    const messages = []
    let pollCount = 0
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes('/backend-api/tpp/models')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('/backend-api/models')) {
        return new Response(JSON.stringify({ models: [{ slug: 'gpt-5-6-thinking' }] }))
      }
      if (url.endsWith('/backend-api/sentinel/chat-requirements')) {
        return new Response(JSON.stringify({ token: 'requirements-token' }))
      }
      if (url.endsWith('/backend-api/accounts/check/v4-2023-04-27')) {
        return new Response(JSON.stringify({ accounts: {} }))
      }
      if (url.endsWith('/backend-api/f/conversation/prepare')) {
        return new Response('{}', { status: 404 })
      }
      if (url.endsWith('/backend-api/f/conversation')) {
        return sseResponse([
          `data: ${JSON.stringify({
            type: 'resume_conversation_token',
            token: 'conduit-token',
            conversation_id: 'conv-1',
          })}\n\n`,
          `data: ${JSON.stringify(wsOnlyHandoff)}\n\n`,
          'data: [DONE]\n\n',
        ])
      }
      if (url.endsWith('/backend-api/f/conversation/resume')) {
        return new Response('', { status: 403 })
      }
      if (url.endsWith('/backend-api/conversation/conv-1')) {
        pollCount += 1
        if (pollCount < 3) {
          return new Response(JSON.stringify(pendingConversationSnapshot('still thinking')), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
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
      createSession('gpt-5-6-thinking'),
      'access-token',
    )

    expect(pollCount).toBe(4)
    expect(messages.at(-1)).toMatchObject({ answer: 'polled answer', done: true })
  })
})
