import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { createMessageRouter } from '../src/background/message-router.mjs'
import { RuntimeMessage } from '../src/protocol/messages.mjs'
import {
  applyChatgptWebCacheMutation,
  upsertChatgptWebCreatedConversationIndexEntry,
  getChatgptWebConversationIndex,
  clearInvalidation,
  updateChatgptWebConversationTurnIndex,
} from '../src/services/clients/chatgpt-web/conversation-cache.mjs'
let stored
beforeEach(() => {
  stored = {}
  clearInvalidation()
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (defaults) => ({
    ...defaults,
    ...structuredClone(stored),
  }))
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) =>
    Object.assign(stored, structuredClone(patch)),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearInvalidation()
})
it('routes delayed proxy pages to the same background owner as concurrent acknowledged creates', async () => {
  const router = createMessageRouter()
  const sender = {
    id: Browser.runtime.id,
    frameId: 0,
    url: 'https://chatgpt.com/?chatgptbox_proxy=1',
  }
  vi.spyOn(Browser.runtime, 'sendMessage').mockImplementation((message) => router(message, sender))
  vi.stubGlobal('document', {})
  await Promise.all([
    upsertChatgptWebCreatedConversationIndexEntry('new-a'),
    upsertChatgptWebCreatedConversationIndexEntry('new-b'),
  ])
  const { mutateChatgptWebConversationIndex: proxyMutation } = await import(
    '../src/services/clients/chatgpt-web/conversation-cache.mjs?proxy-context'
  )
  await proxyMutation('mergePage', {
    items: [{ id: 'old-page', title: 'Remote page' }],
    syncedAt: new Date().toISOString(),
  })
  expect(Browser.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: RuntimeMessage.ChatgptWebCacheMutation }),
  )
  expect(Object.keys(await getChatgptWebConversationIndex()).sort()).toEqual([
    'new-a',
    'new-b',
    'old-page',
  ])
  expect(() =>
    router(
      {
        type: RuntimeMessage.ChatgptWebCacheMutation,
        data: { method: 'mergePage', payload: { items: [] } },
      },
      { ...sender, url: 'https://untrusted.invalid/' },
    ),
  ).toThrow('requires')
})
it('merges history import against the latest index and keeps a newer local turn over stale snapshots', async () => {
  await upsertChatgptWebCreatedConversationIndexEntry('new')
  await updateChatgptWebConversationTurnIndex({
    conversationId: 'new',
    messageId: 'new-turn',
    status: 'running',
  })
  await applyChatgptWebCacheMutation('mergeImport', {
    entries: { imported: { id: 'imported', title: 'Imported' } },
  })
  await applyChatgptWebCacheMutation('snapshot', {
    record: {
      conversationId: 'new',
      updateTime: '2000-01-01T00:00:00Z',
      pending: false,
      asyncStatus: null,
    },
    title: 'New',
    history: { complete: true, scope: 'current_branch' },
  })
  const index = await getChatgptWebConversationIndex()
  expect(Object.keys(index).sort()).toEqual(['imported', 'new'])
  expect(index.new).toMatchObject({ pending: true, localTurnMessageId: 'new-turn' })
})
it('does not poison later mutations after a failed storage write', async () => {
  Browser.storage.local.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(
    applyChatgptWebCacheMutation('mergePage', { items: [{ id: 'failed' }] }),
  ).rejects.toThrow('disk full')
  await applyChatgptWebCacheMutation('mergePage', { items: [{ id: 'next' }] })
  expect(Object.keys(await getChatgptWebConversationIndex())).toEqual(['next'])
})

it('uses the registered local writer even when the background has a Firefox-style document', async () => {
  createMessageRouter()
  vi.stubGlobal('document', {})
  const send = vi
    .spyOn(Browser.runtime, 'sendMessage')
    .mockRejectedValue(new Error('self messages do not return'))
  const { mutateChatgptWebConversationIndex } = await import(
    '../src/services/clients/chatgpt-web/conversation-cache.mjs'
  )
  await mutateChatgptWebConversationIndex('mergePage', { items: [{ id: 'mv2-background' }] })
  expect(send).not.toHaveBeenCalled()
  expect((await getChatgptWebConversationIndex())['mv2-background']).toBeTruthy()
})
