/* eslint-env node */
// Dated synthetic defect witness. A fix can make these baseline assertions fail.
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs/promises'
import path from 'node:path'
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const results = []
const config = {
  maxConversationContextLength: 10,
  maxResponseTokenLength: 1000,
  temperature: 0.5,
  ollamaKeepAliveTime: '5m',
}
const context = vm.createContext({
  console: { debug() {}, log() {}, error() {} },
  AbortController,
  TextEncoder,
  TextDecoder,
  Response,
  URL,
  Intl,
  Date,
  Math,
  JSON,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  crypto: globalThis.crypto,
  fetch: (...args) => transport(...args),
})
let transport = () => {
  throw new Error('unexpected network call')
}
let activeGateway
const cache = new Map()
const overrides = new Map([
  ['src/config/storage.mjs', { getUserConfig: async () => config, setUserConfig: async () => {} }],
  ['src/config/predicates.mjs', { isUsingDshHarnessModel: () => true }],
  ['src/modules/background-services.mjs', { getDshGateway: () => activeGateway }],
  [
    'src/config/engine-selection.mjs',
    {
      stripTrailingV1: (value) =>
        String(value || '')
          .replace(/\/+$/, '')
          .replace(/\/v1$/, ''),
      resolveL1Credentials: () => ({ baseUrl: 'http://127.0.0.1:11434', modelId: 'llama' }),
    },
  ],
  ['src/utils/get-conversation-pairs.mjs', { getConversationPairs: () => [] }],
  [
    'src/utils/model-name-convert.mjs',
    { getModelValue: () => 'llama', isUsingReasoningModel: () => false },
  ],
  [
    'src/modules/dsh/background/fence.mjs',
    { diagnoseDsh: async () => ({}), helloForGatewayHold: () => ({}) },
  ],
  ['src/config/models.mjs', { Models: {} }],
  [
    'src/config/grok-web.mjs',
    {
      grokSlugToModeId: () => 'fast',
      resolveGrokChatSlug: () => 'grok-chat-fast',
      isGrokChatSlug: () => true,
      pickDefaultGrokWebKey: () => 'grokWebFast',
      slugsForGrokWebTier: () => ['grok-chat-fast'],
    },
  ],
  [
    'src/services/clients/grok-web/thread-state.mjs',
    { saveGrokWebSessionSnapshot: async () => {} },
  ],
  ['src/utils/grok-proxy-tab.mjs', { isGrokProxyPageHost: (host) => host === 'grok.com' }],
])
function synthetic(key, data) {
  return new vm.SyntheticModule(
    Object.keys(data),
    function () {
      for (const [k, v] of Object.entries(data)) this.setExport(k, v)
    },
    { context, identifier: key },
  )
}
async function load(key) {
  if (cache.has(key)) return cache.get(key)
  let mod
  if (overrides.has(key)) mod = synthetic(key, overrides.get(key))
  else if (key === 'webextension-polyfill')
    mod = synthetic(key, {
      default: { runtime: { getURL: (p) => `chrome-extension://test-id${p}` } },
    })
  else if (key === 'lodash-es')
    mod = synthetic(key, { isEmpty: (x) => !x || Object.keys(x).length === 0 })
  else {
    const source = await fs.readFile(path.join(root, key), 'utf8')
    mod = new vm.SourceTextModule(source, { context, identifier: key })
  }
  cache.set(key, mod)
  await mod.link((specifier, referencing) => {
    const resolved = specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(referencing.identifier), specifier))
      : specifier
    return load(resolved)
  })
  return mod
}
async function imports(key) {
  const mod = await load(key)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace
}
function event() {
  const listeners = new Set()
  return {
    addListener: (l) => listeners.add(l),
    removeListener: (l) => listeners.delete(l),
    emit: (...args) => {
      for (const l of [...listeners]) l(...args)
    },
  }
}
function port() {
  const posts = []
  return {
    posts,
    postMessage: (msg) => posts.push(structuredClone(msg)),
    onMessage: event(),
    onDisconnect: event(),
  }
}
const noTimers = {
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
}
const storage = { local: { get: async () => ({}), set: async () => {} } }
const { createDshGateway } = await imports('src/modules/dsh/background/gateway.mjs')
const bridge = (await imports('src/background/providers/dsh-bridge.mjs')).default
{
  const gateway = createDshGateway({
    endpoint: 'http://127.0.0.1:3080',
    storage,
    client: {
      rpc: async () => {
        throw new Error('should not reach harness')
      },
    },
    timers: noTimers,
  })
  activeGateway = { ...gateway, getState: () => ({ status: 'online' }) }
  const p = port()
  await bridge.run({
    port: p,
    session: {
      sessionId: 'box-1',
      question: 'hello',
      modelName: 'dsh/agent',
      conversationRecords: [],
    },
    config: { dshModuleEnabled: true },
  })
  results.push({ case: 'DSH new floating conversation', posts: p.posts })
}
{
  let historyResolve
  let history = {
    events: [
      {
        event: {
          type: 'assistant/message',
          seq: 1,
          data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'old answer' }] } },
        },
      },
    ],
    hasMore: false,
  }
  const client = {
    rpc: async (method) =>
      method === 'session.list'
        ? { items: [{ sessionId: 's1' }] }
        : method === 'session.history'
        ? history
        : {},
  }
  const gateway = createDshGateway({
    endpoint: 'http://127.0.0.1:3080',
    storage,
    client,
    timers: noTimers,
  })
  await gateway._internals.syncRegistry()
  history = new Promise((resolve) => {
    historyResolve = resolve
  })
  const pending = gateway._internals.pullHistory('s1')
  gateway._internals.handleMuxFrame({
    type: 'session/event',
    sessionId: 's1',
    event: {
      type: 'assistant/chunk',
      seq: 5,
      data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'live-tail' } },
    },
  })
  historyResolve({
    events: [
      {
        event: {
          type: 'tool/call',
          seq: 2,
          data: { turn: 2, step: 1, callId: 'call-1', name: 'shell', arguments: 'ls' },
        },
      },
      {
        event: {
          type: 'tool/result',
          seq: 3,
          data: {
            turn: 2,
            step: 1,
            message: { toolCallId: 'call-1', content: [{ type: 'text', text: 'file.txt' }] },
          },
        },
      },
      {
        event: {
          type: 'assistant/chunk',
          seq: 4,
          data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'missed-prefix-' } },
        },
      },
      {
        event: {
          type: 'assistant/chunk',
          seq: 5,
          data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'live-tail' } },
        },
      },
    ],
    hasMore: false,
  })
  await pending
  results.push({
    case: 'DSH live event overtakes reconnect history',
    lastSeq: gateway._internals.sessions.get('s1').fold.getLastSeq(),
    blocks: gateway._internals.sessions.get('s1').fold.getBlocks(),
  })
}
{
  const { handleGrokProxyRequest } = await imports('src/content-script/grok-proxy-handlers.mjs')
  const session = {
    sessionId: 'box-grok-1',
    question: 'hello',
    modelName: 'grokweb/grok-chat-fast',
    conversationRecords: [],
  }
  const posts = []
  const frames = [
    { result: { conversation: { conversationId: 'grok-c1' } } },
    { result: { response: { userResponse: { responseId: 'grok-u1' } } } },
    {
      result: {
        response: { modelResponse: { message: 'hello back', parentResponseId: 'grok-u1' } },
      },
    },
  ]
  await handleGrokProxyRequest({
    session,
    hostname: 'grok.com',
    setUserConfig: async () => {},
    post: (m) => posts.push(structuredClone(m)),
    fetch: async (url) =>
      url.endsWith('/api/auth/session')
        ? Response.json({ user: { id: 'fake-user' } })
        : url.endsWith('/rest/rate-limits')
        ? Response.json({ tier: 'basic' })
        : new Response(frames.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(''), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
  })
  results.push({
    case: 'Grok complete answer history',
    final: posts.at(-1),
    recordCount: session.conversationRecords.length,
  })
}
{
  const { generateAnswersWithOllamaApi } = await imports('src/services/apis/ollama-api.mjs')
  const p = port(),
    calls = []
  let began
  const waiting = new Promise((resolve) => {
    began = resolve
  })
  transport = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), aborted: init.signal?.aborted || false })
    if (url.endsWith('/chat/completions')) {
      began()
      return new Promise((resolve, reject) =>
        init.signal.addEventListener(
          'abort',
          () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            reject(e)
          },
          { once: true },
        ),
      )
    }
    return Response.json({ done: true })
  }
  const done = generateAnswersWithOllamaApi(p, 'hello', {
    modelName: 'local/llama',
    conversationRecords: [],
  })
  await waiting
  p.onMessage.emit({ stop: true })
  await done
  results.push({ case: 'Ollama stop during first POST', calls, posts: p.posts })
}
{
  const { generateAnswersWithCustomApi } = await imports('src/services/apis/custom-api.mjs')
  const p = port(),
    session = { conversationRecords: [] }
  transport = async () =>
    new Response(
      'data: {"choices":[{"delta":{"content":"unfinished prefix"},"finish_reason":null}]}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  await generateAnswersWithCustomApi(
    p,
    'hello',
    session,
    'https://api.example.invalid/v1',
    '',
    'test',
  )
  results.push({ case: 'Custom API abrupt SSE EOF without done', session, posts: p.posts })
}
{
  const { generateAnswersWithClaudeApi } = await imports('src/services/apis/claude-api.mjs')
  const p = port(),
    session = { modelName: 'anth/claude', conversationRecords: [] }
  transport = async () =>
    new Response(
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  await generateAnswersWithClaudeApi(p, 'hello', session)
  results.push({ case: 'Anthropic error event after HTTP 200', session, posts: p.posts })
}
{
  const { generateAnswersWithCustomApi } = await imports('src/services/apis/custom-api.mjs')
  const p = port(),
    session = { conversationRecords: [] }
  transport = async () =>
    Response.json({
      status: 'failed',
      error: { code: 'server_error', message: 'failed after acceptance' },
      output: [],
    })
  await generateAnswersWithCustomApi(
    p,
    'hello',
    session,
    'https://api.example.invalid/v1/responses',
    '',
    'test',
  )
  results.push({ case: 'Responses status failed with HTTP 200', session, posts: p.posts })
}
// Preserve the observed baseline as a witness rather than silently succeeding
// when one of the inspected boundaries changes.
const observed = JSON.parse(JSON.stringify(results))
const cases = Object.fromEntries(observed.map((result) => [result.case, result]))
assert.equal(
  cases['DSH new floating conversation'].posts[0].error,
  'workspaceId is required for session.create',
)
assert.deepEqual(
  cases['DSH live event overtakes reconnect history'].blocks.map((block) => block.seq),
  [1, 5],
)
assert.equal(cases['Grok complete answer history'].recordCount, 0)
assert.deepEqual(
  cases['Ollama stop during first POST'].calls.map((call) => new URL(call.url).pathname),
  ['/v1/chat/completions', '/api/generate'],
)
assert.equal(
  cases['Custom API abrupt SSE EOF without done'].session.conversationRecords[0].answer,
  'unfinished prefix',
)
assert.equal(cases['Custom API abrupt SSE EOF without done'].posts.at(-1).done, true)
assert.deepEqual(cases['Anthropic error event after HTTP 200'].posts, [{ done: true }])
assert.equal(
  cases['Responses status failed with HTTP 200'].session.conversationRecords[0].answer,
  '',
)
assert.equal(cases['Responses status failed with HTTP 200'].posts.at(-1).done, true)
process.stdout.write(JSON.stringify(observed, null, 2) + '\n')
