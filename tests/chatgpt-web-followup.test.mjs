import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'

const state = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/config/storage.mjs', async (original) => ({
  ...(await original()),
  getUserConfig: async () => ({ chatgptWebEnabled: true, chatgptTabId: 1 }),
}))
vi.mock('../src/services/clients/chatgpt-web/conversation-api.mjs', async (original) => ({
  ...(await original()),
  getChatgptWebConversation: state.read,
}))
import {
  createChatgptWebConversation,
  getChatgptWebConversationWithFallback,
  registerExecuteApi,
  sendChatgptWebConversationMessageThroughProxy,
} from '../src/background/chatgpt-proxy-service.mjs'
import { ChatgptProxyControlAction, RuntimeMessage } from '../src/protocol/messages.mjs'

let execute
beforeEach(() => {
  state.read.mockReset()
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (defaults) =>
    Array.isArray(defaults) ? {} : defaults || {},
  )
  vi.spyOn(Browser.storage.local, 'set').mockResolvedValue(undefined)
  execute = vi.fn(async (session, port) => {
    port.postMessage({ session })
    port.postMessage({ session, answer: 'Synthetic answer', done: true })
  })
  registerExecuteApi(execute)
})
afterEach(() => vi.restoreAllMocks())

const fresh = () => ({
  conversationId: 'thread',
  currentNode: 'newest-parent',
  defaultModel: 'synthetic-model',
  cache: { source: 'network', stale: false, refreshError: null },
})

it.each([
  ['create', createChatgptWebConversation],
  ['follow-up', sendChatgptWebConversationMessageThroughProxy],
])(
  'does not acknowledge %s from a plain session before provider rejection',
  async (_name, send) => {
    state.read.mockResolvedValue(fresh())
    execute.mockImplementationOnce(async (session, port) => {
      port.postMessage({ session: { ...session, conversationId: 'thread' } })
      throw Object.assign(new Error('Rejected before submission'), {
        chatgptWebNotDispatched: true,
      })
    })

    await expect(
      send({ conversationId: 'thread', query: 'Synthetic question' }),
    ).rejects.toMatchObject({
      message: 'Rejected before submission',
      chatgptWebNotDispatched: true,
    })
  },
)

it.each([
  ['create', createChatgptWebConversation],
  ['follow-up', sendChatgptWebConversationMessageThroughProxy],
])(
  'acknowledges %s on explicit acceptance after a separate binding message',
  async (_name, send) => {
    state.read.mockResolvedValue(fresh())
    execute.mockImplementationOnce(async (session, port) => {
      port.postMessage({ session: { ...session, conversationId: 'thread' } })
      port.postMessage({ accepted: true })
      port.postMessage({ finalContent: 'Final only answer', done: true, outcome: 'completed' })
    })
    await expect(
      send({ conversationId: 'thread', query: 'Synthetic question' }),
    ).resolves.toMatchObject({
      conversationId: 'thread',
      pending: true,
    })
  },
)

it('reads the current remote parent before a follow-up instead of trusting an old complete cache', async () => {
  state.read.mockResolvedValue(fresh())
  const result = await sendChatgptWebConversationMessageThroughProxy({
    conversationId: 'thread',
    query: 'Follow up',
    operationId: 'synthetic-operation',
  })
  expect(state.read).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: 'thread', forceRefresh: true, latestOnly: true }),
  )
  expect(execute.mock.calls[0][0].parentMessageId).toBe('newest-parent')
  expect(result).toMatchObject({ conversationId: 'thread', messageId: 'synthetic-operation' })
})

it.each(['Failed to fetch', 'NetworkError when attempting to fetch'])(
  'uses a fresh proxy read when a cached snapshot absorbs a background %s',
  async (refreshError) => {
    state.read.mockResolvedValue({
      ...fresh(),
      currentNode: 'old-parent',
      cache: { source: 'cache', stale: true, refreshError },
    })
    vi.spyOn(Browser.tabs, 'get').mockResolvedValue({
      id: 1,
      url: 'https://chatgpt.com/?chatgptbox_proxy=1',
    })
    const proxy = vi
      .spyOn(Browser.tabs, 'sendMessage')
      .mockResolvedValue({ ok: true, data: fresh() })
    await expect(
      sendChatgptWebConversationMessageThroughProxy({
        conversationId: 'thread',
        query: 'Follow up',
      }),
    ).resolves.toMatchObject({ conversationId: 'thread' })
    expect(proxy).toHaveBeenCalledExactlyOnceWith(1, {
      type: RuntimeMessage.ChatgptProxyControlRequest,
      data: {
        action: ChatgptProxyControlAction.GetConversation,
        payload: {
          conversationId: 'thread',
          forceRefresh: true,
          latestOnly: true,
          requestTimeoutMs: 10_000,
        },
      },
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0].parentMessageId).toBe('newest-parent')
  },
)

it('keeps ordinary cached reads available without forcing a proxy refresh', async () => {
  const cached = {
    ...fresh(),
    cache: { source: 'cache', stale: true, refreshError: 'Failed to fetch' },
  }
  state.read.mockResolvedValue(cached)
  const proxy = vi.spyOn(Browser.tabs, 'sendMessage')
  expect(await getChatgptWebConversationWithFallback({ conversationId: 'thread' })).toBe(cached)
  expect(proxy).not.toHaveBeenCalled()
})

it('still rejects a follow-up when the proxy cannot verify a fresh parent', async () => {
  const cached = {
    ...fresh(),
    currentNode: 'old-parent',
    cache: { source: 'cache', stale: true, refreshError: 'Failed to fetch' },
  }
  state.read.mockResolvedValue(cached)
  vi.spyOn(Browser.tabs, 'get').mockResolvedValue({
    id: 1,
    url: 'https://chatgpt.com/?chatgptbox_proxy=1',
  })
  const proxy = vi.spyOn(Browser.tabs, 'sendMessage').mockResolvedValue({ ok: true, data: cached })
  await expect(
    sendChatgptWebConversationMessageThroughProxy({ conversationId: 'thread', query: 'Follow up' }),
  ).rejects.toMatchObject({ chatgptWebNotDispatched: true })
  expect(proxy).toHaveBeenCalledTimes(1)
  expect(execute).not.toHaveBeenCalled()
})

it.each([
  { source: 'cache', stale: false, refreshError: null },
  { source: 'cache', stale: true, refreshError: 'Authentication expired' },
  { source: 'network', stale: true, refreshError: 'Newest page unavailable' },
])('does not send from an unverified parent after a failed refresh: %j', async (cache) => {
  state.read.mockResolvedValue({ ...fresh(), currentNode: 'old-parent', cache })
  await expect(
    sendChatgptWebConversationMessageThroughProxy({ conversationId: 'thread', query: 'Follow up' }),
  ).rejects.toMatchObject({ chatgptWebNotDispatched: true })
  expect(execute).not.toHaveBeenCalled()
})
