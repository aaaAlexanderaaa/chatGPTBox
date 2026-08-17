import { Buffer } from 'node:buffer'
import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createDshGateway } from '../src/modules/dsh/background/gateway.mjs'
import { createDshClient } from '../src/modules/dsh/client.mjs'

// Integration test against an in-process fake `dsh web` gateway: real HTTP
// RPC + real mux/host WebSockets, wire shapes per the harness source
// (packages/host/apiproxy). This is where the roadmap's acceptance #3
// (socket loss -> reconnect + history compensation, no duplicates) and the
// approval lifecycle are exercised end to end.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createFakeHarness() {
  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/api/')) {
      res.writeHead(404).end()
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let envelope
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      res.writeHead(400).end()
      return
    }
    const reply = (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }))
    }

    if (req.url === '/api/respond') {
      harness.respondCalls.push(envelope)
      // The harness replies with a bare RpcReceipt, not an envelope.
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ accepted: harness.respondAccepted }))
      return
    }
    const method = req.url.slice('/api/'.length)
    const handler = harness.rpc[method]
    if (!handler) {
      reply({ ok: false, error: { code: 'unknown-method', message: method } })
      return
    }
    try {
      reply({ ok: true, value: await handler(envelope.payload) })
    } catch (error) {
      reply({ ok: false, error: { code: 'internal', message: String(error?.message || error) } })
    }
  })

  const muxWss = new WebSocketServer({ noServer: true })
  const hostWss = new WebSocketServer({ noServer: true })
  /** @type {Set<WebSocket>} */
  const muxClients = new Set()
  /** @type {Set<WebSocket>} */
  const hostClients = new Set()

  server.on('upgrade', (req, socket, head) => {
    const wss =
      req.url === '/api/events.mux' ? muxWss : req.url === '/api/events.host' ? hostWss : null
    if (!wss) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
      ;(wss === muxWss ? muxClients : hostClients).add(ws)
      ws.on('close', () => (wss === muxWss ? muxClients : hostClients).delete(ws))
    })
  })

  const harness = {
    server,
    port: 0,
    respondCalls: [],
    respondAccepted: true,
    /** Mutable session store the RPC handlers read. */
    sessions: {},
    historyEvents: {},
    rpc: {
      'host.describe': async () => ({ version: '0.1.0-test', cwd: '/tmp' }),
      'session.list': async () => ({
        items: Object.entries(harness.sessions).map(([sessionId, s]) => ({
          sessionId,
          updatedAt: s.updatedAt ?? 1,
          running: s.running ?? false,
          blank: s.blank ?? false,
        })),
      }),
      'session.create': async (payload) => {
        harness.lastCreate = payload
        const sessionId = payload.sessionId || `session-${Math.random().toString(36).slice(2)}`
        harness.sessions[sessionId] = { blank: true, running: false }
        return { sessionId, agentPreset: payload.agentPreset }
      },
      'workspace.list': async () => ({ items: harness.workspaces || [], archivedSessionIds: [] }),
      'workspace.create': async (payload) => {
        harness.lastWorkspaceCreate = payload
        return {
          workspace: { workspaceId: 'w1', path: payload.path, title: 't', sessionIds: [] },
          created: true,
        }
      },
      'agentPreset.list': async () => ({
        presets: [{ id: 'standard', trust: 'system', isDefault: true }],
        authorable: true,
        hasDocument: false,
      }),
      'settings.describe': async (payload) => ({
        sections: [{ namespace: payload?.namespace || 'locale', revision: 1 }],
      }),
      'session.history': async (payload) => ({
        events: (harness.historyEvents[payload.sessionId] || []).map((event) => ({ event })),
        hasMore: false,
        projections: { asOfSeq: 5, values: { title: 'Fix the build' } },
      }),
      'session.prompt': async () => ({ accepted: true }),
      'session.cancel': async () => ({ accepted: true }),
      'session.updateQueue': async (payload) => {
        harness.lastUpdateQueue = payload
        return { accepted: true }
      },
      'session.rename': async (payload) => ({ title: payload.title }),
      'session.fork': async () => ({ sessionId: 'forked' }),
      'session.models': async () => ({
        current: { provider: 'deepseek', model: 'chat' },
        routable: true,
        groups: [],
      }),
      'session.selectModel': async () => ({ selected: {} }),
    },
    /** Broadcast a mux frame (server-request envelope) to every subscriber. */
    broadcast(frame) {
      const envelope = JSON.stringify({
        type: 'server-request',
        rpcId: `srv-${Math.random().toString(36).slice(2)}`,
        method: frame.type,
        payload: frame,
      })
      for (const ws of muxClients) ws.send(envelope)
    },
    broadcastHost(frame) {
      const envelope = JSON.stringify({
        type: 'server-request',
        rpcId: `srv-${Math.random().toString(36).slice(2)}`,
        method: frame.type,
        payload: frame,
      })
      for (const ws of hostClients) ws.send(envelope)
    },
    dropMuxClients() {
      for (const ws of muxClients) ws.terminate() // abnormal drop, no close frame
    },
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      harness.port = server.address().port
      return `http://127.0.0.1:${harness.port}`
    },
    async stop() {
      for (const ws of [...muxClients, ...hostClients]) ws.close()
      await new Promise((resolve) => server.close(resolve))
    },
  }
  return harness
}

function createTestPort() {
  const received = []
  const listeners = { message: [], disconnect: [] }
  return {
    received,
    postMessage: (message) => received.push(message),
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onDisconnect: { addListener: (fn) => listeners.disconnect.push(fn) },
    send: (message) => listeners.message.forEach((fn) => fn(message)),
    disconnect: () => listeners.disconnect.forEach((fn) => fn()),
    receivedOf: (type) => received.filter((m) => m.type === type),
  }
}

/** Drive a correlated RPC through the port and resolve with its result. */
async function portRequest(port, method, args) {
  const id = `req-${Math.random().toString(36).slice(2)}`
  const done = new Promise((resolve) => {
    const timer = setInterval(() => {
      const res = port.received.find((m) => m.type === 'res' && m.id === id)
      if (res) {
        clearInterval(timer)
        resolve(res)
      }
    }, 10)
  })
  port.send({ type: 'req', id, method, args })
  return done
}

/** Standalone gateway boot for focused RPC cases (workspace / preset / settings). */
async function startGateway() {
  const harness = createFakeHarness()
  const endpoint = await harness.start()
  const gateway = createDshGateway({
    endpoint,
    storage: { local: { get: async () => ({}), set: async () => {} } },
    client: createDshClient({
      baseUrl: endpoint,
      fetchImpl: (...args) => fetch(...args),
      WebSocketImpl: WebSocket,
    }),
  })
  await gateway.start()
  await sleep(150)
  return { gateway, harness }
}

describe('dsh gateway (against a fake harness)', () => {
  let harness
  let gateway
  let hostHooks

  beforeEach(async () => {
    harness = createFakeHarness()
    const endpoint = await harness.start()
    harness.sessions['s1'] = { running: true, updatedAt: 42 }
    harness.historyEvents['s1'] = [
      { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
      {
        type: 'assistant/chunk',
        seq: 1,
        time: 1100,
        data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Hello' } },
      },
      {
        type: 'assistant/message',
        seq: 2,
        time: 1200,
        data: {
          turn: 1,
          step: 0,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        },
      },
    ]
    hostHooks = {
      notified: [],
      badge: vi.fn(),
      notifyWaiting: (payload) => hostHooks.notified.push(payload),
      clearWaiting: vi.fn(),
      setBadge: (count) => hostHooks.badge(count),
    }
    gateway = createDshGateway({
      endpoint,
      storage: { local: { get: async () => ({}), set: async () => {} } },
      host: hostHooks,
      client: createDshClient({
        baseUrl: endpoint,
        fetchImpl: (...args) => fetch(...args),
        WebSocketImpl: WebSocket,
      }),
    })
    await gateway.start()
    await sleep(150) // let connect + syncRegistry settle
  })

  afterEach(async () => {
    gateway?.stop()
    await harness.stop()
  })

  it('connects both streams, adopts sessions, pulls history + projections', () => {
    expect(gateway.getState()).toMatchObject({ status: 'online', version: '0.1.0-test' })
    const summaries = gateway.getSessionSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ sessionId: 's1', title: 'Fix the build' })
    const fold = gateway._internals.sessions.get('s1').fold
    expect(fold.getLastSeq()).toBe(2)
    expect(fold.getBlocks()[0].text).toBe('Hello')
  })

  it('fans out to ports: hello, session list, subscribed ledger', async () => {
    const port = createTestPort()
    gateway.attachPort(port)
    expect(port.receivedOf('hello')[0]).toMatchObject({ type: 'hello', status: 'online' })
    expect(port.receivedOf('sessions')[0].items[0]).toMatchObject({ sessionId: 's1' })
    port.send({ type: 'subscribe-ledger', sessionId: 's1' })
    await sleep(20)
    const ledger = port.receivedOf('ledger').at(-1)
    expect(ledger.sessionId).toBe('s1')
    expect(ledger.blocks.length).toBeGreaterThan(0)

    harness.broadcast({
      type: 'session/event',
      sessionId: 's1',
      event: {
        type: 'assistant/chunk',
        seq: 3,
        time: 1300,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: ' more' } },
      },
    })
    await sleep(120) // ledger debounce
    expect(port.receivedOf('ledger').at(-1).blocks).toHaveLength(2)
  })

  it('approval lifecycle: badge + notification when unattached, respond via port', async () => {
    const port = createTestPort()
    gateway.attachPort(port)

    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap1',
      toolName: 'shell',
      callId: 'c1',
    })
    await sleep(30)
    // Unattached: OS notification + badge carry the life-level contract.
    expect(hostHooks.notified.at(-1)).toMatchObject({ sessionId: 's1', kind: 'approval' })
    expect(hostHooks.badge).toHaveBeenLastCalledWith(1)
    const summary = gateway.getSessionSummaries()[0]
    expect(summary.waiting).toBe(1)
    expect(summary.pendingDecisions).toEqual([
      expect.objectContaining({
        kind: 'approval',
        approvalId: 'ap1',
        toolName: 'shell',
        sessionId: 's1',
      }),
    ])

    const res = await portRequest(port, 'approval.respond', {
      rpcId: gateway._internals.sessions.get('s1').fold.getPendingDecisions()[0].rpcId,
      sessionId: 's1',
      approvalId: 'ap1',
      outcome: 'allowed-once',
    })
    expect(res.ok).toBe(true)
    expect(harness.respondCalls.at(-1)).toMatchObject({
      type: 'client-response',
      result: { ok: true, value: { sessionId: 's1', approvalId: 'ap1', outcome: 'allowed-once' } },
    })
    expect(gateway.getSessionSummaries()[0].waiting).toBe(0)

    // Resolution by another client settles the block too (idempotent).
    harness.broadcast({
      type: 'approval/resolved',
      sessionId: 's1',
      approvalId: 'ap1',
      outcome: 'allowed-once',
    })
    await sleep(30)
    expect(gateway.getSessionSummaries()[0].waiting).toBe(0)
    expect(hostHooks.badge).toHaveBeenLastCalledWith(0)
  })

  it('auto-approve (D-8): gateway answers when the session switch is on', async () => {
    const port = createTestPort()
    gateway.attachPort(port)
    await portRequest(port, 'autoApprove.set', { sessionId: 's1', value: true })

    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap2',
      toolName: 'shell',
    })
    await sleep(50)
    expect(harness.respondCalls).toHaveLength(1)
    expect(harness.respondCalls[0].result.value).toMatchObject({
      approvalId: 'ap2',
      outcome: 'allowed-once',
    })
    expect(gateway.getSessionSummaries()[0].waiting).toBe(0)
  })

  it('reconnect: mux loss -> backoff -> reopen + history compensation without duplicates', async () => {
    const before = gateway._internals.sessions.get('s1').fold.getBlocks().length
    expect(before).toBeGreaterThan(0)

    // The turn continues while we are deaf: server folds seq 3-5.
    harness.historyEvents['s1'].push(
      {
        type: 'tool/call',
        seq: 3,
        time: 2000,
        data: { turn: 1, step: 1, callId: 'c1', name: 'shell', arguments: '{"cmd":"ls"}' },
      },
      {
        type: 'tool/result',
        seq: 4,
        time: 3000,
        data: { turn: 1, step: 1, message: { toolCallId: 'c1', content: [] } },
      },
      { type: 'turn/end', seq: 5, time: 4000, data: { turn: 1, reason: { kind: 'completed' } } },
    )
    harness.dropMuxClients()
    await sleep(150) // reconnect backoff (500ms base) has not elapsed yet
    expect(gateway.getState().status).toBe('connecting')

    await sleep(700) // first reconnect attempt fires
    await sleep(250) // syncRegistry completes
    expect(gateway.getState().status).toBe('online')

    const fold = gateway._internals.sessions.get('s1').fold
    expect(fold.getLastSeq()).toBe(5)
    const kinds = fold.getBlocks().map((b) => b.kind)
    expect(kinds).toEqual(['text', 'tool', 'turn-end']) // no duplicates from the replay
    const turnEnd = fold.getBlocks().at(-1)
    expect(turnEnd).toMatchObject({ kind: 'turn-end', reasonKind: 'completed', steps: 0, tools: 1 })
  })

  it('host frames maintain the session rows', async () => {
    harness.broadcastHost({ type: 'host/session-added', sessionId: 's2', blank: true })
    await sleep(30)
    expect(gateway.getSessionSummaries().map((s) => s.sessionId)).toEqual(['s1', 's2'])

    harness.broadcastHost({ type: 'host/session-status', sessionId: 's2', running: true })
    await sleep(30)
    expect(gateway.getSessionSummaries().find((s) => s.sessionId === 's2').running).toBe(true)

    harness.broadcastHost({ type: 'host/session-removed', sessionId: 's2' })
    await sleep(30)
    expect(gateway.getSessionSummaries().map((s) => s.sessionId)).toEqual(['s1'])
  })

  it('adopts a question for a session not yet in the registry', async () => {
    harness.broadcast({
      type: 'question/requested',
      sessionId: 's-new',
      questions: [{ id: 'q1', question: 'Continue?' }],
    })
    await sleep(30)
    const row = gateway.getSessionSummaries().find((s) => s.sessionId === 's-new')
    expect(row?.waiting).toBe(1)
  })

  it('question lifecycle: answer with options and free text', async () => {
    const port = createTestPort()
    gateway.attachPort(port)
    harness.broadcast({
      type: 'question/requested',
      sessionId: 's1',
      questions: [
        { id: 'q1', question: 'Which DB?', options: [{ label: 'postgres' }, { label: 'sqlite' }] },
      ],
    })
    await sleep(30)
    expect(gateway.getSessionSummaries()[0].waiting).toBe(1)
    expect(gateway.getSessionSummaries()[0].pendingDecisions).toEqual([
      expect.objectContaining({
        kind: 'question',
        questions: [{ id: 'q1', question: 'Which DB?', options: expect.any(Array) }],
        sessionId: 's1',
      }),
    ])
    expect(hostHooks.notified.at(-1)).toMatchObject({ kind: 'question' })

    const res = await portRequest(port, 'question.respond', {
      rpcId: gateway._internals.sessions.get('s1').fold.getPendingDecisions()[0].rpcId,
      sessionId: 's1',
      answers: [{ id: 'q1', selected: ['postgres'] }],
    })
    expect(res.ok).toBe(true)
    expect(harness.respondCalls.at(-1).result.value.answer).toEqual({
      answers: [{ id: 'q1', selected: ['postgres'] }],
    })
    expect(gateway.getSessionSummaries()[0].waiting).toBe(0)
  })

  it('late answers do not lie: not-pending keeps the card honest', async () => {
    harness.respondAccepted = false // e.g. answered first from the dsh web UI
    const port = createTestPort()
    gateway.attachPort(port)
    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap9',
      toolName: 'shell',
    })
    await sleep(30)
    const pending = gateway._internals.sessions.get('s1').fold.getPendingDecisions()[0]
    const res = await portRequest(port, 'approval.respond', {
      rpcId: pending.rpcId,
      sessionId: 's1',
      approvalId: 'ap9',
      outcome: 'rejected',
    })
    expect(res.ok).toBe(true)
    // Receipt said not accepted -> the block stays pending (the truth is on
    // the wire; a resolution frame will settle it).
    expect(gateway._internals.sessions.get('s1').fold.getPendingDecisions()).toHaveLength(1)
  })

  it('stop() tears everything down', async () => {
    gateway.stop()
    expect(gateway.getState().status).toBe('offline')
    expect(hostHooks.badge).toHaveBeenLastCalledWith(0)
    gateway = null // afterEach would stop() a stopped gateway, which is fine too
  })

  it('does not dismiss another session’s OS notification when this one is answered', async () => {
    harness.sessions['s2'] = { running: false, updatedAt: 99 }
    harness.broadcastHost({ type: 'host/session-added', sessionId: 's2', blank: true })
    await sleep(30)
    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap-a',
      toolName: 'shell',
    })
    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's2',
      approvalId: 'ap-b',
      toolName: 'edit',
    })
    await sleep(40)
    hostHooks.clearWaiting.mockClear()
    const s2Pending = gateway._internals.sessions.get('s2').fold.getPendingDecisions()[0]
    await gateway.rpc('approval.respond', {
      rpcId: s2Pending.rpcId,
      sessionId: 's2',
      approvalId: 'ap-b',
      outcome: 'allowed-once',
    })
    await sleep(30)
    expect(hostHooks.clearWaiting).not.toHaveBeenCalled()
    expect(hostHooks.badge).toHaveBeenLastCalledWith(1)
    expect(hostHooks.notified.at(-1)).toMatchObject({ sessionId: 's1', kind: 'approval' })
  })

  it('auto-approves a pending card that arrived before storage finished loading', async () => {
    gateway.stop()
    let resolveGet
    const delayedGet = new Promise((resolve) => {
      resolveGet = resolve
    })
    gateway = createDshGateway({
      endpoint: `http://127.0.0.1:${harness.port}`,
      storage: {
        local: {
          get: async () => delayedGet,
          set: async () => {},
        },
      },
      host: hostHooks,
      client: createDshClient({
        baseUrl: `http://127.0.0.1:${harness.port}`,
        fetchImpl: (...args) => fetch(...args),
        WebSocketImpl: WebSocket,
      }),
    })
    await gateway.start()
    await sleep(150)
    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap-late',
      toolName: 'shell',
    })
    await sleep(40)
    expect(harness.respondCalls).toHaveLength(0)
    resolveGet({ dshModuleAutoApprove: { s1: true } })
    await sleep(50)
    expect(harness.respondCalls.at(-1)?.result?.value).toMatchObject({
      approvalId: 'ap-late',
      outcome: 'allowed-once',
    })
  })

  it('stays quiet while a cockpit ledger is subscribed, then notifies on disconnect', async () => {
    const port = createTestPort()
    gateway.attachPort(port)
    port.send({ type: 'subscribe-ledger', sessionId: 's1' })
    hostHooks.notified.length = 0

    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap-attached',
      toolName: 'shell',
    })
    await sleep(30)
    expect(hostHooks.notified).toEqual([])
    expect(hostHooks.badge).toHaveBeenLastCalledWith(1)

    port.disconnect()
    expect(hostHooks.notified.at(-1)).toMatchObject({ sessionId: 's1', kind: 'approval' })
  })

  it('notifies again after the cockpit unsubscribes without disconnecting', async () => {
    const port = createTestPort()
    gateway.attachPort(port)
    port.send({ type: 'subscribe-ledger', sessionId: 's1' })
    hostHooks.notified.length = 0

    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap-unsub',
      toolName: 'shell',
    })
    await sleep(30)
    expect(hostHooks.notified).toEqual([])

    port.send({ type: 'unsubscribe-ledger', sessionId: 's1' })
    expect(hostHooks.notified.at(-1)).toMatchObject({ sessionId: 's1', kind: 'approval' })
  })

  it('treats an in-process ledger watcher as attached, then notifies on unwatch', async () => {
    const unwatch = gateway.watchLedger('s1', () => {})
    hostHooks.notified.length = 0

    harness.broadcast({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'ap-watch',
      toolName: 'shell',
    })
    await sleep(30)
    expect(hostHooks.notified).toEqual([])
    expect(hostHooks.badge).toHaveBeenLastCalledWith(1)

    unwatch()
    expect(hostHooks.notified.at(-1)).toMatchObject({ sessionId: 's1', kind: 'approval' })
  })

  it('adopts a forked session so the cockpit can switch to it immediately', async () => {
    const port = createTestPort()
    gateway.attachPort(port)
    const res = await portRequest(port, 'session.fork', { sessionId: 's1' })
    expect(res.ok).toBe(true)
    expect(res.value.sessionId).toBe('forked')
    expect(gateway.getSessionSummaries().map((s) => s.sessionId)).toEqual(
      expect.arrayContaining(['s1', 'forked']),
    )
  })
})

describe('dsh gateway workspace / preset / settings RPCs', () => {
  let gateway
  let harness

  afterEach(async () => {
    gateway?.stop()
    gateway = null
    await harness?.stop()
    harness = null
  })

  it('forwards workspaceId and agentPreset on session.create', async () => {
    const started = await startGateway()
    gateway = started.gateway
    harness = started.harness
    const value = await gateway.rpc('session.create', {
      workspaceId: 'w1',
      agentPreset: 'standard',
    })
    expect(harness.lastCreate.workspaceId).toBe('w1')
    expect(harness.lastCreate.agentPreset).toBe('standard')
    expect(harness.lastCreate.sessionId).toBe(value.sessionId)
  })

  it('forwards session.queue-replace as session.updateQueue replace', async () => {
    const started = await startGateway()
    gateway = started.gateway
    harness = started.harness
    const content = [{ type: 'text', text: 'edited' }]
    await gateway.rpc('session.queue-replace', {
      sessionId: 's1',
      itemId: 'q1',
      content,
    })
    expect(harness.lastUpdateQueue).toEqual({
      sessionId: 's1',
      itemId: 'q1',
      action: { kind: 'replace', content },
    })
  })

  it('marks queueItems textOnly only for a single text block', async () => {
    const started = await startGateway()
    gateway = started.gateway
    harness = started.harness
    harness.broadcast({
      type: 'session/queue',
      sessionId: 's1',
      items: [
        {
          id: 'q-text',
          placement: 'queued',
          message: { content: [{ type: 'text', text: 'only text' }] },
        },
        {
          id: 'q-multi',
          placement: 'queued',
          message: {
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        },
        {
          id: 'q-image',
          placement: 'queued',
          message: {
            content: [
              { type: 'text', text: 'caption' },
              { type: 'image', mimeType: 'image/png', data: 'abc' },
            ],
          },
        },
      ],
    })
    await sleep(30)
    const items = gateway.getSessionSummaries()[0].queueItems
    expect(items.find((item) => item.id === 'q-text')).toMatchObject({
      text: 'only text',
      textOnly: true,
    })
    expect(items.find((item) => item.id === 'q-multi')).toMatchObject({
      text: 'a b',
      textOnly: false,
    })
    expect(items.find((item) => item.id === 'q-image')).toMatchObject({
      text: 'caption',
      textOnly: false,
    })
  })

  it('passes privileged workspace.create through', async () => {
    const started = await startGateway()
    gateway = started.gateway
    harness = started.harness
    await gateway.rpc('workspace.create', { path: '/tmp/proj' })
    expect(harness.lastWorkspaceCreate).toEqual({ path: '/tmp/proj' })
  })

  it('still rejects unknown methods', async () => {
    const started = await startGateway()
    gateway = started.gateway
    harness = started.harness
    await expect(gateway.rpc('settings.not-a-method', {})).rejects.toThrow(/unknown method/)
  })
})

describe('dsh gateway connect failure', () => {
  it('closes mux if the host stream fails to open', async () => {
    let muxClosed = false
    const gateway = createDshGateway({
      endpoint: 'http://127.0.0.1:1',
      storage: { local: { get: async () => ({}), set: async () => {} } },
      timers: {
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
      },
      client: {
        rpc: async () => ({}),
        respond: async () => ({}),
        openMux: async () => ({
          close: () => {
            muxClosed = true
          },
        }),
        openHost: async () => {
          throw new Error('host down')
        },
      },
    })
    await gateway.start()
    expect(muxClosed).toBe(true)
    expect(gateway.getState().status).toBe('offline')
    gateway.stop()
  })

  it('does not stay online with a leaked host stream if mux dies during openHost', async () => {
    let hostClosed = false
    let muxOnClose
    const gateway = createDshGateway({
      endpoint: 'http://127.0.0.1:1',
      storage: { local: { get: async () => ({}), set: async () => {} } },
      timers: {
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
      },
      client: {
        rpc: async () => ({}),
        respond: async () => ({}),
        openMux: async ({ onClose }) => {
          muxOnClose = onClose
          return { close: () => {} }
        },
        openHost: async () => {
          muxOnClose?.()
          await new Promise((resolve) => setTimeout(resolve, 20))
          return {
            close: () => {
              hostClosed = true
            },
          }
        },
      },
    })
    await gateway.start()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(gateway.getState().status).not.toBe('online')
    expect(hostClosed).toBe(true)
    gateway.stop()
  })

  it('runs gateway.diagnoseFull through the downlink probe, not a direct socket', async () => {
    const probe = vi.fn(async () => ({ ok: true, detail: '' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'server-response',
          result: { ok: true, value: { version: '0.1.0-rc.6' } },
        }),
      })),
    )
    const gateway = createDshGateway({
      endpoint: 'http://127.0.0.1:3080',
      storage: { local: { get: async () => ({}), set: async () => {} } },
      timers: {
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
      },
      client: {
        rpc: async () => ({}),
        respond: async () => ({}),
        openMux: async () => ({ close: () => {} }),
        openHost: async () => ({ close: () => {} }),
      },
      downlink: {
        openMux: async () => ({ close: () => {} }),
        openHost: async () => ({ close: () => {} }),
        probe,
      },
    })
    await gateway.start()
    const result = await gateway.rpc('gateway.diagnoseFull')
    expect(probe).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, wsOk: true, stage: 'done' })
    gateway.stop()
    vi.unstubAllGlobals()
  })
})
