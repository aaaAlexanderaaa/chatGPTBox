import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { createMessageRouter } from '../src/background/message-router.mjs'
import { RuntimeMessage } from '../src/protocol/messages.mjs'
import { switchSessionEngine } from '../src/services/session-binding.mjs'
let stored
const initial = () => ({
  sessionId: 'local',
  modelName: 'chatgptweb/one',
  conversationId: 'old-provider-id',
  conversationRecords: [{ question: 'old', answer: 'answer' }],
})
beforeEach(() => {
  stored = { sessions: [initial()] }
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (keys) =>
    typeof keys === 'string'
      ? { [keys]: structuredClone(stored[keys]) }
      : { ...keys, ...structuredClone(stored) },
  )
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) => {
    Object.assign(stored, structuredClone(patch))
  })
  const router = createMessageRouter()
  vi.spyOn(Browser.runtime, 'sendMessage').mockImplementation((message) =>
    router(message, { id: Browser.runtime.id, url: Browser.runtime.getURL('independent.html') }),
  )
})
afterEach(() => vi.restoreAllMocks())
const clients = () =>
  Promise.all([
    import('../src/services/local-session.mjs?independent-window-a'),
    import('../src/services/local-session.mjs?independent-window-b'),
  ])
it('serializes two window writers and rejects an older provider binding after a switch', async () => {
  const [a, b] = await clients()
  const next = switchSessionEngine(initial(), 'grokweb/fast')
  let release,
    reads = 0
  const get = Browser.storage.local.get.getMockImplementation()
  const gate = new Promise((resolve) => {
    release = resolve
  })
  Browser.storage.local.get.mockImplementation(async (keys) => {
    if (++reads === 1) await gate
    return get(keys)
  })
  const switched = a.updateSession(next)
  const stale = b.updateSession(initial())
  const rejected = expect(stale).rejects.toMatchObject({ code: 'SESSION_BINDING_CHANGED' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(reads).toBe(1)
  release()
  await switched
  await rejected
  expect(stored.sessions[0]).toMatchObject({
    modelName: 'grokweb/fast',
    conversationId: null,
    remoteBindingGeneration: next.remoteBindingGeneration,
  })
  await expect(b.createSession(initial())).rejects.toMatchObject({
    code: 'SESSION_BINDING_CHANGED',
  })
  expect(Browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: RuntimeMessage.LocalSessionMutation }),
  )
})
it('allows sequential switches with matching parent generations and snapshots caller input', async () => {
  const [a, b] = await clients()
  const one = switchSessionEngine(initial(), 'grokweb/fast')
  const two = switchSessionEngine(one, 'chatgptweb/two')
  const first = a.updateSession(one)
  const second = b.updateSession(two)
  two.conversationId = 'mutated after invocation'
  await Promise.all([first, second])
  expect(stored.sessions[0]).toMatchObject({
    modelName: 'chatgptweb/two',
    conversationId: null,
    remoteBindingGeneration: two.remoteBindingGeneration,
  })
})
it('initializes an empty list once when two windows open together', async () => {
  stored = { providerSchemaVersion: 2, modelName: 'chatgptweb/one', l1Providers: [] }
  const [a, b] = await clients()
  const [first, second] = await Promise.all([a.getSessions(), b.getSessions()])
  expect(first).toHaveLength(1)
  expect(second[0].sessionId).toBe(first[0].sessionId)
  expect(stored.sessions).toHaveLength(1)
})
it('accepts a coalesced sequence of local switches without reviving an older branch', async () => {
  const [a, b] = await clients()
  const intermediate = switchSessionEngine(initial(), 'grokweb/fast')
  const final = switchSessionEngine(intermediate, 'dsh/agent')
  await a.updateSession(final)
  expect(stored.sessions[0].remoteBindingGeneration).toBe(final.remoteBindingGeneration)
  await expect(b.updateSession(intermediate)).rejects.toMatchObject({
    code: 'SESSION_BINDING_CHANGED',
  })
})
it('requires an extension page and recovers its write queue after a storage failure', async () => {
  const router = createMessageRouter()
  await expect(
    router(
      { type: RuntimeMessage.LocalSessionMutation, data: { method: 'reset' } },
      { id: Browser.runtime.id, url: 'https://chatgpt.com/' },
    ),
  ).rejects.toThrow('extension page')
  const [a] = await clients()
  Browser.storage.local.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(a.updateSession(initial())).rejects.toThrow('disk full')
  await a.updateSession({ ...initial(), sessionName: 'saved after failure' })
  expect(stored.sessions[0].sessionName).toBe('saved after failure')
})
