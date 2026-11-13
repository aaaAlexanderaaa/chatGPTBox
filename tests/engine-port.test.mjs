import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../src/config/storage.mjs'
import { createPortRunGuard } from '../src/services/wrappers.mjs'

const state = vi.hoisted(() => ({ writes: 0, cancels: 0, release: null, held: false }))
vi.mock('../src/engines/adapters.mjs', () => {
  const adapter = {
    describe: () => ({
      id: 'fourth',
      label: 'Fourth',
      enabledKey: 'fourthEnabled',
      defaultEnabled: true,
      operations: {
        'generation.start': { implemented: true },
        'conversation.append': { implemented: true },
      },
      execution: { concurrencyScope: 'engine' },
    }),
    resolveModel: () => 'model',
    generate: async (_request, context) => {
      state.writes++
      context.onCancel(() => {
        state.cancels++
        state.release?.()
      })
      const nativeRef = {
        session: { conversationId: 'controlled-native-conversation' },
        head: 'verified-head',
      }
      await context.report({
        type: 'accepted',
        evidence: { kind: 'controlled-response' },
        nativeRef,
      })
      await context.report({
        type: 'preview',
        output: { format: 'markdown', content: 'Preview only' },
      })
      if (state.held)
        await new Promise((resolve) => {
          state.release = resolve
        })
      return {
        outcome: 'completed',
        submission: 'accepted',
        nativeRef,
        finalOutput: { version: 1, format: 'markdown', content: 'Verified final' },
      }
    },
  }
  adapter.append = adapter.generate
  return { createNativeEngineAdapters: () => [adapter], nativeSessionReference: () => null }
})
const caller = { kind: 'extension', principal: 'controlled-ui', admin: true }
function portFixture() {
  const messages = new Set(),
    disconnected = new Set(),
    posts = []
  const port = {
    postMessage: (packet) => posts.push(packet),
    onMessage: {
      addListener: (listener) => messages.add(listener),
      removeListener: (listener) => messages.delete(listener),
    },
    onDisconnect: {
      addListener: (listener) => disconnected.add(listener),
      removeListener: (listener) => disconnected.delete(listener),
    },
  }
  const guard = createPortRunGuard(port)
  messages.add((packet) => {
    if (packet.stop) guard.ackStopWithoutSession(packet.requestToken)
  })
  return {
    posts,
    guard,
    guarded: guard.beginSessionRun('ui-token').port,
    emit: (packet) => {
      for (const listener of [...messages]) listener(packet)
    },
    disconnect: () => {
      guard.dispose()
      for (const listener of [...disconnected]) listener()
    },
  }
}
beforeEach(async () => {
  vi.resetModules()
  const Browser = (await import('webextension-polyfill')).default
  Object.assign(state, { writes: 0, cancels: 0, release: null, held: false })
  const data = structuredClone(defaultConfig)
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (query) =>
    typeof query === 'string'
      ? { [query]: data[query] }
      : Array.isArray(query)
      ? Object.fromEntries(query.filter((key) => key in data).map((key) => [key, data[key]]))
      : {
          ...query,
          ...Object.fromEntries(
            Object.keys(query)
              .filter((key) => key in data)
              .map((key) => [key, data[key]]),
          ),
        },
  )
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) => {
    Object.assign(data, structuredClone(patch))
  })
  Browser.runtime.getPlatformInfo = vi.fn(async () => ({ os: 'controlled' }))
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('legacy UI Port → common runtime', () => {
  it('uses a registered fourth engine and publishes exactly one verified final', async () => {
    const { executeWebEngineSession } = await import('../src/engines/browser-runtime.mjs')
    const f = portFixture()
    await executeWebEngineSession(
      { modelName: 'fourth/model', question: 'Controlled material' },
      f.guarded,
      {},
      caller,
    )
    expect(state.writes).toBe(1)
    expect(f.posts.filter((packet) => packet.done)).toEqual([
      expect.objectContaining({
        outcome: 'completed',
        finalContent: 'Verified final',
        session: expect.objectContaining({
          engineRunId: expect.any(String),
          engineConversationRef: expect.any(String),
        }),
      }),
    ])
  })
  it('keeps execution alive when a UI observer disconnects', async () => {
    state.held = true
    const { executeWebEngineSession, engineRuntime } = await import(
      '../src/engines/browser-runtime.mjs'
    )
    const f = portFixture()
    const observing = executeWebEngineSession(
      { modelName: 'fourth/model', question: 'Controlled material' },
      f.guarded,
      {},
      caller,
    )
    await vi.waitFor(() => expect(state.release).toBeTypeOf('function'))
    const runId = f.posts.find((packet) => packet.session?.engineRunId).session.engineRunId
    f.disconnect()
    const count = f.posts.length
    state.release()
    await observing
    expect(state.cancels).toBe(0)
    expect(state.writes).toBe(1)
    expect(f.posts).toHaveLength(count)
    expect(await engineRuntime().read(runId, caller)).toMatchObject({
      outcome: 'completed',
      result: { content: 'Verified final' },
    })
  })
  it('orders UI Stop through the owner and never publishes a late success', async () => {
    state.held = true
    const { executeWebEngineSession, engineRuntime } = await import(
      '../src/engines/browser-runtime.mjs'
    )
    const f = portFixture()
    const observing = executeWebEngineSession(
      { modelName: 'fourth/model', question: 'Controlled material' },
      f.guarded,
      {},
      caller,
    )
    await vi.waitFor(() => expect(state.release).toBeTypeOf('function'))
    const runId = f.posts.find((packet) => packet.session?.engineRunId).session.engineRunId
    f.emit({ stop: true, requestToken: 'ui-token' })
    await observing
    expect(state.cancels).toBe(1)
    expect(f.posts.filter((packet) => packet.done)).toEqual([
      expect.objectContaining({ outcome: 'stopped' }),
    ])
    expect(await engineRuntime().read(runId, caller)).toMatchObject({ outcome: 'stopped' })
    expect(f.posts.some((packet) => packet.outcome === 'completed')).toBe(false)
  })
})
