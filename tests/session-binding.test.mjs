import { afterEach, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { clearSessionConversation, switchSessionEngine } from '../src/services/session-binding.mjs'
import {
  saveChatgptWebSessionSnapshot,
  restoreChatgptWebSessionSnapshot,
  deleteChatgptWebSessionSnapshot,
} from '../src/services/clients/chatgpt-web/thread-state.mjs'
import {
  saveGrokWebSessionSnapshot,
  restoreGrokWebSessionOnto,
  deleteGrokWebSessionSnapshot,
} from '../src/services/clients/grok-web/thread-state.mjs'
afterEach(() => vi.restoreAllMocks())
it('reads and replaces an old imported bare-key snapshot only for its matching binding generation', async () => {
  const old = {
    sessionId: 'local',
    remoteBindingGeneration: 'generation',
    conversationId: 'thread',
    parentMessageId: 'old-parent',
    updatedAt: '2026-11-10T00:00:00Z',
  }
  const data = { chatgptWebSessionSnapshots: { local: old } }
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async () => structuredClone(data))
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) =>
    Object.assign(data, structuredClone(patch)),
  )
  const session = {
    sessionId: 'local',
    remoteBindingGeneration: 'generation',
    modelName: 'chatgptweb/one',
  }
  expect((await restoreChatgptWebSessionSnapshot(session)).parentMessageId).toBe('old-parent')
  expect(
    (await restoreChatgptWebSessionSnapshot({ ...session, remoteBindingGeneration: 'different' }))
      .conversationId,
  ).toBeUndefined()
  await saveChatgptWebSessionSnapshot({
    ...session,
    conversationId: 'thread',
    parentMessageId: 'new-parent',
  })
  expect(Object.keys(data.chatgptWebSessionSnapshots)).toEqual(['local:generation'])
  expect((await restoreChatgptWebSessionSnapshot(session)).parentMessageId).toBe('new-parent')
})
it('clears a switched conversation without losing its local identity or accepting old bindings', async () => {
  const initial = {
    sessionId: 'local',
    createdAt: '2026-11-01T00:00:00Z',
    sessionName: 'Retained title',
    modelName: 'chatgptweb/one',
    conversationId: 'old-thread',
    conversationRecords: [{ question: 'old', answer: 'answer' }],
  }
  const switched = switchSessionEngine(initial, 'grokweb/fast')
  const data = { sessions: [switched] }
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async () => structuredClone(data))
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) =>
    Object.assign(data, structuredClone(patch)),
  )
  const cleared = clearSessionConversation({ ...switched, conversationId: 'grok-thread' })
  expect(cleared).toMatchObject({
    sessionId: initial.sessionId,
    sessionName: initial.sessionName,
    createdAt: initial.createdAt,
    modelName: switched.modelName,
    question: null,
    conversationId: null,
    conversationRecords: [],
    remoteBindingParentGeneration: switched.remoteBindingGeneration,
  })
  expect(cleared.remoteBindingGeneration).not.toBe(switched.remoteBindingGeneration)
  const { applyLocalSessionMutation } = await import('../src/services/local-session.mjs')
  await applyLocalSessionMutation('update', { session: cleared })
  await expect(applyLocalSessionMutation('update', { session: switched })).rejects.toMatchObject({
    code: 'SESSION_BINDING_CHANGED',
  })
})

it('deletes every generation of one session without deleting a similarly named session', async () => {
  const snapshots = {
    local: { sessionId: 'local' },
    'local:one': { sessionId: 'local', remoteBindingGeneration: 'one' },
    'local:two': { sessionId: 'local', remoteBindingGeneration: 'two' },
    'local-other:one': { sessionId: 'local-other', remoteBindingGeneration: 'one' },
  }
  const data = {
    chatgptWebSessionSnapshots: structuredClone(snapshots),
    grokWebThreadSnapshots: structuredClone(snapshots),
  }
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async () => structuredClone(data))
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) =>
    Object.assign(data, structuredClone(patch)),
  )
  await deleteChatgptWebSessionSnapshot('local')
  await deleteGrokWebSessionSnapshot('local')
  expect(Object.keys(data.chatgptWebSessionSnapshots)).toEqual(['local-other:one'])
  expect(Object.keys(data.grokWebThreadSnapshots)).toEqual(['local-other:one'])
})
it('keeps local records, same-provider bindings, and prevents old snapshots resurrecting across switches', async () => {
  const data = {}
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (defaults) =>
    typeof defaults === 'string' ? { [defaults]: data[defaults] } : { ...defaults, ...data },
  )
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) =>
    Object.assign(data, structuredClone(patch)),
  )
  const initial = {
    sessionId: 'local',
    modelName: 'chatgptweb/one',
    conversationId: 'chat-thread',
    parentMessageId: 'parent',
    conversationRecords: [{ question: 'old question', answer: 'old answer' }],
  }
  await saveChatgptWebSessionSnapshot(initial)
  expect(switchSessionEngine(initial, 'chatgptweb/two').conversationId).toBe('chat-thread')
  const grok = switchSessionEngine(initial, 'grokweb/fast')
  expect(grok.conversationId).toBeNull()
  expect(grok.conversationRecords).toEqual(initial.conversationRecords)
  await saveGrokWebSessionSnapshot({
    ...grok,
    conversationId: 'grok-thread',
    previousResponseID: 'response',
  })
  const back = switchSessionEngine(grok, 'chatgptweb/two')
  expect((await restoreChatgptWebSessionSnapshot(back)).conversationId).toBeNull()
  const grokAgain = switchSessionEngine(back, 'grokweb/fast')
  expect((await restoreGrokWebSessionOnto(grokAgain)).conversationId).toBeNull()
  const remount = await restoreGrokWebSessionOnto({ ...grok, conversationId: null })
  expect(remount.conversationId).toBe('grok-thread')
})

it('persists rapid connection switches in invocation order with a captured session snapshot', async () => {
  const { updateSession, registerLocalSessionMutationOwner } = await import(
    '../src/services/local-session.mjs'
  )
  registerLocalSessionMutationOwner()
  let stored = [{ sessionId: 'local', conversationRecords: [] }],
    release,
    reads = 0
  const gate = new Promise((resolve) => {
    release = resolve
  })
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async () => {
    reads += 1
    if (reads === 1) await gate
    return { sessions: structuredClone(stored) }
  })
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async ({ sessions }) => {
    stored = structuredClone(sessions)
  })
  const first = updateSession({
    sessionId: 'local',
    modelName: 'grokweb/fast',
    remoteBindingGeneration: 'first',
    remoteBindingParentGeneration: null,
    conversationRecords: [],
  })
  const secondSession = {
    sessionId: 'local',
    modelName: 'chatgptweb/one',
    remoteBindingGeneration: 'second',
    remoteBindingParentGeneration: 'first',
    conversationRecords: [],
  }
  const second = updateSession(secondSession)
  secondSession.remoteBindingGeneration = 'changed after invocation'
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(reads).toBe(1)
  release()
  await Promise.all([first, second])
  expect(stored[0].remoteBindingGeneration).toBe('second')
})
