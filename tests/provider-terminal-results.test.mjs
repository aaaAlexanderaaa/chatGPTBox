import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ config: {} }))
vi.mock('../src/config/storage.mjs', () => ({ getUserConfig: async () => state.config }))
import { generateAnswersWithCustomApi } from '../src/services/apis/custom-api.mjs'
import { generateAnswersWithClaudeApi } from '../src/services/apis/claude-api.mjs'
import {
  generateAnswersWithGptCompletionApi,
  generateAnswersWithChatgptApiCompat,
} from '../src/services/apis/openai-api.mjs'
import { generateAnswersWithAzureOpenaiApi } from '../src/services/apis/azure-openai-api.mjs'
import { generateAnswersWithOllamaApi } from '../src/services/apis/ollama-api.mjs'
import { postOpenAiResponses } from '../src/services/apis/openai-responses-shared.mjs'
function port() {
  const listeners = new Set(),
    disconnects = new Set(),
    posts = []
  return {
    posts,
    postMessage: (value) => posts.push(value),
    onMessage: {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    },
    onDisconnect: {
      addListener: (fn) => disconnects.add(fn),
      removeListener: (fn) => disconnects.delete(fn),
    },
    stop: () => [...listeners].forEach((fn) => fn({ stop: true })),
  }
}
const session = () => ({ modelName: 'local/text', conversationRecords: [] })
const sse = (chunks) =>
  new Response(
    chunks
      .map((value) => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
beforeEach(() => {
  state.config = {
    maxConversationContextLength: 10,
    maxResponseTokenLength: 1000,
    temperature: 1,
    ollamaKeepAliveTime: '5m',
    l1Providers: [
      {
        id: 'local',
        format: 'openai-compat',
        baseUrl: 'https://synthetic.invalid/v1',
        apiKey: 'synthetic',
      },
    ],
  }
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
it.each(['openai', 'custom', 'azure', 'claude', 'completion'])(
  'omits the replacement target only from %s request context while keeping its local record',
  async (kind) => {
    const p = port(),
      s = {
        ...session(),
        question: 'repeat',
        isRetry: true,
        appendRetryRecord: true,
        conversationRecords: [
          { question: 'older', answer: 'Older retained context' },
          { question: 'repeat', answer: 'Answer being regenerated' },
        ],
        retryReplacement: { index: 1, question: 'repeat', answer: 'Answer being regenerated' },
      }
    fetch.mockResolvedValue(sse([]))
    if (kind === 'custom')
      await generateAnswersWithCustomApi(p, 'repeat', s, 'https://synthetic.invalid/v1', '', 'text')
    else if (kind === 'openai')
      await generateAnswersWithChatgptApiCompat(
        'https://synthetic.invalid/v1',
        p,
        'repeat',
        s,
        'synthetic',
      )
    else if (kind === 'azure') await generateAnswersWithAzureOpenaiApi(p, 'repeat', s)
    else if (kind === 'claude') await generateAnswersWithClaudeApi(p, 'repeat', s)
    else
      await generateAnswersWithGptCompletionApi(
        p,
        'repeat',
        s,
        'synthetic',
        'https://synthetic.invalid/v1',
      )
    const request = JSON.parse(fetch.mock.calls[0][1].body)
    const context = kind === 'completion' ? request.prompt : JSON.stringify(request.messages)
    expect(context).toContain('Older retained context')
    expect(context).not.toContain('Answer being regenerated')
    expect(s.conversationRecords).toEqual([
      { question: 'older', answer: 'Older retained context' },
      { question: 'repeat', answer: 'Answer being regenerated' },
    ])
  },
)
it.each(['custom', 'openai', 'azure'])(
  'preserves %s EOF as incomplete with zero successful records',
  async (kind) => {
    const p = port(),
      s = session()
    fetch.mockResolvedValue(sse([{ choices: [{ delta: { content: 'partial text' } }] }]))
    if (kind === 'custom')
      await generateAnswersWithCustomApi(
        p,
        'question',
        s,
        'https://synthetic.invalid/v1',
        '',
        'text',
      )
    else if (kind === 'openai')
      await generateAnswersWithChatgptApiCompat(
        'https://synthetic.invalid/v1',
        p,
        'question',
        s,
        'synthetic',
      )
    else await generateAnswersWithAzureOpenaiApi(p, 'question', s)
    expect(p.posts.find((value) => value.done)).toMatchObject({
      outcome: 'incomplete',
      finalContent: 'partial text',
    })
    expect(s.conversationRecords).toEqual([])
  },
)
it('does not let DONE promote length-limited custom output to complete', async () => {
  const p = port(),
    s = session()
  fetch.mockResolvedValue(
    sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }, '[DONE]']),
  )
  await generateAnswersWithCustomApi(p, 'q', s, 'https://synthetic.invalid/v1', '', 'text')
  expect(p.posts.filter((value) => value.done && value.outcome === 'completed')).toEqual([])
  expect(s.conversationRecords).toEqual([])
})
it('rejects an Anthropic HTTP 200 error frame after partial output', async () => {
  const p = port(),
    s = session()
  fetch.mockResolvedValue(
    sse([{ delta: { text: 'partial' } }, { type: 'error', error: { message: 'overloaded' } }]),
  )
  await expect(generateAnswersWithClaudeApi(p, 'q', s)).rejects.toThrow('overloaded')
  expect(p.posts.some((value) => value.done && value.outcome === 'completed')).toBe(false)
  expect(s.conversationRecords).toEqual([])
})
it('requires an Anthropic stop reason rather than treating EOF as complete', async () => {
  const p = port(),
    s = session()
  fetch.mockResolvedValue(sse([{ delta: { text: 'partial' } }]))
  await generateAnswersWithClaudeApi(p, 'q', s)
  expect(p.posts.at(-1)).toMatchObject({ outcome: 'incomplete', finalContent: 'partial' })
})
it.each(['failed', 'incomplete'])(
  'rejects Responses status %s and preserves its known partial output',
  async (status) => {
    fetch.mockResolvedValue(
      Response.json({
        status,
        output_text: 'partial',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    )
    await expect(postOpenAiResponses('https://synthetic.invalid/v1', '', {})).rejects.toMatchObject(
      { partialAnswer: 'partial' },
    )
  },
)
it('Ollama Stop issues no keepalive generation or control request', async () => {
  const p = port(),
    s = session()
  fetch.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      }),
  )
  const running = generateAnswersWithOllamaApi(p, 'q', s)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  p.stop()
  await running
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('Ollama keeps successful models loaded without generating a dummy token', async () => {
  const p = port(),
    s = session()
  fetch
    .mockResolvedValueOnce(
      sse([{ choices: [{ delta: { content: 'complete' }, finish_reason: 'stop' }] }, '[DONE]']),
    )
    .mockResolvedValueOnce(Response.json({ done: true }))
  await generateAnswersWithOllamaApi(p, 'q', s)
  expect(fetch).toHaveBeenCalledTimes(2)
  const [url, init] = fetch.mock.calls[1]
  expect(url).toContain('/api/generate')
  expect(JSON.parse(init.body)).toEqual({ model: 'text', stream: false, keep_alive: '5m' })
  expect(init.signal).toBeInstanceOf(AbortSignal)
})

it.each(['chat', 'completion'])(
  'rejects an OpenAI %s stream error before trailing DONE can succeed',
  async (kind) => {
    const p = port(),
      s = session()
    fetch.mockResolvedValue(
      sse([
        { choices: [{ delta: { content: 'partial' }, text: 'partial' }] },
        { error: { message: 'backend failed' } },
        '[DONE]',
      ]),
    )
    const running =
      kind === 'chat'
        ? generateAnswersWithChatgptApiCompat(
            'https://synthetic.invalid/v1',
            p,
            'q',
            s,
            'synthetic',
          )
        : generateAnswersWithGptCompletionApi(p, 'q', s, 'synthetic', 'https://synthetic.invalid')
    await expect(running).rejects.toThrow('backend failed')
    expect(s.conversationRecords).toEqual([])
    expect(p.posts.some((message) => message.outcome === 'completed')).toBe(false)
  },
)
