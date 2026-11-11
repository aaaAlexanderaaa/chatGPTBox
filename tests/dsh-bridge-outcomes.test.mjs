import { beforeEach, expect, it, vi } from 'vitest'
import { createDshLedgerFold } from '../src/modules/dsh/turn-fold.mjs'
const state = vi.hoisted(() => ({ gateway: null }))
vi.mock('../src/modules/background-services.mjs', () => ({ getDshGateway: () => state.gateway }))
import provider from '../src/background/providers/dsh-bridge.mjs'
function port() {
  const listeners = new Set(),
    disconnects = new Set(),
    posts = []
  return {
    posts,
    postMessage: (message) => posts.push(message),
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
let s, p, fold, watch, seq
const config = { dshModuleEnabled: true, dshEndpoint: 'http://127.0.0.1:3080' }
function event(type, data) {
  fold.pushEvent({ type, seq: ++seq, data })
}
function publish() {
  watch({ sessionId: 's', historyLoaded: true, blocks: fold.getBlocks() })
}
beforeEach(() => {
  seq = 0
  fold = createDshLedgerFold()
  p = port()
  s = {
    modelName: 'dsh/agent',
    question: 'our question',
    conversationRecords: [],
    dshWorkspaceId: 'workspace',
    dshEndpoint: config.dshEndpoint,
  }
  state.gateway = {
    getState: () => ({ status: 'online' }),
    watchLedger: (_id, fn) => {
      watch = fn
      publish()
      return () => {}
    },
    rpc: vi.fn(async (method) =>
      method === 'session.create' ? { sessionId: 's' } : { accepted: true },
    ),
  }
})
it.each(['completed', 'aborted', 'interrupted', 'blocked', 'max-tokens', 'error'])(
  'separates final text from the tool ledger for %s turns',
  async (kind) => {
    state.gateway.rpc.mockImplementation(async (method, request) => {
      if (method === 'session.create') return { sessionId: 's' }
      event('user/message', {
        turn: 1,
        message: {
          source: { rpcId: request.requestId },
          content: [{ type: 'text', text: s.question }],
        },
      })
      event('assistant/message', {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: 'I will inspect the files.' }] },
      })
      event('tool/call', { turn: 1, step: 0, callId: 'read', name: 'read', arguments: '{}' })
      event('assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'Final rewritten draft.' }] },
      })
      event('turn/end', { turn: 1, reason: { kind } })
      publish()
      return { accepted: true }
    })
    await provider.run({ port: p, session: s, config })
    const terminal = p.posts.find((message) => message.outcome && message.outcome !== 'stopped')
    expect(terminal.answer).toContain('read')
    expect(terminal.finalContent).toBe(kind === 'completed' ? 'Final rewritten draft.' : '')
    expect(terminal.outcome).toBe(kind === 'completed' ? 'completed' : 'incomplete')
    expect(s.conversationRecords).toHaveLength(kind === 'completed' ? 1 : 0)
  },
)
it('does not substitute an earlier progress step when the final assistant message is empty', async () => {
  state.gateway.rpc.mockImplementation(async (method, request) => {
    if (method === 'session.create') return { sessionId: 's' }
    event('user/message', {
      turn: 1,
      message: {
        source: { rpcId: request.requestId },
        content: [{ type: 'text', text: s.question }],
      },
    })
    event('assistant/message', {
      turn: 1,
      step: 0,
      message: { content: [{ type: 'text', text: 'I will inspect.' }] },
    })
    event('assistant/message', { turn: 1, step: 1, message: { content: [] } })
    event('turn/end', { turn: 1, reason: { kind: 'completed' } })
    publish()
    return { accepted: true }
  })
  await provider.run({ port: p, session: s, config })
  expect(p.posts.at(-1)).toMatchObject({ outcome: 'incomplete', finalContent: '' })
  expect(s.conversationRecords).toEqual([])
})
it('Stop during session creation prevents a later prompt', async () => {
  let release
  state.gateway.rpc.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const running = provider.run({ port: p, session: s, config })
  p.stop()
  release({ sessionId: 's' })
  await running
  expect(state.gateway.rpc.mock.calls.map(([method]) => method)).toEqual(['session.create'])
  expect(p.posts.some((message) => message.outcome === 'stopped')).toBe(true)
})
it('requires a chosen workspace before new-session writes', async () => {
  delete s.dshWorkspaceId
  await provider.run({ port: p, session: s, config })
  expect(state.gateway.rpc).not.toHaveBeenCalled()
})

it('uses the native RPC identity when two surfaces ask the same words in different turns', async () => {
  state.gateway.rpc.mockImplementation(async (method, request) => {
    if (method === 'session.create') return { sessionId: 's' }
    event('turn/start', { turn: 2 })
    event('step/start', { turn: 2, step: 0 })
    event('user/message', {
      role: 'user',
      content: [{ type: 'text', text: s.question }],
      source: { kind: 'user', rpcId: 'other-request' },
    })
    event('assistant/message', {
      role: 'assistant',
      content: [{ type: 'text', text: 'Another surface answer' }],
    })
    event('turn/end', { turn: 2, reason: { kind: 'completed' } })
    publish()
    expect(p.posts.some((message) => message.done)).toBe(false)
    event('turn/start', { turn: 3 })
    event('step/start', { turn: 3, step: 0 })
    event('user/message', {
      role: 'user',
      content: [{ type: 'text', text: s.question }],
      source: { kind: 'user', rpcId: request.requestId },
    })
    event('assistant/message', {
      role: 'assistant',
      content: [{ type: 'text', text: 'Our answer' }],
    })
    event('turn/end', { turn: 3, reason: { kind: 'completed' } })
    publish()
    return { accepted: true }
  })
  await provider.run({ port: p, session: s, config })
  expect(p.posts.at(-1)).toMatchObject({ finalContent: 'Our answer', outcome: 'completed' })
  expect(s.conversationRecords).toEqual([{ question: s.question, answer: 'Our answer' }])
})
it('keeps an unidentified other turn pending rather than ending this request', async () => {
  state.gateway.rpc.mockImplementation(async (method) => {
    if (method === 'session.create') return { sessionId: 's' }
    event('turn/start', { turn: 1 })
    event('step/start', { turn: 1, step: 0 })
    event('user/message', { role: 'user', content: [{ type: 'text', text: s.question }] })
    event('assistant/message', { content: [{ type: 'text', text: 'Uncorrelated answer' }] })
    event('turn/end', { turn: 1, reason: { kind: 'completed' } })
    publish()
    return { accepted: true }
  })
  await provider.run({ port: p, session: s, config })
  expect(p.posts.some((message) => message.outcome === 'completed')).toBe(false)
  expect(p.posts.filter((message) => message.dshStatus).at(-1).dshStatus.text).toContain('identity')
  expect(p.posts.at(-1)).toMatchObject({ accepted: true })
  expect(p.posts.at(-1)).not.toHaveProperty('dshStatus')
  expect(p.posts.some((message) => message.done)).toBe(false)
  expect(s.conversationRecords).toEqual([])
})

it('carries the chosen prompt identity through the gateway and native client envelope', async () => {
  const { createDshGateway } = await import('../src/modules/dsh/background/gateway.mjs')
  const { createDshClient } = await import('../src/modules/dsh/client.mjs')
  const captured = []
  const native = createDshClient({
    baseUrl: 'http://127.0.0.1:3080',
    WebSocketImpl: class {},
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      captured.push(body)
      return Response.json({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { accepted: true } },
      })
    },
  })
  const gateway = createDshGateway({
    endpoint: 'http://127.0.0.1:3080',
    client: native,
    storage: { local: { get: async () => ({}) } },
  })
  await gateway.rpc('session.prompt', {
    sessionId: 's',
    requestId: 'client-owned-request',
    content: [{ type: 'text', text: 'Continue' }],
  })
  expect(captured).toHaveLength(1)
  expect(captured[0]).toMatchObject({
    rpcId: 'client-owned-request',
    method: 'session.prompt',
    payload: { sessionId: 's' },
  })
  expect(captured[0].payload).not.toHaveProperty('requestId')
})

it('Stop during history preparation does not cancel another client’s active session', async () => {
  s.dshSessionId = 's'
  let release
  state.gateway.rpc.mockImplementation((method) =>
    method === 'session.history-older'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve({ accepted: true }),
  )
  const running = provider.run({ port: p, session: s, config })
  p.stop()
  release({ hasMore: false })
  await running
  expect(state.gateway.rpc.mock.calls.map(([method]) => method)).toEqual(['session.history-older'])
})
it('does not contradict a completed turn when its prompt acknowledgement later fails', async () => {
  state.gateway.rpc.mockImplementation(async (method, request) => {
    if (method === 'session.create') return { sessionId: 's' }
    event('turn/start', { turn: 1 })
    event('step/start', { turn: 1, step: 0 })
    event('user/message', {
      content: [{ type: 'text', text: s.question }],
      source: { rpcId: request.requestId },
    })
    event('assistant/message', { content: [{ type: 'text', text: 'Complete answer' }] })
    event('turn/end', { turn: 1, reason: { kind: 'completed' } })
    publish()
    throw new Error('acknowledgement lost after completion')
  })
  await provider.run({ port: p, session: s, config })
  expect(p.posts.filter((message) => message.done)).toHaveLength(1)
  expect(p.posts.some((message) => message.error)).toBe(false)
})

it('continues observing after an unidentified same-text turn and adopts only the later native request', async () => {
  state.gateway.rpc.mockImplementation(async (method, request) => {
    if (method === 'session.create') return { sessionId: 's' }
    event('turn/start', { turn: 2 })
    event('step/start', { turn: 2, step: 0 })
    event('user/message', { content: [{ type: 'text', text: s.question }] })
    event('assistant/message', { content: [{ type: 'text', text: 'Another surface answer' }] })
    event('turn/end', { turn: 2, reason: { kind: 'completed' } })
    publish()
    expect(p.posts.some((message) => message.done)).toBe(false)
    event('turn/start', { turn: 3 })
    event('step/start', { turn: 3, step: 0 })
    event('user/message', {
      content: [{ type: 'text', text: s.question }],
      source: { rpcId: request.requestId },
    })
    event('assistant/message', { content: [{ type: 'text', text: 'Our later answer' }] })
    event('turn/end', { turn: 3, reason: { kind: 'completed' } })
    publish()
    return { accepted: true }
  })
  await provider.run({ port: p, session: s, config })
  expect(p.posts.at(-1)).toMatchObject({
    finalContent: 'Our later answer',
    outcome: 'completed',
    dshStatus: null,
  })
  expect(s.conversationRecords).toEqual([{ question: s.question, answer: 'Our later answer' }])
})
