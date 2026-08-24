import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const { storageData, storageListeners, storageLocal } = vi.hoisted(() => {
  const storageData = {}
  const storageListeners = new Set()
  const storageLocal = {
    async get(defaults = {}) {
      const result = {}
      for (const [key, fallback] of Object.entries(defaults)) {
        result[key] = key in storageData ? storageData[key] : fallback
      }
      return result
    },
    async set(values = {}) {
      const changes = {}
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: storageData[key], newValue: value }
        storageData[key] = value
      }
      storageListeners.forEach((listener) => listener(changes, 'local'))
    },
  }
  return { storageData, storageListeners, storageLocal }
})

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: storageLocal,
      onChanged: {
        addListener: (listener) => storageListeners.add(listener),
        removeListener: (listener) => storageListeners.delete(listener),
      },
    },
    cookies: {
      getAll: vi.fn(async () => []),
      get: vi.fn(async () => null),
    },
    alarms: { clear: vi.fn(async () => true) },
    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
    },
  },
}))

vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: vi.fn(async () => ({
    accessToken: 'test-token',
    chatgptWebHistorySyncEnabled: true,
    chatgptWebHistorySyncRpm: 30,
    customChatGptWebApiUrl: 'https://chatgpt.com',
    apiServerKeepHistory: false,
  })),
  setUserConfig: vi.fn(async () => {}),
}))

vi.mock('../src/services/wrappers.mjs', () => ({
  getChatGptAccessToken: vi.fn(async () => 'test-token'),
}))

vi.mock('../src/services/clients/chatgpt-web/client.mjs', () => ({
  generateAnswersWithChatgptWebApi: vi.fn(),
}))

const { shouldFallbackToChatgptProxy, createChatgptWebConversation, registerExecuteApi } =
  await import('../src/background/chatgpt-proxy-service.mjs')
const {
  CHATGPT_WEB_CONVERSATION_INDEX_KEY,
  clearInvalidation,
  getChatgptWebConversationIndex,
  getCachedChatgptWebConversationRecord,
  invalidateConversation,
  isChatgptWebConversationSnapshotStale,
  saveChatgptWebConversationSnapshot,
} = await import('../src/services/clients/chatgpt-web/conversation-cache.mjs')
const { CHATGPT_WEB_SESSION_SNAPSHOTS_KEY } = await import(
  '../src/services/clients/chatgpt-web/thread-state.mjs'
)
const { getChatgptWebConversation, refreshChatgptWebConversation, listChatgptWebConversations } =
  await import('../src/services/clients/chatgpt-web/conversation-api.mjs')

const ACCESS_DENIED =
  'You don’t have access to this conversation. Make sure you’re logged in to the right account, or ask the conversation owner to send you a share link.'

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Error',
    json: vi.fn(async () => payload),
    text: vi.fn(async () => JSON.stringify(payload)),
  }
}

const originalStorageSet = storageLocal.set

async function waitForLocalCreateStub(conversationId) {
  await vi.waitFor(async () => {
    const index = await getChatgptWebConversationIndex()
    expect(index[conversationId]?.localCreateAck).toBe(true)
  })
}

describe('lifecycle claims — current behavior', () => {
  beforeEach(() => {
    Object.keys(storageData).forEach((key) => delete storageData[key])
    clearInvalidation()
    storageLocal.set = originalStorageSet
    vi.stubGlobal('fetch', vi.fn())
    registerExecuteApi(async () => {
      throw new Error('executeApi not stubbed')
    })
  })

  afterEach(() => {
    storageLocal.set = originalStorageSet
    vi.unstubAllGlobals()
    clearInvalidation()
    registerExecuteApi(async () => {
      throw new Error('executeApi not registered; background entry did not call registerExecuteApi')
    })
  })

  describe('shouldFallbackToChatgptProxy', () => {
    it('falls back on Failed to fetch and NetworkError only', () => {
      expect(shouldFallbackToChatgptProxy(new TypeError('Failed to fetch'))).toBe(true)
      expect(shouldFallbackToChatgptProxy(new Error('NetworkError when attempting to fetch'))).toBe(
        true,
      )
      expect(shouldFallbackToChatgptProxy(new Error(ACCESS_DENIED))).toBe(false)
      expect(shouldFallbackToChatgptProxy(new Error('conversation_not_found'))).toBe(false)
    })
  })

  describe('invalidateConversation', () => {
    it('does not change staleness when there is no index row and no snapshot', () => {
      const before = isChatgptWebConversationSnapshotStale(null, null)
      invalidateConversation('brand-new-id')
      const after = isChatgptWebConversationSnapshotStale(null, null)
      expect(before).toBe(true)
      expect(after).toBe(true)
    })
  })

  describe('saveChatgptWebConversationSnapshot', () => {
    it('does not publish a new list row for an arbitrary snapshot id', async () => {
      await saveChatgptWebConversationSnapshot(
        {
          conversation_id: 'created-1',
          title: 'Hello',
          update_time: 10,
          current_node: 'n1',
          mapping: {},
        },
        { cachedAt: '2026-01-01T00:00:00.000Z', source: 'explicit_refresh' },
      )

      const index = await getChatgptWebConversationIndex()
      const snapshot = await getCachedChatgptWebConversationRecord('created-1')
      expect(snapshot?.conversationId).toBe('created-1')
      expect(index['created-1']).toBeUndefined()
    })

    it('clears a create-stub pending flag after a finished snapshot is saved', async () => {
      storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY] = {
        'created-1': {
          id: 'created-1',
          title: 'new chat',
          pending: true,
          localCreateAck: true,
          firstSeenAt: '2026-01-01T00:00:00.000Z',
        },
      }
      await saveChatgptWebConversationSnapshot(
        {
          conversation_id: 'created-1',
          title: 'Hello',
          update_time: 10,
          current_node: 'n1',
          mapping: {},
        },
        { cachedAt: '2026-01-01T00:00:01.000Z', source: 'explicit_refresh' },
      )
      const index = await getChatgptWebConversationIndex()
      const record = await getCachedChatgptWebConversationRecord('created-1')
      expect(index['created-1'].pending).toBe(false)
      expect(isChatgptWebConversationSnapshotStale(index['created-1'], record)).toBe(false)
    })

    it('updates snapshot metadata when the index row already exists', async () => {
      storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY] = {
        'created-1': {
          id: 'created-1',
          title: 'Hello',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
        },
      }
      await saveChatgptWebConversationSnapshot(
        {
          conversation_id: 'created-1',
          title: 'Hello',
          update_time: 10,
          current_node: 'n1',
          mapping: {},
        },
        { cachedAt: '2026-01-01T00:00:01.000Z', source: 'explicit_refresh' },
      )
      const index = await getChatgptWebConversationIndex()
      expect(index['created-1'].snapshotCachedAt).toBe('2026-01-01T00:00:01.000Z')
    })
  })

  describe('createChatgptWebConversation', () => {
    it('upserts a pending list stub so the Bridge owns the streamed id', async () => {
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })

      const result = await createChatgptWebConversation({ query: 'hello' })
      expect(result).toMatchObject({
        conversationId: 'streamed-id',
        pending: true,
        query: 'hello',
      })
      await waitForLocalCreateStub('streamed-id')

      const index = await getChatgptWebConversationIndex()
      expect(index['streamed-id']).toMatchObject({
        id: 'streamed-id',
        pending: true,
        localCreateAck: true,
      })

      const list = await listChatgptWebConversations({ offset: 0, limit: 28 })
      expect(
        list.items?.some(
          (item) => item.id === 'streamed-id' || item.conversationId === 'streamed-id',
        ),
      ).toBe(true)

      const snapshots = storageData[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] || {}
      const saved = Object.values(snapshots).filter(
        (entry) => entry?.conversationId === 'streamed-id',
      )
      expect(saved.length).toBeGreaterThan(0)
    })

    it('returns the id even if cache writes never settle', async () => {
      storageLocal.set = async () => new Promise(() => {})
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })
      await expect(createChatgptWebConversation({ query: 'hello' })).resolves.toMatchObject({
        conversationId: 'streamed-id',
        pending: true,
      })
    })

    it('softens access-denied immediately after create even if index persist never settles', async () => {
      storageLocal.set = async (values = {}) => {
        if (CHATGPT_WEB_CONVERSATION_INDEX_KEY in values) {
          return new Promise(() => {})
        }
        return originalStorageSet(values)
      }
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })
      await createChatgptWebConversation({ query: 'hello' })
      fetch.mockResolvedValue(
        jsonResponse(403, {
          detail: { message: ACCESS_DENIED, code: 'access_denied' },
        }),
      )

      const result = await refreshChatgptWebConversation({ conversationId: 'streamed-id' })
      expect(result.pending).toBe(true)
      expect(result.source).toBe('local_create_stub')
      expect(result.readError?.retryable).toBe(true)
    })

    it('does not mark an existing synced row as a local create stub', async () => {
      storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY] = {
        'streamed-id': {
          id: 'streamed-id',
          title: 'Already synced',
          pending: false,
          firstSeenAt: '2026-01-01T00:00:00.000Z',
        },
      }
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })
      await createChatgptWebConversation({ query: 'hello' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      const index = await getChatgptWebConversationIndex()
      expect(index['streamed-id']).toMatchObject({
        id: 'streamed-id',
        title: 'Already synced',
        pending: false,
      })
      expect(index['streamed-id'].localCreateAck).not.toBe(true)
    })

    it('throws query is required before executeApi runs', async () => {
      let called = false
      registerExecuteApi(async () => {
        called = true
      })
      await expect(createChatgptWebConversation({ query: '   ' })).rejects.toThrow(
        /query is required/,
      )
      expect(called).toBe(false)
    })
  })

  describe('refreshChatgptWebConversation', () => {
    it('throws access-denied for an unknown id', async () => {
      fetch.mockResolvedValue(
        jsonResponse(403, {
          detail: { message: ACCESS_DENIED, code: 'access_denied' },
        }),
      )

      await expect(refreshChatgptWebConversation({ conversationId: 'foreign-id' })).rejects.toThrow(
        ACCESS_DENIED,
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(String(fetch.mock.calls[0][0])).toContain('/backend-api/conversation/foreign-id')
    })

    it('returns pending instead of throwing when a locally created stub is not readable yet', async () => {
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })
      await createChatgptWebConversation({ query: 'hello' })
      await waitForLocalCreateStub('streamed-id')
      fetch.mockClear()
      fetch.mockResolvedValue(
        jsonResponse(403, {
          detail: { message: ACCESS_DENIED, code: 'access_denied' },
        }),
      )

      const result = await refreshChatgptWebConversation({ conversationId: 'streamed-id' })
      expect(result.conversationId).toBe('streamed-id')
      expect(result.pending).toBe(true)
      expect(result.source).toBe('local_create_stub')
      expect(result.readError?.retryable).toBe(true)
      expect(result.readError?.message).toBe(ACCESS_DENIED)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('still throws a generic 403 on a local create stub', async () => {
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })
      await createChatgptWebConversation({ query: 'hello' })
      await waitForLocalCreateStub('streamed-id')
      fetch.mockClear()
      fetch.mockResolvedValue(
        jsonResponse(403, {
          detail: { message: 'Forbidden', code: 'forbidden' },
        }),
      )
      await expect(
        refreshChatgptWebConversation({ conversationId: 'streamed-id' }),
      ).rejects.toThrow(/Forbidden/)
    })

    it('still throws access-denied for a synced pending row we did not create', async () => {
      storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY] = {
        'synced-pending': {
          id: 'synced-pending',
          title: 'new chat',
          pending: true,
        },
      }
      fetch.mockResolvedValue(
        jsonResponse(403, {
          detail: { message: ACCESS_DENIED, code: 'access_denied' },
        }),
      )
      await expect(
        refreshChatgptWebConversation({ conversationId: 'synced-pending' }),
      ).rejects.toThrow(ACCESS_DENIED)
    })

    it('softens access-denied on get the same way as refresh', async () => {
      registerExecuteApi(async (session, port) => {
        port.postMessage({
          session: { ...session, conversationId: 'streamed-id' },
        })
        port.postMessage({ done: true })
      })
      await createChatgptWebConversation({ query: 'hello' })
      await waitForLocalCreateStub('streamed-id')
      fetch.mockClear()
      fetch.mockResolvedValue(
        jsonResponse(403, {
          detail: { message: ACCESS_DENIED, code: 'access_denied' },
        }),
      )
      const result = await getChatgptWebConversation({ conversationId: 'streamed-id' })
      expect(result.conversationId).toBe('streamed-id')
      expect(result.pending).toBe(true)
      expect(result.readError?.retryable).toBe(true)
      expect(result.cache?.source).toBe('local_create_stub')
    })

    it('throws on the first conversation_not_found GET and does not retry', async () => {
      fetch.mockResolvedValue(
        jsonResponse(404, {
          detail: { message: 'Conversation not found', code: 'conversation_not_found' },
        }),
      )

      await expect(
        refreshChatgptWebConversation({ conversationId: 'streamed-id' }),
      ).rejects.toThrow(/Conversation not found/)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })
})

describe('lifecycle claims — source facts', () => {
  const clientSource = fs.readFileSync(
    new URL('../src/services/clients/chatgpt-web/client.mjs', import.meta.url),
    'utf8',
  )
  const gatewaySource = fs.readFileSync(
    new URL('../scripts/api-server.mjs', import.meta.url),
    'utf8',
  )
  const createServiceSource = fs.readFileSync(
    new URL('../src/background/chatgpt-proxy-service.mjs', import.meta.url),
    'utf8',
  )
  const apiServerPageSource = fs.readFileSync(
    new URL('../src/pages/ApiServer/App.jsx', import.meta.url),
    'utf8',
  )

  it('poll retries conversation_not_found only, not access denied', () => {
    expect(clientSource).toContain(
      "error?.chatgptWebConversationFetchCode === 'conversation_not_found'",
    )
    expect(clientSource).toContain('conversationNotFoundGraceMs')
    const graceBlock = clientSource.slice(
      clientSource.indexOf('const isConversationNotFound'),
      clientSource.indexOf('throw error', clientSource.indexOf('const isConversationNotFound')),
    )
    expect(graceBlock).toContain('conversation_not_found')
    expect(graceBlock).not.toMatch(/access_denied|don’t have access|don't have access/)
  })

  it('rejects an empty ChatGPT create query before opening an idempotency record', () => {
    const start = gatewaySource.indexOf('async function handleChatgptConversationCreate')
    const end = gatewaySource.indexOf('async function handleChatgptConversationGet')
    const handler = gatewaySource.slice(start, end)
    expect(handler.indexOf('query is required')).toBeGreaterThan(-1)
    expect(handler.indexOf('query is required')).toBeLessThan(
      handler.indexOf('beginWriteOperation'),
    )
    expect(handler).toContain('retryable: false')
  })

  it('rejects an empty ChatGPT follow-up query before opening an idempotency record', () => {
    const start = gatewaySource.indexOf('async function handleChatgptConversationMessage')
    const end = gatewaySource.indexOf('async function handleGrokConversationList')
    const handler = gatewaySource.slice(start, end)
    expect(handler.indexOf('query is required')).toBeGreaterThan(-1)
    expect(handler.indexOf('query is required')).toBeLessThan(
      handler.indexOf('beginWriteOperation'),
    )
  })

  it('create ack remembers the stub before returning the id', () => {
    const start = createServiceSource.indexOf('export async function createChatgptWebConversation')
    const fn = createServiceSource.slice(start, start + 3600)
    expect(fn.indexOf('rememberChatgptWebCreatedConversationIndexEntry')).toBeGreaterThan(-1)
    expect(fn.indexOf('rememberChatgptWebCreatedConversationIndexEntry')).toBeLessThan(
      fn.indexOf('resolvePromise({'),
    )
    expect(fn.indexOf('resolvePromise({')).toBeLessThan(
      fn.indexOf('upsertChatgptWebCreatedConversationIndexEntry'),
    )
    expect(fn).toContain("source: 'conversation_create_ack'")
    expect(fn).not.toContain('saveChatgptWebConversationSnapshot')
  })

  it('API Server /v1 path can disable history while conversation create forces it on', () => {
    expect(apiServerPageSource).toContain(
      'session.chatgptWebHistoryDisabledOverride = runtimeConfig.apiServerKeepHistory !== true',
    )
    expect(createServiceSource).toContain('chatgptWebHistoryDisabledOverride: false')
  })
})
