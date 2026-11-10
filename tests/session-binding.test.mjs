import { afterEach, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { switchSessionEngine } from '../src/services/session-binding.mjs'
import {
  saveChatgptWebSessionSnapshot,
  restoreChatgptWebSessionSnapshot,
} from '../src/services/clients/chatgpt-web/thread-state.mjs'
import {
  saveGrokWebSessionSnapshot,
  restoreGrokWebSessionOnto,
} from '../src/services/clients/grok-web/thread-state.mjs'
afterEach(() => vi.restoreAllMocks())
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
