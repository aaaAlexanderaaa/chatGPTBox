import { describe, expect, it, vi } from 'vitest'
import {
  createGeminiWebService,
  GEMINI_WEB_RUNTIME_KEY,
} from '../src/background/gemini-web-service.mjs'
import { GEMINI_WEB_SELECTION } from '../src/config/gemini-web.mjs'
import { createPortRunGuard } from '../src/services/wrappers.mjs'

function event() {
  const listeners = new Set()
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (data) => {
      for (const fn of [...listeners]) fn(data)
    },
  }
}
function port() {
  return {
    messages: [],
    onMessage: event(),
    onDisconnect: event(),
    postMessage(packet) {
      this.messages.push(structuredClone(packet))
    },
  }
}
const pendingHolds = (state) =>
  state?.version === 2 ? Object.values(state.holds) : state?.hold ? [state.hold] : []
const firstHold = (f) => pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY])[0] || null
function setHold(f, hold) {
  const state = f.stored[GEMINI_WEB_RUNTIME_KEY]
  if (state.version === 2) state.holds = { [hold.requestId]: hold }
  else state.hold = hold
}
function setup(overrides = {}) {
  const stored = {},
    calls = [],
    tabs = new Map()
  stored[GEMINI_WEB_RUNTIME_KEY] = {
    tabs: [],
    hold: null,
    accountSalt: 'fixture-salt',
    accountFingerprint: 'a'.repeat(64),
  }
  let sequence = 0,
    tabSequence = 0,
    clock = 0
  const config = { geminiWebEnabled: true, geminiWebReady: true }
  const browser = {
    storage: {
      local: {
        async get(key) {
          return stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) }
        },
        async set(patch) {
          await overrides.onSave?.(patch)
          if (overrides.failStorage?.(patch)) throw new Error('storage unavailable')
          Object.assign(stored, structuredClone(patch))
        },
      },
    },
    tabs: {
      async create({ url, active }) {
        while (tabs.has(++tabSequence)) {
          /* retain unique browser tab identities */
        }
        const tab = { id: tabSequence, url, active, status: 'complete' }
        tabs.set(tab.id, tab)
        return tab
      },
      async get(id) {
        await overrides.onTabGet?.(id)
        if (!tabs.has(id)) throw new Error('closed')
        return tabs.get(id)
      },
      async query() {
        return [...tabs.values()]
      },
      async update(id, patch) {
        Object.assign(tabs.get(id), patch)
        return tabs.get(id)
      },
      async remove(id) {
        tabs.delete(id)
      },
    },
    scripting: {
      async executeScript(call) {
        const op = call.args[0].action
        calls.push({
          op,
          target: structuredClone(call.target),
          held: pendingHolds(stored[GEMINI_WEB_RUNTIME_KEY]).length > 0,
        })
        let result
        if (overrides.operation) result = await overrides.operation(op, call)
        if (result === undefined) {
          if (op === 'send' || op === 'observe')
            result = {
              ok: true,
              accepted: true,
              nativeId: 'native-turn',
              conversationId: 'c_native',
              url: 'https://gemini.google.com/app/native',
              answer: '<p>Verified answer</p>',
              completed: op === 'observe',
            }
          else if (op === 'inspect') result = { ok: true, ready: true }
          else result = { ok: true }
        }
        return [
          {
            frameId: 0,
            ...(overrides.noDocumentId
              ? {}
              : { documentId: overrides.documentId?.(op, call) || 'document-1' }),
            result,
          },
        ]
      },
    },
  }
  const deps = {
    browser,
    now: () => clock,
    uuid: () => `id-${++sequence}`,
    getConfig: async () => config,
    setConfig: async (patch) => Object.assign(config, patch),
    delay: async (ms) => {
      clock += ms
      await overrides.onDelay?.(ms)
    },
    timeoutMs: overrides.timeoutMs,
    ...(overrides.resolveAutomatic ? { resolveAutomatic: overrides.resolveAutomatic } : {}),
  }
  const session = {
    sessionId: 'local',
    remoteBindingGeneration: 'generation',
    modelName: GEMINI_WEB_SELECTION,
    question: 'Explain a careful migration with recovery conditions.',
    conversationRecords: [],
  }
  const service = createGeminiWebService(deps)
  return { service, deps, session, stored, calls, tabs, config }
}

describe('Gemini background submission owner', () => {
  it('does not hold the submission gate while a dispatched writer awaits its browser reply', async () => {
    let entered, release
    const started = new Promise((resolve) => {
      entered = resolve
    })
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const f = setup({
      async operation(op, call) {
        if (op === 'send' && call.target.tabId === 1) {
          entered()
          await gate
        }
      },
    })
    const a = f.service.run({
      session: { ...structuredClone(f.session), sessionId: 'slow-writer' },
      port: port(),
    })
    await started
    const b = port()
    const runningB = f.service.run({
      session: { ...structuredClone(f.session), sessionId: 'independent-peer' },
      port: b,
    })
    try {
      await vi.waitFor(() => expect(b.messages.at(-1)).toMatchObject({ outcome: 'completed' }))
      expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(2)
    } finally {
      release()
      await Promise.all([a, runningB])
    }
  })

  it('keeps Stop local to one request while two peer requests complete', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const f = setup({
      async operation(op, call) {
        if (!['send', 'observe'].includes(op)) return
        if (op === 'observe') await gate
        const id = call.target.tabId
        return {
          ok: true,
          accepted: true,
          nativeId: `native-${id}`,
          serverTurnId: `server-${id}`,
          responseId: `response-${id}`,
          conversationId: `c_native000${id}`,
          answer: `<p>Answer ${id}</p>`,
          completed: op === 'observe',
        }
      },
    })
    const ports = [port(), port(), port()]
    const running = ports.map((p, index) =>
      f.service.run({
        session: {
          ...structuredClone(f.session),
          sessionId: `peer-${index}`,
          messageId: `peer-run-${index}`,
        },
        port: p,
      }),
    )
    try {
      await vi.waitFor(() => expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(3))
      ports[0].onMessage.emit({ stop: true })
    } finally {
      release()
      await Promise.all(running)
    }
    expect(ports.map((p) => p.messages.at(-1).outcome)).toEqual([
      'stopped',
      'completed',
      'completed',
    ])
    expect(f.calls.filter((call) => call.op === 'stop').map((call) => call.target.tabId)).toEqual([
      1,
    ])
    expect(pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY]).map((hold) => hold.runId)).toEqual([
      'peer-run-0',
    ])
  })

  it.each([
    'foreground',
    'draft',
    'changed-head',
    'changed-response',
    'changed-document',
    'missing-response',
  ])('does not reclaim a completed writer with %s', async (blockedBy) => {
    let completed = false
    const f = setup({
      documentId: () =>
        completed && blockedBy === 'changed-document' ? 'changed-document' : 'document-1',
      operation(op, call) {
        const id = call.target.tabId
        if (op === 'inspect') {
          const entry = f.stored[GEMINI_WEB_RUNTIME_KEY].tabs.find((item) => item.tabId === id)
          return {
            ok: true,
            ready: true,
            busy: false,
            draft: completed && blockedBy === 'draft',
            conversationId: entry?.conversationId || '',
            serverHead:
              completed && blockedBy === 'changed-head'
                ? 'another-head'
                : entry?.serverTurnId || null,
            responseHead:
              completed && blockedBy === 'changed-response'
                ? 'another-response'
                : entry?.responseId || null,
            turnCount: entry?.completed ? 1 : 0,
          }
        }
        if (['send', 'observe'].includes(op))
          return {
            ok: true,
            accepted: true,
            nativeId: `native-${id}`,
            serverTurnId: `server-${id}`,
            responseId: blockedBy === 'missing-response' ? null : `response-${id}`,
            conversationId: `c_native000${id}`,
            answer: '<p>Complete</p>',
            completed: true,
          }
      },
    })
    for (const id of [1, 2, 3])
      await f.service.run({
        session: { ...structuredClone(f.session), sessionId: `writer-${id}` },
        port: port(),
      })
    completed = true
    if (blockedBy === 'foreground') for (const tab of f.tabs.values()) tab.active = true
    const next = port()
    await f.service.run({
      session: { ...structuredClone(f.session), sessionId: 'new-independent' },
      port: next,
    })
    expect(next.messages.at(-1)).toMatchObject({
      dispatched: false,
      error: expect.stringContaining('Close a finished'),
    })
    expect(f.tabs.size).toBe(3)
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(3)
  })

  it('checks the original protected common run even if its native hold is missing', async () => {
    const f = setup({
      timeoutMs: 0,
      operation(op) {
        if (op === 'review')
          return {
            ok: false,
            code: 'GEMINI_CHECK_REQUIRED',
            message: 'Original native request remains active',
          }
      },
    })
    f.session.messageId = 'original-run'
    await f.service.run({ session: f.session, port: port() })
    f.stored[GEMINI_WEB_RUNTIME_KEY].holds = {}
    await expect(
      f.service.review({
        protectedRuns: [{ runId: 'original-run', nativeRef: { session: f.session } }],
      }),
    ).rejects.toThrow('Original native request remains active')
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
  })

  it('keeps one unknown slot while two writers and history work, then admits new work after only one finishes', async () => {
    const releases = new Map()
    const gates = new Map(
      [2, 3].map((id) => [id, new Promise((resolve) => releases.set(id, resolve))]),
    )
    const f = setup({
      async operation(op, call) {
        const id = call.target.tabId
        if (op === 'inspect') {
          const entry = f.stored[GEMINI_WEB_RUNTIME_KEY].tabs.find((item) => item.tabId === id)
          return {
            ok: true,
            ready: true,
            busy: false,
            draft: false,
            conversationId: entry?.conversationId || '',
            serverHead: entry?.serverTurnId || null,
            responseHead: entry?.responseId || null,
            turnCount: entry?.conversationId ? 1 : 0,
          }
        }
        if (op === 'history.list') return { ok: true, items: [], nextCursor: null }
        if (!['send', 'observe'].includes(op)) return
        if (op === 'observe' && id === 1) throw new Error('Lost original observation')
        if (op === 'observe' && gates.has(id)) await gates.get(id)
        return {
          ok: true,
          accepted: true,
          nativeId: `native-${id}`,
          serverTurnId: `server-${id}`,
          responseId: `response-${id}`,
          conversationId: `c_native000${id}`,
          answer: `<p>Answer ${id}</p>`,
          completed: op === 'observe',
        }
      },
    })
    const sessions = [1, 2, 3, 4].map((id) => ({
      ...structuredClone(f.session),
      sessionId: `independent-${id}`,
      messageId: `run-${id}`,
    }))
    const ports = sessions.map(() => port())
    await f.service.run({ session: sessions[0], port: ports[0] })
    const original = structuredClone(firstHold(f))
    const running = sessions
      .slice(1, 3)
      .map((session, index) => f.service.run({ session, port: ports[index + 1] }))
    try {
      await vi.waitFor(() => expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(3))
      await f.service.run({ session: sessions[3], port: ports[3] })
      expect(ports[3].messages.at(-1)).toMatchObject({ dispatched: false })
      await f.service.listConversations()
      const readTabId = f.stored[GEMINI_WEB_RUNTIME_KEY].readTab.tabId
      expect(
        f.calls
          .filter((call) => call.op === 'history.list')
          .every((call) => call.target.tabId === readTabId),
      ).toBe(true)
      expect(pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY])).toHaveLength(3)
      releases.get(2)()
      await running[0]
      await f.service.run({
        session: { ...sessions[3], messageId: 'new-run-after-unsent' },
        port: port(),
      })
      expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(4)
      expect(f.stored[GEMINI_WEB_RUNTIME_KEY].holds[original.requestId]).toEqual(original)
      expect(pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY])).toHaveLength(2)
      expect(f.tabs.has(1)).toBe(true)
      expect(f.tabs.has(2)).toBe(false)
      expect(f.tabs.has(3)).toBe(true)
      expect(f.tabs.has(readTabId)).toBe(true)
    } finally {
      for (const release of releases.values()) release()
      await Promise.all(running)
    }
    expect(pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY])).toEqual([original])
  })

  it('migrates an old native hold as one slot and preserves the rollback fence and original identity', async () => {
    const f = setup()
    const entry = {
      tabId: 1,
      ownerId: 'legacy-owner',
      binding: 'legacy-binding',
      documentId: 'legacy-document',
      accountSalt: 'fixture-salt',
      accountFingerprint: 'a'.repeat(64),
    }
    f.stored[GEMINI_WEB_RUNTIME_KEY].tabs.push(entry)
    const old = {
      requestId: 'legacy-request',
      tabId: 1,
      ownerId: entry.ownerId,
      documentId: entry.documentId,
      conversationId: 'c_legacy000',
      phase: 'possibly-sent',
      at: 1,
    }
    f.stored[GEMINI_WEB_RUNTIME_KEY].hold = old
    f.tabs.set(1, {
      id: 1,
      url: 'https://gemini.google.com/app#chatgptbox-gemini-legacy-owner',
      active: false,
      status: 'complete',
    })
    await f.service.run({ session: f.session, port: port() })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(f.calls.find((call) => call.op === 'send').target.tabId).not.toBe(1)
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY]).toMatchObject({
      version: 2,
      hold: true,
      holds: { 'legacy-request': { ...old, binding: entry.binding } },
    })
    expect(await createGeminiWebService(f.deps).reservations()).toEqual([
      { ...old, binding: entry.binding },
    ])
  })

  it('keeps an account-wide pause across restart when one document reports a challenge', async () => {
    const f = setup({
      operation(op) {
        if (op === 'send')
          return {
            ok: false,
            code: 'GEMINI_CHECK_REQUIRED',
            message: 'Native account challenge',
            accountBlocked: true,
            dispatched: false,
          }
      },
    })
    await f.service.run({ session: f.session, port: port() })
    const blocked = port()
    await createGeminiWebService(f.deps).run({
      session: { ...f.session, sessionId: 'another-account-task', geminiWebTabId: undefined },
      port: blocked,
    })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].accountPause).toMatchObject({
      code: 'GEMINI_CHECK_REQUIRED',
    })
    expect(blocked.messages.at(-1)).toMatchObject({
      dispatched: false,
      error: 'Native account challenge',
    })
    expect(f.config.geminiWebReady).toBe(false)
  })

  it('persists a newly observed account pause even when Stop wins before result handling', async () => {
    const p = port()
    const f = setup({
      operation(op) {
        if (op === 'send') {
          p.onMessage.emit({ stop: true })
          return {
            ok: false,
            accountBlocked: true,
            code: 'GEMINI_CHECK_REQUIRED',
            message: 'Notice raced with Stop',
          }
        }
      },
    })
    await f.service.run({ session: f.session, port: p })
    expect(p.messages.at(-1)).toMatchObject({ outcome: 'stopped' })
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].accountPause.message).toBe('Notice raced with Stop')
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
  })

  it('prevents Send when a peer observes an account pause while tabs.get is still awaiting', async () => {
    let preparedB = false,
      waitingB = false,
      enteredB,
      releaseB
    const entered = new Promise((resolve) => {
      enteredB = resolve
    })
    const gate = new Promise((resolve) => {
      releaseB = resolve
    })
    const f = setup({
      async onTabGet(id) {
        if (id === 2 && preparedB && !waitingB) {
          waitingB = true
          enteredB()
          await gate
        }
      },
      async operation(op, call) {
        if (op === 'prepare' && call.target.tabId === 2) preparedB = true
        if (op === 'observe' && call.target.tabId === 1) {
          await entered
          return {
            ok: false,
            code: 'GEMINI_CHECK_REQUIRED',
            accountBlocked: true,
            message: 'Peer account notice',
          }
        }
      },
    })
    const a = port(),
      b = port()
    const running = [
      f.service.run({ session: { ...structuredClone(f.session), sessionId: 'A' }, port: a }),
      f.service.run({ session: { ...structuredClone(f.session), sessionId: 'B' }, port: b }),
    ]
    try {
      await entered
      // Let the already-returning peer notice publish its synchronous fence
      // while B remains inside the browser API, before MAIN dispatch.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      releaseB()
      await Promise.all(running)
    }
    expect(f.calls.filter((call) => call.op === 'send').map((call) => call.target.tabId)).toEqual([
      1,
    ])
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].accountPause.message).toBe('Peer account notice')
    expect(b.messages.at(-1)).toMatchObject({ error: 'Peer account notice' })
    expect(pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY])).toHaveLength(2)
  })

  it('recovers an exact old response beside two writers and makes its completed writer available for new work', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const f = setup({
      async operation(op, call) {
        const id = call.target.tabId
        if (op === 'inspect') {
          const sent = f.calls.some((row) => row.op === 'send' && row.target.tabId === id)
          return {
            ok: true,
            ready: true,
            busy: false,
            draft: false,
            conversationId: sent ? `c_native000${id}` : '',
            serverHead: sent ? `server-${id}` : null,
            responseHead: sent ? `response-${id}` : null,
            turnCount: sent ? 1 : 0,
          }
        }
        if (op === 'history.read')
          return {
            ok: true,
            messages: [
              {
                role: 'assistant',
                nativeTurnId: 'server-1',
                nativeResponseId: 'response-1',
                content: '<p>Exact recovered answer</p>',
                completed: true,
              },
            ],
            nextCursor: null,
          }
        if (!['send', 'observe'].includes(op)) return
        if (op === 'observe' && id === 1) throw new Error('Original stream lost')
        if (op === 'observe' && id <= 3) await gate
        return {
          ok: true,
          accepted: true,
          nativeId: `native-${id}`,
          serverTurnId: `server-${id}`,
          responseId: `response-${id}`,
          conversationId: `c_native000${id}`,
          answer: `<p>Answer ${id}</p>`,
          completed: op === 'observe',
        }
      },
    })
    const old = { ...structuredClone(f.session), messageId: 'old-run' }
    const next = {
      ...structuredClone(f.session),
      sessionId: 'another-writer',
      messageId: 'new-run',
    }
    await f.service.run({ session: old, port: port() })
    const running = f.service.run({ session: next, port: port() })
    const third = f.service.run({
      session: { ...structuredClone(f.session), sessionId: 'third-writer', messageId: 'third-run' },
      port: port(),
    })
    try {
      await vi.waitFor(() => expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(3))
      expect(await f.service.recover({ session: old }, { runId: 'old-run' })).toMatchObject({
        outcome: 'completed',
        finalOutput: { content: '<p>Exact recovered answer</p>' },
      })
      expect(pendingHolds(f.stored[GEMINI_WEB_RUNTIME_KEY]).map((hold) => hold.runId)).toEqual([
        'new-run',
        'third-run',
      ])
      expect(
        f.stored[GEMINI_WEB_RUNTIME_KEY].tabs.find((entry) => entry.tabId === 1).completed,
      ).toBe(true)
      await f.service.run({
        session: {
          ...structuredClone(f.session),
          sessionId: 'fourth-writer',
          messageId: 'fourth-run',
        },
        port: port(),
      })
      expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(4)
      expect(f.tabs.has(1)).toBe(false)
    } finally {
      release()
      await Promise.all([running, third])
    }
  })

  it('runs three independent native writers simultaneously and refuses a fourth before preparation', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const f = setup({
      async operation(op, call) {
        if (!['send', 'observe'].includes(op)) return
        if (op === 'observe') await gate
        const id = call.target.tabId
        return {
          ok: true,
          accepted: true,
          nativeId: `native-${id}`,
          serverTurnId: `server-${id}`,
          responseId: `response-${id}`,
          conversationId: `c_native000${id}`,
          answer: `<p>Answer ${id}</p>`,
          completed: op === 'observe',
        }
      },
    })
    const sessions = [1, 2, 3, 4].map((id) => ({
      ...structuredClone(f.session),
      sessionId: `independent-${id}`,
      messageId: `run-${id}`,
    }))
    const ports = sessions.map(() => port())
    const running = sessions
      .slice(0, 3)
      .map((session, index) => f.service.run({ session, port: ports[index] }))
    try {
      await vi.waitFor(() => expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(3))
      expect(
        new Set(f.calls.filter((call) => call.op === 'send').map((call) => call.target.tabId)).size,
      ).toBe(3)
      await f.service.run({ session: sessions[3], port: ports[3] })
      expect(ports[3].messages.at(-1)).toMatchObject({ dispatched: false, outcome: 'failed' })
      expect(f.calls.filter((call) => call.op === 'prepare')).toHaveLength(3)
      expect(Object.keys(f.stored[GEMINI_WEB_RUNTIME_KEY].holds)).toHaveLength(3)
    } finally {
      release()
      await Promise.all(running)
    }
    expect(ports.slice(0, 3).map((p) => p.messages.at(-1).outcome)).toEqual([
      'completed',
      'completed',
      'completed',
    ])
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].holds).toEqual({})
  })

  it('resolves an unattempted runtime preflight in the pinned document before one journaled Send', async () => {
    let inspected = 0
    const resolverCalls = []
    const f = setup({
      resolveAutomatic: async (inventory) => {
        resolverCalls.push(inventory)
        return { version: 'automatic', automaticProof: { nonce: 'proof' } }
      },
      operation: async (op, call) => {
        if (op === 'inspect-public-compilation') {
          inspected++
          return { ok: true, nonce: 'proof' }
        }
        if (
          op === 'configure' &&
          !call.args[0].contracts.some((contract) => contract.automaticProof)
        )
          return {
            ok: false,
            code: 'GEMINI_RUNTIME_UNSUPPORTED',
            discoveryNeeded: true,
            dispatched: false,
          }
      },
    })
    const result = port()
    await f.service.run({ session: f.session, port: result })
    expect(inspected).toBe(1)
    expect(resolverCalls).toHaveLength(1)
    expect(f.calls.find((call) => call.op === 'inspect-public-compilation')).toMatchObject({
      target: { documentIds: ['document-1'] },
      held: false,
    })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(result.messages.at(-1)).toMatchObject({ outcome: 'completed' })
  })

  it('does not dispatch when code equivalence cannot be confirmed', async () => {
    const f = setup({
      resolveAutomatic: async () => null,
      operation: async (op) =>
        op === 'configure'
          ? {
              ok: false,
              code: 'GEMINI_RUNTIME_UNSUPPORTED',
              discoveryNeeded: true,
              dispatched: false,
            }
          : op === 'inspect-public-compilation'
          ? { ok: true }
          : undefined,
    })
    const result = port()
    await f.service.run({ session: f.session, port: result })
    expect(f.calls.some((call) => ['prepare', 'send'].includes(call.op))).toBe(false)
    expect(firstHold(f)).toBeNull()
    expect(result.messages.at(-1)).toMatchObject({ dispatched: false, outcome: 'failed' })
  })

  it('refuses a document change during discovery without invoking or rediscovering a Send', async () => {
    let resolutions = 0
    const f = setup({
      resolveAutomatic: async () => {
        resolutions++
        return {}
      },
      documentId: (op) => (op === 'inspect-public-compilation' ? 'other-document' : 'document-1'),
      operation: async (op) =>
        op === 'configure'
          ? {
              ok: false,
              code: 'GEMINI_RUNTIME_UNSUPPORTED',
              discoveryNeeded: true,
              dispatched: false,
            }
          : undefined,
    })
    const result = port()
    await f.service.run({ session: f.session, port: result })
    expect(resolutions).toBe(0)
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(0)
  })

  it('never discovers a replacement runtime after native invocation has become uncertain', async () => {
    let resolutions = 0
    const f = setup({
      resolveAutomatic: async () => {
        resolutions++
        return {}
      },
      operation: async (op) =>
        op === 'send'
          ? { ok: false, code: 'GEMINI_RUNTIME_UNSUPPORTED', discoveryNeeded: true }
          : undefined,
    })
    const result = port()
    await f.service.run({ session: f.session, port: result })
    expect(resolutions).toBe(0)
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(firstHold(f)).not.toBeNull()
  })

  it('reuses a verified empty owned page after a local pre-submission refusal, without navigating or replaying the old request', async () => {
    let ready = false
    const f = setup({
      operation: async (op) =>
        op === 'inspect'
          ? ready
            ? { ok: true, ready: true, busy: false, draft: false, conversationId: '', turnCount: 0 }
            : { ok: false, message: 'Local runtime not yet adapted', dispatched: false }
          : undefined,
    })
    const failed = port()
    await f.service.run({ session: f.session, port: failed })
    expect(failed.messages.at(-1)).toMatchObject({ dispatched: false })
    expect(f.calls.some((call) => call.op === 'send')).toBe(false)
    const firstTab = [...f.tabs.values()][0]
    ready = true
    const next = {
      sessionId: 'new-explicit-request',
      remoteBindingGeneration: 'new-generation',
      modelName: GEMINI_WEB_SELECTION,
      question: 'A deliberate independent question',
      conversationRecords: [],
    }
    const result = port()
    await f.service.run({ session: next, port: result })
    expect(f.tabs.size).toBe(1)
    expect(next.geminiWebTabId).toBe(firstTab.id)
    expect(f.tabs.get(firstTab.id).url).toBe(firstTab.url)
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(result.messages.at(-1)).toMatchObject({ outcome: 'completed' })
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].tabs[0].binding).toBe(
      'new-explicit-request:new-generation',
    )
  })
  it.each([
    { draft: true, turnCount: 0 },
    { draft: false, turnCount: 1 },
  ])(
    'preserves an existing owned page with %j instead of claiming it for another request',
    async (status) => {
      const f = setup({
        operation: async (op, call) =>
          op === 'inspect' && call.target.tabId === 10
            ? { ok: true, ready: false, busy: false, conversationId: '', ...status }
            : undefined,
      })
      f.tabs.set(10, {
        id: 10,
        status: 'complete',
        url: 'https://gemini.google.com/app#chatgptbox-gemini-original-owner',
      })
      f.stored[GEMINI_WEB_RUNTIME_KEY].tabs.push({
        tabId: 10,
        ownerId: 'original-owner',
        binding: 'original-binding',
        accountSalt: 'fixture-salt',
        accountFingerprint: 'a'.repeat(64),
      })
      await f.service.run({ session: f.session, port: port() })
      expect(f.tabs.size).toBe(2)
      expect(f.stored[GEMINI_WEB_RUNTIME_KEY].tabs.find((t) => t.tabId === 10).binding).toBe(
        'original-binding',
      )
      expect(f.calls.filter((c) => c.op === 'send').every((c) => c.target.tabId !== 10)).toBe(true)
    },
  )
  it('never recovers a new append from its inherited parent head or a previous run proof', async () => {
    let writes = 0
    const f = setup({
      operation: async (op) => {
        if (op === 'inspect')
          return { ok: true, ready: true, conversationId: 'c_abcdefgh', serverHead: 'server-A' }
        if (op === 'send' && ++writes === 2)
          return {
            ok: false,
            message: 'Lost the new native response before an output identity was recorded',
          }
        if (op === 'send' || op === 'observe')
          return {
            ok: true,
            accepted: true,
            nativeId: 'native-A',
            conversationId: 'c_abcdefgh',
            serverTurnId: 'server-A',
            responseId: 'response-A',
            responseTimestamp: '2026-11-14T10:20:30.123Z',
            answer: '<p>Answer A</p>',
            completed: op === 'observe',
          }
        if (op === 'history.read')
          return {
            ok: true,
            messages: [
              {
                role: 'assistant',
                nativeTurnId: 'server-A',
                nativeResponseId: 'response-A',
                completed: true,
                content: '<p>Answer A</p>',
              },
            ],
          }
      },
    })
    f.session.messageId = 'run-A'
    await f.service.run({ session: f.session, port: port() })
    const original = structuredClone(f.session)
    expect(original.geminiWebResponseTimestamp).toBe('2026-11-14T10:20:30.123Z')
    expect(original.geminiWebOutputIdentity).toMatchObject({
      runId: 'run-A',
      serverTurnId: 'server-A',
    })
    f.session.messageId = 'run-B'
    f.session.question = 'Question B'
    await f.service.run({ session: f.session, port: port() })
    expect(writes).toBe(2)
    expect(f.session.geminiWebServerTurnId).toBe('server-A')
    expect(f.session.geminiWebOutputIdentity).toBeUndefined()
    expect(f.session.geminiWebResponseTimestamp).toBeUndefined()
    const restored = createGeminiWebService(f.deps)
    expect(await restored.recover(f.session, { runId: 'run-B' })).toEqual({ outcome: 'unknown' })
    // This also covers a common-run crash before its new reference was saved.
    expect(await restored.recover(original, { runId: 'run-B' })).toEqual({ outcome: 'unknown' })
    expect(f.calls.filter((call) => call.op === 'history.read')).toHaveLength(0)
    expect(firstHold(f)).not.toBeNull()
  })
  it('reports an unsupported history adapter as an unsent operation error', async () => {
    const f = setup({
      operation: async () => ({
        ok: false,
        code: 'GEMINI_HISTORY_UNSUPPORTED',
        message: 'No verified history adapter',
      }),
    })
    await expect(f.service.listConversations()).rejects.toMatchObject({
      code: 'OPERATION_NOT_IMPLEMENTED',
      status: 422,
      submission: 'not_attempted',
    })
    expect(f.calls.map((call) => call.op)).toEqual(['history.list'])
  })
  it('reopens a closed writer at its original native conversation instead of starting another conversation', async () => {
    let writes = 0
    const f = setup({
      operation: async (op) => {
        if (op === 'inspect')
          return {
            ok: true,
            ready: true,
            conversationId: writes ? 'c_abcdefgh' : '',
            serverHead: writes ? 'server-' + writes : null,
            clientHead: writes ? 'native-' + writes : null,
          }
        if (op === 'send') writes++
        if (op === 'send' || op === 'observe')
          return {
            ok: true,
            accepted: true,
            nativeId: 'native-' + writes,
            serverTurnId: 'server-' + writes,
            responseId: 'response-' + writes,
            conversationId: 'c_abcdefgh',
            url: 'https://gemini.google.com/app/abcdefgh',
            answer: '<p>Verified</p>',
            completed: op === 'observe',
          }
      },
    })
    await f.service.run({ session: f.session, port: port() })
    expect(writes).toBe(1)
    f.tabs.clear()
    f.session.question = 'Continue in the original conversation'
    const p = port()
    await createGeminiWebService(f.deps).run({ session: f.session, port: p })
    expect(writes).toBe(2)
    expect([...f.tabs.values()][0].url).toContain('/app/abcdefgh#chatgptbox-gemini-')
    expect(p.messages.at(-1)).toMatchObject({ outcome: 'completed' })
    expect(f.session.conversationId).toBe('c_abcdefgh')
  })
  it('reads both pinned and ordinary native history without clearing an existing uncertainty hold', async () => {
    const f = setup({
      operation: async (op, call) => {
        if (op === 'history.list')
          return {
            ok: true,
            items: call.args[0].pinned ? [] : [{ id: 'c_abcdefgh', title: 'Native history' }],
            nextCursor: null,
          }
      },
    })
    setHold(f, { requestId: 'uncertain-old', serverTurnId: 'server-old' })
    const page = await f.service.listConversations()
    expect(page).toMatchObject({
      items: [{ id: 'c_abcdefgh' }],
      source: 'native-history',
      completeness: 'complete',
      total: null,
    })
    expect(f.calls.map((x) => x.op)).toEqual(['history.list', 'history.list'])
    expect(firstHold(f).requestId).toBe('uncertain-old')
  })
  it('recovers only the exact server turn after worker restart, preserving a newer hold and making zero submissions', async () => {
    const f = setup({
      operation: async (op) =>
        op === 'history.read'
          ? {
              ok: true,
              messages: [
                {
                  role: 'assistant',
                  nativeTurnId: 'server-other',
                  nativeResponseId: 'response-old',
                  completed: true,
                  content: 'Wrong same-text answer',
                },
                {
                  role: 'assistant',
                  nativeTurnId: 'server-old',
                  nativeResponseId: 'response-old',
                  completed: true,
                  content: '<p>Exact old answer</p>',
                },
              ],
              nextCursor: null,
            }
          : undefined,
    })
    setHold(f, { requestId: 'newer-request', serverTurnId: 'server-newer' })
    const restored = createGeminiWebService(f.deps)
    const reference = {
      session: {
        conversationId: 'c_abcdefgh',
        geminiWebServerTurnId: 'server-old',
        geminiWebResponseId: 'response-old',
        geminiWebRequestId: 'old-request',
        geminiWebOutputIdentity: {
          requestId: 'old-request',
          runId: 'run-old',
          conversationId: 'c_abcdefgh',
          serverTurnId: 'server-old',
          responseId: 'response-old',
        },
      },
    }
    expect(await restored.recover(reference)).toMatchObject({
      outcome: 'completed',
      finalOutput: { content: '<p>Exact old answer</p>' },
    })
    expect(firstHold(f).requestId).toBe('newer-request')
    expect(f.calls.every((call) => call.op === 'history.read')).toBe(true)
    setHold(f, { requestId: 'old-request', serverTurnId: 'server-old', responseId: 'response-old' })
    expect(await restored.recover(reference)).toMatchObject({ outcome: 'completed' })
    expect(firstHold(f)).toBeNull()
    expect(await restored.recover({ session: { conversationId: 'c_abcdefgh' } })).toEqual({
      outcome: 'unknown',
    })
  })
  it('persists the boundary before native preparation, pins document identity, and completes once', async () => {
    const f = setup(),
      p = port()
    await f.service.run({ session: f.session, port: p })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(f.calls.find((call) => call.op === 'configure').target).toMatchObject({
      documentIds: ['document-1'],
    })
    expect(f.calls.find((call) => call.op === 'prepare').held).toBe(true)
    expect(f.calls.find((call) => call.op === 'send')).toMatchObject({
      held: true,
      target: { documentIds: ['document-1'] },
    })
    expect(p.messages.filter((message) => message.started)).toHaveLength(1)
    expect(p.messages.at(-1)).toMatchObject({
      outcome: 'completed',
      finalContent: '<p>Verified answer</p>',
    })
    expect(firstHold(f)).toBeNull()
    expect(f.session.conversationRecords).toHaveLength(1)
  })

  it('never calls native preparation when durable storage fails', async () => {
    const f = setup({
        failStorage: (patch) => pendingHolds(patch[GEMINI_WEB_RUNTIME_KEY]).length > 0,
      }),
      p = port()
    await f.service.run({ session: f.session, port: p })
    expect(f.calls.some((call) => ['prepare', 'send'].includes(call.op))).toBe(false)
    expect(p.messages.at(-1)).toMatchObject({ dispatched: false, outcome: 'failed' })
  })

  it('rejects a missing document identity without native preparation or a second injection', async () => {
    const f = setup({ noDocumentId: true }),
      p = port()
    await f.service.run({ session: f.session, port: p })
    expect(f.calls.map((call) => call.op)).toEqual(['inspect'])
    expect(p.messages.at(-1).dispatched).toBe(false)
  })

  it('preserves uncertainty across a new worker and does not invoke again after a lost result', async () => {
    const f = setup({
        operation(op) {
          if (op === 'observe') throw new Error('document went away')
        },
      }),
      p = port()
    await f.service.run({ session: f.session, port: p })
    expect(p.messages.at(-1)).toMatchObject({ outcome: 'incomplete' })
    expect(p.messages.at(-1)).not.toHaveProperty('dispatched')
    expect(firstHold(f)).toBeTruthy()
    const second = port()
    await createGeminiWebService(f.deps).run({
      session: { ...f.session, question: 'Another question' },
      port: second,
    })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(second.messages.at(-1)).toMatchObject({ dispatched: false, outcome: 'failed' })
  })

  it('never declares a partial native stream successful at timeout', async () => {
    const f = setup({
        timeoutMs: 0,
        operation(op) {
          if (op === 'send')
            return {
              ok: true,
              accepted: true,
              nativeId: 'native-turn',
              answer: '<p>Partial</p>',
              completed: false,
            }
        },
      }),
      p = port()
    await f.service.run({ session: f.session, port: p })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    expect(p.messages.some((message) => message.finalContent)).toBe(false)
    expect(p.messages.at(-1).outcome).toBe('incomplete')
    expect(f.session.conversationRecords).toEqual([])
    expect(firstHold(f)).toBeTruthy()
  })

  it('stops before submission when Stop arrives during native preparation', async () => {
    const p = port()
    const f = setup({
      onDelay(ms) {
        if (ms === 100) p.onMessage.emit({ stop: true })
      },
    })
    await f.service.run({ session: f.session, port: p })
    expect(f.calls.some((call) => call.op === 'send')).toBe(false)
    expect(p.messages.some((message) => message.started)).toBe(false)
    expect(p.messages.at(-1)).toMatchObject({ outcome: 'stopped', done: true })
    expect(firstHold(f)).toBeTruthy()
  })

  it('attempts one matching native Stop, but a disconnect only detaches observation', async () => {
    for (const kind of ['stop', 'disconnect']) {
      const p = port()
      const f = setup({
        onDelay(ms) {
          if (ms === 1000)
            kind === 'stop' ? p.onMessage.emit({ stop: true }) : p.onDisconnect.emit()
        },
      })
      await f.service.run({ session: f.session, port: p })
      expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
      expect(f.calls.filter((call) => call.op === 'stop')).toHaveLength(kind === 'stop' ? 1 : 0)
      expect(firstHold(f)).toBeTruthy()
    }
  })

  it('rejects a concurrent caller trying to reuse the active writer instead of queuing it', async () => {
    let entered, resume
    const started = new Promise((resolve) => {
      entered = resolve
    })
    const gate = new Promise((resolve) => {
      resume = resolve
    })
    const f = setup({
      async operation(op) {
        if (op === 'prepare') {
          entered()
          await gate
        }
      },
    })
    const first = port(),
      second = port()
    const running = f.service.run({ session: f.session, port: first })
    await started
    await f.service.run({ session: { ...f.session, sessionId: 'other' }, port: second })
    expect(second.messages.at(-1)).toMatchObject({ dispatched: false, outcome: 'failed' })
    resume()
    await running
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
  })

  it('does not inspect, open tabs or send when the provider is disabled', async () => {
    const f = setup(),
      p = port()
    f.config.geminiWebEnabled = false
    await f.service.run({ session: f.session, port: p })
    await expect(f.service.inspect()).rejects.toThrow('disabled')
    expect(f.calls).toEqual([])
    expect(f.tabs.size).toBe(0)
    expect(await f.service.listModels()).toEqual([])
  })

  it('requires explicit review to release a hold and never replays the old request', async () => {
    const f = setup({ timeoutMs: 0 }),
      p = port()
    await f.service.run({ session: f.session, port: p })
    const sends = f.calls.filter((call) => call.op === 'send').length
    await f.service.inspect()
    expect(firstHold(f)).toBeTruthy()
    expect(await f.service.review()).toMatchObject({ hold: false })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(sends)
    expect(firstHold(f)).toBeNull()
  })

  it('requires a first account check and pins its salted identity without exposing it to settings', async () => {
    const f = setup({
        operation(op) {
          if (op === 'inspect') return { ok: true, ready: true, accountFingerprint: 'b'.repeat(64) }
        },
      }),
      p = port()
    delete f.stored[GEMINI_WEB_RUNTIME_KEY]
    await f.service.run({ session: f.session, port: p })
    expect(f.tabs.size).toBe(0)
    expect(p.messages.at(-1)).toMatchObject({ dispatched: false })
    await f.service.open()
    const result = await f.service.inspect()
    expect(result).toMatchObject({ ready: true })
    expect(result).not.toHaveProperty('accountFingerprint')
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].accountFingerprint).toBe('b'.repeat(64))
    expect(f.calls.every((call) => call.op === 'inspect')).toBe(true)
  })

  it('refuses a stale settings check while submission owns the journal', async () => {
    let entered, resume
    const started = new Promise((resolve) => {
      entered = resolve
    })
    const gate = new Promise((resolve) => {
      resume = resolve
    })
    const f = setup({
      async operation(op) {
        if (op === 'prepare') {
          entered()
          await gate
        }
      },
    })
    const running = f.service.run({ session: f.session, port: port() })
    await started
    const inspections = f.calls.filter((call) => call.op === 'inspect').length
    expect(await f.service.inspect()).toMatchObject({ ok: false, active: true })
    expect(firstHold(f)).toBeTruthy()
    expect(f.calls.filter((call) => call.op === 'inspect')).toHaveLength(inspections)
    resume()
    await running
  })

  it('publishes one completion before async journal cleanup so a late Stop cannot publish another terminal result', async () => {
    const p = port()
    const guard = createPortRunGuard(p)
    p.onMessage.addListener((message) => {
      if (message.stop) guard.ackStopWithoutSession(message.requestToken)
    })
    const owned = guard.beginSessionRun('token').port
    const f = setup({
      onSave(patch) {
        if (
          pendingHolds(patch[GEMINI_WEB_RUNTIME_KEY]).length === 0 &&
          f.calls.some((call) => call.op === 'observe')
        )
          p.onMessage.emit({ stop: true, requestToken: 'token' })
      },
    })
    await f.service.run({ session: f.session, port: owned })
    expect(p.messages.filter((packet) => packet.done)).toHaveLength(1)
    expect(p.messages.at(-1).outcome).toBe('completed')
    expect(f.session.conversationRecords).toHaveLength(1)
    expect(f.calls.some((call) => call.op === 'stop')).toBe(false)
  })

  it('lets Stop win while native identity is being saved before a verified completion is published', async () => {
    const p = port()
    const guard = createPortRunGuard(p)
    p.onMessage.addListener((message) => {
      if (message.stop) guard.ackStopWithoutSession(message.requestToken)
    })
    const owned = guard.beginSessionRun('token').port
    const f = setup({
      operation(op) {
        if (op === 'send')
          return { ok: true, accepted: true, nativeId: 'native', answer: 'Final', completed: true }
      },
      onSave(patch) {
        if (pendingHolds(patch[GEMINI_WEB_RUNTIME_KEY]).some((hold) => hold.nativeId))
          p.onMessage.emit({ stop: true, requestToken: 'token' })
      },
    })
    await f.service.run({ session: f.session, port: owned })
    expect(p.messages.filter((packet) => packet.done)).toHaveLength(1)
    expect(p.messages.at(-1).outcome).toBe('stopped')
    expect(f.session.conversationRecords).toEqual([])
    expect(firstHold(f)).toBeTruthy()
  })

  it('keeps a hold when native preparation detects an unexpected website submission', async () => {
    const f = setup({
        operation(op) {
          if (op === 'send') return { ok: false, message: 'Unexpected native submission' }
        },
      }),
      p = port()
    await f.service.run({ session: f.session, port: p })
    expect(p.messages.at(-1)).not.toHaveProperty('dispatched')
    expect(firstHold(f)).toBeTruthy()
  })

  it('uses a read-only check after reload and requires acknowledgement of the unconfirmed old outcome', async () => {
    let reloaded = false
    const f = setup({
      timeoutMs: 0,
      documentId: () => (reloaded ? 'document-2' : 'document-1'),
      operation(op) {
        if (reloaded && op === 'review') throw new Error('old document no longer exists')
      },
    })
    await f.service.run({ session: f.session, port: port() })
    reloaded = true
    expect(await f.service.review()).toMatchObject({
      hold: true,
      needsUnverifiedAcknowledgement: true,
    })
    expect(firstHold(f)).toBeTruthy()
    expect(await f.service.review({ acknowledgeUnverified: true })).toMatchObject({ hold: false })
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY]).toMatchObject({
      tabs: [],
      holds: {},
      lastReviewed: { outcome: 'unconfirmed-user-reviewed' },
    })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
  })

  it.each(['closed', 'navigated'])(
    'does not silently release an interrupted %s tab',
    async (kind) => {
      const f = setup({ timeoutMs: 0 })
      await f.service.run({ session: f.session, port: port() })
      if (kind === 'closed') f.tabs.delete(1)
      else f.tabs.get(1).url = 'https://example.invalid'
      f.tabs.set(2, {
        id: 2,
        url: 'https://gemini.google.com/app',
        active: true,
        status: 'complete',
      })
      expect(await f.service.review()).toMatchObject({
        hold: true,
        needsUnverifiedAcknowledgement: true,
      })
      expect(firstHold(f)).toBeTruthy()
      await f.service.review({ acknowledgeUnverified: true })
      expect(firstHold(f)).toBeNull()
      expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(1)
    },
  )

  it('does not let recovery acknowledgement override an active generation or native challenge', async () => {
    const f = setup({
      timeoutMs: 0,
      operation(op) {
        if (op === 'review')
          return {
            ok: false,
            code: 'GEMINI_CHECK_REQUIRED',
            message: 'Finish the native generation',
          }
      },
    })
    await f.service.run({ session: f.session, port: port() })
    await expect(f.service.review({ acknowledgeUnverified: true })).rejects.toThrow(
      'Finish the native generation',
    )
    expect(firstHold(f)).toBeTruthy()
  })
})
