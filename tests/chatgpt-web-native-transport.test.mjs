import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHATGPT_WEB_INTEGRITY_RUNTIMES,
  getChatgptWebPageIntegrityInPage,
  buildChatgptWebPageHeaders,
} from '../src/services/clients/chatgpt-web/page-integrity.mjs'
import { createChatgptWebPageTransport } from '../src/services/clients/chatgpt-web/page-transport.mjs'
import {
  buildChatgptWebConversationRequestBody,
  buildChatgptWebConversationPrepareBody,
  buildChatgptWebConversationInitBody,
} from '../src/services/clients/chatgpt-web/request-wire.mjs'
import { fetchSSE } from '../src/utils/fetch-sse.mjs'
import {
  extractChatgptWebConversationResult,
  normalizeChatgptWebConversation,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'

const contract = CHATGPT_WEB_INTEGRITY_RUNTIMES.find((entry) => entry.kind === 'rspack')
// All identities, tokens, IDs and message content below are synthetic fixtures.
// Never replace them with values copied from a browser capture or real account.
let page, modules, transport, events, identity
function dispatch(data, origin = 'https://chatgpt.com', source = page) {
  const event = new Event('message')
  Object.assign(event, { data, origin, source })
  page.dispatchEvent(event)
}
beforeEach(() => {
  page = new EventTarget()
  page.top = page
  events = []
  page.postMessage = (data) => {
    events.push(data)
    queueMicrotask(() => dispatch(structuredClone(data)))
  }
  vi.stubGlobal('window', page)
  vi.stubGlobal('location', { origin: 'https://chatgpt.com' })
  vi.stubGlobal('document', {
    scripts: [{ src: `https://chatgpt.com/cdn/assets/${contract.filename}` }],
    querySelectorAll: () => [],
  })
  vi.stubGlobal('performance', { getEntriesByType: () => [] })
  identity = { accessToken: 'native-only-secret', accountId: 'account', userId: 'user' }
  modules = {
    OS: {
      loadBrowserChatGptAuth: vi.fn(async () => ({ ...identity })),
      getBrowserChatGptAuthSnapshot: vi.fn(() => identity),
      isSameBrowserRequestAuthContext: vi.fn((a, b) => a === b),
    },
    k29: {
      Request: {
        getRequestTarget: vi.fn((url, options) => ({
          url,
          headers: { 'x-openai-web-frontend': 'codex_webview', ...options.additionalHeaders },
        })),
        safePost: vi.fn(async (path) =>
          path.endsWith('/finalize')
            ? { token: 'finalized' }
            : {
                prepare_token: 'prepared',
                proofofwork: { required: true },
                turnstile: { required: true },
              },
        ),
      },
    },
    n9O: {
      f: vi.fn(async (prepare) => ({
        chatRequirements: await prepare('native-p'),
        proofToken: 'native-proof',
        turnstileToken: 'native-turnstile',
      })),
      b: vi.fn((req, proof, turnstile) => ({
        'OpenAI-Sentinel-Chat-Requirements-Token': req.token,
        'OpenAI-Sentinel-Proof-Token': proof,
        'OpenAI-Sentinel-Turnstile-Token': turnstile,
      })),
    },
    xb: {
      b: vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })),
    },
  }
})
afterEach(() => {
  transport?.close()
  transport = null
  page.dispatchEvent(new Event('pagehide'))
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function connect() {
  const require = Object.assign((id) => modules[id], {
    m: Object.fromEntries(Object.keys(modules).map((id) => [id, () => {}])),
  })
  const context = await getChatgptWebPageIntegrityInPage(
    CHATGPT_WEB_INTEGRITY_RUNTIMES,
    async () => ({ __webpack_require__: require }),
  )
  expect(context.ok).toBe(true)
  transport = createChatgptWebPageTransport(context)
  return context
}
const send = (path = '/f/conversation', options = {}) =>
  transport.fetch(`https://chatgpt.com/backend-api${path}`, {
    method: 'POST',
    body: '{}',
    ...options,
  })

describe('ChatGPT native page transport', () => {
  it('keeps auth and challenge tokens in MAIN and finalizes once immediately before submission', async () => {
    const context = await connect()
    expect(context).toMatchObject({
      profile: 'codex-webview',
      transport: 'native',
      baseHeaders: {},
      integrityHeaders: {},
    })
    expect(modules.n9O.f).not.toHaveBeenCalled()
    await (await send('/conversation/init')).text()
    await (await send('/f/conversation/prepare')).text()
    expect(modules.n9O.f).not.toHaveBeenCalled()
    await (
      await send('/f/conversation', {
        headers: { Authorization: 'must-not-use', 'X-Conduit-Token': 'conduit' },
      })
    ).text()
    expect(modules.k29.Request.safePost.mock.calls.map(([path]) => path)).toEqual([
      '/sentinel/chat-requirements/prepare',
      '/sentinel/chat-requirements/finalize',
    ])
    expect(modules.k29.Request.safePost).toHaveBeenLastCalledWith(
      '/sentinel/chat-requirements/finalize',
      expect.objectContaining({
        requestBody: {
          prepare_token: 'prepared',
          proofofwork: 'native-proof',
          turnstile: 'native-turnstile',
        },
        retry: 'never',
      }),
    )
    expect(modules.n9O.b).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'finalized' }),
      'native-proof',
      'native-turnstile',
    )
    expect(modules.xb.b).toHaveBeenLastCalledWith(
      '/f/conversation',
      expect.objectContaining({
        retry: 'never',
        expectedIdentity: { accountId: 'account', userId: 'user' },
        headers: expect.objectContaining({
          'X-Conduit-Token': 'conduit',
          'OpenAI-Sentinel-Chat-Requirements-Token': 'finalized',
        }),
      }),
      undefined,
      expect.any(Function),
      'stream',
    )
    expect(modules.xb.b.mock.calls.at(-1)[1].headers.Authorization).toBeUndefined()
    expect(
      JSON.stringify(context) +
        JSON.stringify(events.filter((e) => e.source.endsWith('-response'))),
    ).not.toMatch(/native-only-secret|finalized|native-proof|native-turnstile/)
    await expect(send()).rejects.toThrow('ChatGPT native request failed')
    expect(modules.xb.b).toHaveBeenCalledTimes(3)
  })

  it('streams split UTF-8 and v1 event metadata incrementally through fetchSSE', async () => {
    await connect()
    let writer
    modules.xb.b.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            writer = c
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    const onMessage = vi.fn()
    const onEvent = vi.fn()
    const onResponse = vi.fn()
    const work = fetchSSE('https://chatgpt.com/backend-api/f/conversation', {
      method: 'POST',
      body: '{}',
      fetchImpl: transport.fetch,
      onMessage,
      onEvent,
      onResponse,
      onStart() {},
      onEnd() {},
      onError(error) {
        throw error
      },
    })
    await vi.waitFor(() => expect(onResponse).toHaveBeenCalledOnce())
    const bytes = new TextEncoder().encode(
      'event: delta_encoding\ndata: "v1"\n\ndata: {"text":"你好"}\n\n',
    )
    for (let i = 0; i < bytes.length; i += 2) writer.enqueue(bytes.slice(i, i + 2))
    await vi.waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith('{"text":"你好"}', expect.anything()),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'delta_encoding', data: '"v1"' }),
    )
    writer.close()
    await work
  })

  it.each(['unfinalized', 'missing-proof', 'turnstile-error', 'identity-change'])(
    'fails closed for %s before sending the prompt',
    async (kind) => {
      await connect()
      if (kind === 'unfinalized')
        modules.k29.Request.safePost.mockResolvedValue({ prepare_token: 'prepared' })
      if (kind === 'missing-proof')
        modules.n9O.f.mockResolvedValue({
          chatRequirements: { prepare_token: 'p', proofofwork: { required: true } },
        })
      if (kind === 'turnstile-error')
        modules.n9O.f.mockResolvedValue({
          chatRequirements: { prepare_token: 'p' },
          turnstileToken: 'Turnstile-Internal-Error',
        })
      if (kind === 'identity-change') identity = { ...identity, accountId: 'other' }
      await expect(send()).rejects.toThrow('ChatGPT native request failed')
      expect(modules.xb.b).not.toHaveBeenCalled()
    },
  )

  it('rejects foreign destinations and non-conversation writes', async () => {
    await connect()
    await expect(transport.fetch('https://example.com/backend-api/models')).rejects.toThrow()
    await expect(send('/accounts/delete')).rejects.toThrow()
    expect(modules.xb.b).not.toHaveBeenCalled()
  })

  it('sends native stop without new integrity or a fabricated websocket request ID', async () => {
    await connect()
    await (
      await send('/stop_conversation', {
        body: JSON.stringify({ conversation_id: 'c', exclude_async_types: [] }),
        headers: { 'X-Conduit-Token': 'conduit' },
      })
    ).text()
    expect(modules.n9O.f).not.toHaveBeenCalled()
    expect(modules.xb.b).toHaveBeenCalledWith(
      '/stop_conversation',
      expect.objectContaining({
        body: '{"conversation_id":"c","exclude_async_types":[]}',
        headers: expect.objectContaining({ 'X-Conduit-Token': 'conduit' }),
      }),
      undefined,
      expect.any(Function),
      'request',
    )
  })

  it('rejects malformed response metadata immediately instead of leaving fetch pending', async () => {
    const context = await connect()
    let id
    page.postMessage = (data) => {
      if (data.type === 'fetch') id = data.id
    }
    const pending = send()
    const rejected = expect(pending).rejects.toThrow()
    dispatch({
      source: 'chatgptbox-native-response',
      channel: context.channel,
      id,
      type: 'headers',
      status: 0,
    })
    await rejected
  })

  it('propagates abort after headers to the native reader and permits only a resume afterwards', async () => {
    await connect()
    const cancel = vi.fn()
    modules.xb.b.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
    const abort = new AbortController()
    const response = await send('/f/conversation', { signal: abort.signal })
    const body = response.text()
    abort.abort()
    await expect(body).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    await (await send('/f/conversation/resume')).text()
    expect(modules.n9O.f).toHaveBeenCalledOnce()
    expect(modules.xb.b.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('ignores forged messages from another origin or channel and rejects a lost bridge on timeout', async () => {
    const context = await connect()
    vi.useFakeTimers()
    page.postMessage = () => {}
    const pending = send()
    const rejected = expect(pending).rejects.toThrow('timed out')
    dispatch(
      {
        source: 'chatgptbox-native-response',
        channel: context.channel,
        type: 'headers',
        status: 200,
      },
      'https://example.com',
    )
    dispatch({
      source: 'chatgptbox-native-request',
      channel: 'wrong',
      id: 'bad',
      type: 'fetch',
      url: 'https://chatgpt.com/backend-api/f/conversation',
    })
    await vi.advanceTimersByTimeAsync(90001)
    await rejected
    expect(modules.xb.b).not.toHaveBeenCalled()
  })
})

describe('new and old frontend wire compatibility', () => {
  it('builds the captured new format, preserving privacy, effort and follow-up parent', () => {
    const body = buildChatgptWebConversationRequestBody({
      profile: 'codex-webview',
      question: 'test',
      messageId: 'user-1',
      parentMessageId: 'client-created-root',
      model: 'gpt-5-6-thinking',
      thinkingEffort: 'max',
      historyAndTrainingDisabled: true,
    })
    expect(body).toMatchObject({
      is_do_not_remember: true,
      thinking_effort: 'max',
      supported_encodings: ['v1'],
      client_contextual_info: { app_surface: 'codex_browser' },
      messages: [{ metadata: {}, channel: null, status: 'finished_successfully' }],
    })
    expect(body).not.toHaveProperty('parent_message_id')
    expect(body).not.toHaveProperty('history_and_training_disabled')
    expect(body).not.toHaveProperty('conversation_mode')
    const prepared = buildChatgptWebConversationPrepareBody(body, 'codex-webview')
    expect(prepared).toMatchObject({
      client_prepare_state: 'sent',
      partial_query: { author: { role: 'user' }, content: { parts: ['test'] } },
    })
    for (const field of ['messages', 'client_contextual_info', 'supported_encodings'])
      expect(prepared).not.toHaveProperty(field)
    expect(buildChatgptWebConversationInitBody(body)).toMatchObject({
      conversation_id: null,
      requested_default_model: 'gpt-5-6-thinking',
    })
    expect(
      buildChatgptWebConversationRequestBody({
        profile: 'codex-webview',
        conversationId: 'c',
        parentMessageId: 'a',
      }),
    ).toMatchObject({ conversation_id: 'c', parent_message_id: 'a' })
    expect(
      buildChatgptWebPageHeaders(
        { transport: 'native', baseHeaders: {} },
        { conduitToken: 'c', turnTraceId: 'omit', apiPath: '/path' },
      ),
    ).toEqual({ 'x-conduit-token': 'c' })
  })

  it('normalizes the new ordered active branch without losing pagination or breaking old mappings', () => {
    const snapshot = {
      conversation_id: 'c',
      current_node: 'gone',
      page_info: { has_previous_page: true, start_cursor: 'user-1' },
      messages: [
        {
          id: 'user-1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['question'] },
        },
        {
          id: 'analysis',
          author: { role: 'assistant' },
          channel: 'analysis',
          content: { content_type: 'text', parts: ['thinking'] },
        },
        {
          id: 'answer',
          author: { role: 'assistant' },
          channel: 'final',
          status: 'finished_successfully',
          end_turn: true,
          content: { content_type: 'text', parts: ['answer'] },
        },
      ],
    }
    const result = normalizeChatgptWebConversation(snapshot)
    expect(result.page_info.has_previous_page).toBe(true)
    expect(result.current_node).toBe('answer')
    expect(result.mapping.answer.parent).toBe('analysis')
    expect(normalizeChatgptWebConversation(result)).toBe(result)
    expect(
      extractChatgptWebConversationResult(snapshot, { userMessageId: 'user-1' }),
    ).toMatchObject({ text: 'answer', isFinal: true })
    expect(() => normalizeChatgptWebConversation({ messages: [{ id: 'a' }, { id: 'a' }] })).toThrow(
      'duplicate',
    )
  })
})
