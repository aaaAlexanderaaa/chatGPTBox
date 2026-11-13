import { describe, expect, it } from 'vitest'
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
        const tab = { id: tabs.size + 1, url, active, status: 'complete' }
        tabs.set(tab.id, tab)
        return tab
      },
      async get(id) {
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
    },
    scripting: {
      async executeScript(call) {
        const op = call.args[0].action
        calls.push({
          op,
          target: structuredClone(call.target),
          held: !!stored[GEMINI_WEB_RUNTIME_KEY]?.hold,
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeNull()
    expect(f.session.conversationRecords).toHaveLength(1)
  })

  it('never calls native preparation when durable storage fails', async () => {
    const f = setup({ failStorage: (patch) => !!patch[GEMINI_WEB_RUNTIME_KEY]?.hold }),
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
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
      expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
    }
  })

  it('rejects a concurrent caller instead of queuing another account operation', async () => {
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
    expect(await f.service.review()).toMatchObject({ hold: false })
    expect(f.calls.filter((call) => call.op === 'send')).toHaveLength(sends)
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeNull()
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
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
          patch[GEMINI_WEB_RUNTIME_KEY]?.hold === null &&
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
        if (patch[GEMINI_WEB_RUNTIME_KEY]?.hold?.nativeId)
          p.onMessage.emit({ stop: true, requestToken: 'token' })
      },
    })
    await f.service.run({ session: f.session, port: owned })
    expect(p.messages.filter((packet) => packet.done)).toHaveLength(1)
    expect(p.messages.at(-1).outcome).toBe('stopped')
    expect(f.session.conversationRecords).toEqual([])
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
    expect(await f.service.review({ acknowledgeUnverified: true })).toMatchObject({ hold: false })
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY]).toMatchObject({
      tabs: [],
      hold: null,
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
      expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
      await f.service.review({ acknowledgeUnverified: true })
      expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeNull()
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
    expect(f.stored[GEMINI_WEB_RUNTIME_KEY].hold).toBeTruthy()
  })
})
