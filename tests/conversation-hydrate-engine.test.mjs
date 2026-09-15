import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storageData = {}
const storageListeners = new Set()

const storageLocal = {
  async get(defaults = {}) {
    if (defaults == null) return { ...storageData }
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
    apiServerRequestTimeoutSeconds: 30,
    customChatGptWebApiUrl: 'https://chatgpt.com',
  })),
}))

vi.mock('../src/services/wrappers.mjs', () => ({
  getChatGptAccessToken: vi.fn(async () => 'test-token'),
}))

vi.mock('../src/services/clients/chatgpt-web/client.mjs', () => ({
  generateAnswersWithChatgptWebApi: vi.fn(),
}))

const { getChatgptWebConversation } = await import(
  '../src/services/clients/chatgpt-web/conversation-api.mjs'
)
const {
  clearChatgptWebHydrateFailures,
  reconcileChatgptWebHydrateState,
  resetChatgptWebHydrateCircuit,
  retryChatgptWebHydrateFailure,
  runChatgptWebConversationHydrate,
  stopChatgptWebConversationHydrate,
} = await import('../src/services/clients/chatgpt-web/conversation-hydrate.mjs')
const { getUserConfig } = await import('../src/config/storage.mjs')

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Error',
    json: vi.fn(async () => payload),
    text: vi.fn(async () => JSON.stringify(payload)),
  }
}

function seedIndex(entries) {
  storageData.chatgptWebConversationIndex = entries
}

function seedFreshSnapshot(id, updateTime = 2) {
  storageData[`chatgptWebConversationSnapshot:${id}`] = {
    conversationId: id,
    cachedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    updateTime,
    asyncStatus: null,
    pending: false,
    snapshot: { conversation_id: id, title: id, mapping: {}, update_time: updateTime },
  }
}

describe('ChatGPT history content backup engine', () => {
  beforeEach(() => {
    Object.keys(storageData).forEach((key) => delete storageData[key])
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
    getUserConfig.mockResolvedValue({
      accessToken: 'test-token',
      chatgptWebHistorySyncEnabled: true,
      chatgptWebHistorySyncRpm: 30,
      apiServerRequestTimeoutSeconds: 30,
      customChatGptWebApiUrl: 'https://chatgpt.com',
      chatgptWebHistoryHydrateLimit: 0,
      chatgptWebHistoryHydrateOffset: 0,
      chatgptWebHistoryHydrateRetryCount: 1,
      chatgptWebHistoryHydrateOrder: 'updated',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('downloads missing bodies from the local list and skips fresh snapshots', async () => {
    seedIndex({
      stale: {
        id: 'stale',
        title: 'Stale',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
      fresh: {
        id: 'fresh',
        title: 'Fresh',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    seedFreshSnapshot('fresh', 2)
    fetch.mockResolvedValue(
      jsonResponse(200, { conversation_id: 'stale', title: 'Stale', mapping: {}, update_time: 2 }),
    )

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toContain('/backend-api/conversation/stale')
    expect(meta.hydrateState).toMatchObject({
      status: 'complete',
      hydrated: 1,
      skippedFresh: 1,
      failed: 0,
    })
    expect(storageData['chatgptWebConversationSnapshot:stale'].source).toBe('hydrate')
  })

  it('retries a failed body once, then skips that conversation id', async () => {
    seedIndex({
      bad: { id: 'bad', title: 'Bad', createTime: 1, updateTime: 2, isArchived: false },
    })
    fetch.mockResolvedValue(jsonResponse(500, { message: 'upstream failed' }))

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 1 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(meta.hydrateState.status).toBe('complete')
    expect(meta.hydrateState.failed).toBe(1)
    expect(meta.hydrateFailures.bad).toMatchObject({
      conversationId: 'bad',
      title: 'Bad',
      skipped: true,
    })
  })

  it('does not refetch a skipped conversation on the next job', async () => {
    seedIndex({
      bad: { id: 'bad', title: 'Bad', createTime: 1, updateTime: 2, isArchived: false },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateFailures: {
        bad: {
          conversationId: 'bad',
          title: 'Bad',
          skipped: true,
          error: 'old',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(fetch).not.toHaveBeenCalled()
    expect(meta.hydrateState.skippedFailed).toBe(1)
  })

  it('pauses after five consecutive conversation failures without touching remaining ids', async () => {
    const entries = {}
    for (let index = 0; index < 7; index += 1) {
      entries[`id-${index}`] = {
        id: `id-${index}`,
        title: `C${index}`,
        createTime: index,
        updateTime: 10 - index,
        isArchived: false,
      }
    }
    seedIndex(entries)
    fetch.mockResolvedValue(jsonResponse(500, { message: 'upstream failed' }))

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(fetch).toHaveBeenCalledTimes(5)
    expect(meta.hydrateState.status).toBe('circuit_open')
    expect(meta.hydrateState.failed).toBe(5)
    expect(meta.hydrateState.nextIndex).toBe(5)
  })

  it('does not apply the hydrate RPM gate to an on-demand conversation read', async () => {
    seedIndex({
      live: { id: 'live', title: 'Live', createTime: 1, updateTime: 2, isArchived: false },
    })
    storageData.chatgptWebConversationMeta = {
      nextHistoryRequestAt: new Date(Date.now() + 60_000).toISOString(),
    }
    fetch.mockResolvedValue(
      jsonResponse(200, {
        conversation_id: 'live',
        title: 'Live',
        mapping: {},
        current_node: null,
        update_time: 2,
      }),
    )

    const read = getChatgptWebConversation({ conversationId: 'live' })
    await vi.advanceTimersByTimeAsync(0)
    const result = await read

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.conversationId || result.cache.source).toBeTruthy()
  })

  it('times out a hung hydrate body using the API server request timeout', async () => {
    seedIndex({
      huge: { id: 'huge', title: 'Huge', createTime: 1, updateTime: 2, isArchived: false },
    })
    fetch.mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    const assertion = expect(hydrate).resolves.toMatchObject({
      hydrateState: { failed: 1 },
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(storageData.chatgptWebConversationMeta.hydrateFailures.huge.conversationId).toBe('huge')
  })

  it('does not refetch a cached body when only asyncStatus changed', async () => {
    seedIndex({
      same: {
        id: 'same',
        title: 'Same',
        createTime: 1,
        updateTime: 2,
        asyncStatus: 'in_progress',
        isArchived: false,
      },
    })
    seedFreshSnapshot('same', 2)

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(fetch).not.toHaveBeenCalled()
    expect(meta.hydrateState.skippedFresh).toBe(1)
    expect(storageData['chatgptWebConversationSnapshot:same'].source).toBe('test')
  })

  it('continues body backup if list sync is already pause-requested during refresh-list-first', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      syncState: { status: 'pause_requested' },
    }
    fetch.mockResolvedValue(
      jsonResponse(200, { conversation_id: 'a', title: 'A', mapping: {}, update_time: 2 }),
    )

    const hydrate = runChatgptWebConversationHydrate({
      refreshListFirst: true,
      retryCount: 0,
    })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(fetch.mock.calls.every((call) => !String(call[0]).includes('/conversations?'))).toBe(
      true,
    )
    expect(String(fetch.mock.calls[0][0])).toContain('/backend-api/conversation/a')
    expect(meta.hydrateState.status).toBe('complete')
    expect(meta.hydrateState.hydrated).toBe(1)
  })

  it('honors Stop after a refresh-list-first sync finishes without throwing', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/conversations?')) {
        await stopChatgptWebConversationHydrate()
        return jsonResponse(200, {
          items: [
            {
              id: 'a',
              title: 'A',
              create_time: 1,
              update_time: 2,
              is_archived: false,
            },
          ],
          total: 1,
        })
      }
      return jsonResponse(200, { conversation_id: 'a', title: 'A', mapping: {}, update_time: 2 })
    })

    const hydrate = runChatgptWebConversationHydrate({
      refreshListFirst: true,
      retryCount: 0,
    })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(meta.hydrateState.status).toBe('paused')
    expect(
      fetch.mock.calls.every((call) => !String(call[0]).includes('/backend-api/conversation/')),
    ).toBe(true)
  })

  it('rejects Resume when settings no longer match a paused job', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'paused',
        order: 'updated',
        offset: 0,
        limit: 0,
        includeArchived: false,
        candidateIds: ['a'],
        nextIndex: 4,
        hydrated: 2,
      },
    }

    await expect(
      runChatgptWebConversationHydrate({ resume: true, order: 'created_asc' }),
    ).rejects.toMatchObject({
      code: 'CHATGPT_HISTORY_HYDRATE_RESUME_MISMATCH',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(storageData.chatgptWebConversationMeta.hydrateState.nextIndex).toBe(4)
    expect(storageData.chatgptWebConversationMeta.hydrateState.status).toBe('paused')
  })

  it('can retry a skipped conversation after the bulk job was stopped', async () => {
    seedIndex({
      bad: {
        id: 'bad',
        title: 'Bad',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateState: { status: 'paused', candidateIds: ['bad'], nextIndex: 0 },
      hydrateFailures: {
        bad: {
          conversationId: 'bad',
          title: 'Bad',
          skipped: true,
          error: 'old',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }
    fetch.mockResolvedValue(
      jsonResponse(200, { conversation_id: 'bad', title: 'Bad', mapping: {}, update_time: 2 }),
    )

    await stopChatgptWebConversationHydrate()
    const retry = retryChatgptWebHydrateFailure('bad')
    await vi.runAllTimersAsync()
    const meta = await retry

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toContain('/backend-api/conversation/bad')
    expect(meta.hydrateFailures.bad).toBeUndefined()
    expect(meta.hydrateState.status).toBe('paused')
  })

  it('keeps bulk progress when retrying a single failed conversation', async () => {
    seedIndex({
      bad: {
        id: 'bad',
        title: 'Bad',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
      later: {
        id: 'later',
        title: 'Later',
        createTime: 1,
        updateTime: 1,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'circuit_open',
        order: 'updated',
        offset: 0,
        limit: 0,
        includeArchived: false,
        candidateIds: ['bad', 'later'],
        nextIndex: 1,
        hydrated: 0,
        failed: 5,
      },
      hydrateFailures: {
        bad: {
          conversationId: 'bad',
          title: 'Bad',
          skipped: true,
          error: 'old',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }
    fetch.mockResolvedValue(
      jsonResponse(200, { conversation_id: 'bad', title: 'Bad', mapping: {}, update_time: 2 }),
    )

    const retry = retryChatgptWebHydrateFailure('bad')
    await vi.runAllTimersAsync()
    const meta = await retry

    expect(meta.hydrateState.status).toBe('circuit_open')
    expect(meta.hydrateState.candidateIds).toEqual(['bad', 'later'])
    expect(meta.hydrateState.nextIndex).toBe(1)
    expect(meta.hydrateState.failed).toBe(5)
    expect(meta.hydrateFailures.bad).toBeUndefined()
  })

  it('does not start a new bulk backup while the circuit is open', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'circuit_open',
        order: 'updated',
        offset: 0,
        limit: 0,
        includeArchived: false,
        candidateIds: ['a'],
        nextIndex: 0,
      },
    }

    await expect(runChatgptWebConversationHydrate({ resume: false })).rejects.toMatchObject({
      code: 'CHATGPT_HISTORY_HYDRATE_CIRCUIT_OPEN',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not fetch when resetting the circuit', async () => {
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'circuit_open',
        candidateIds: ['a'],
        nextIndex: 3,
        consecutiveFailures: 5,
      },
    }

    const meta = await resetChatgptWebHydrateCircuit()
    expect(meta.hydrateState.status).toBe('paused')
    expect(meta.hydrateState.nextIndex).toBe(3)
    expect(meta.hydrateState.consecutiveFailures).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not start a body fetch after Stop during the RPM wait', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      nextHistoryRequestAt: new Date(Date.now() + 60_000).toISOString(),
    }
    fetch.mockResolvedValue(
      jsonResponse(200, { conversation_id: 'a', title: 'A', mapping: {}, update_time: 2 }),
    )

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.advanceTimersByTimeAsync(10)
    await stopChatgptWebConversationHydrate()
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(meta.hydrateState.status).toBe('paused')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not open the circuit or fetch the next body when Stop lands on a failed in-flight request', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 3,
        asyncStatus: null,
        isArchived: false,
      },
      b: {
        id: 'b',
        title: 'B',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/backend-api/conversation/a')) {
        await stopChatgptWebConversationHydrate()
        return jsonResponse(500, { message: 'upstream failed' })
      }
      return jsonResponse(200, { conversation_id: 'b', title: 'B', mapping: {}, update_time: 2 })
    })

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(meta.hydrateState.status).toBe('paused')
    expect(meta.hydrateState.nextIndex).toBe(0)
    expect(meta.hydrateFailures?.a).toBeUndefined()
    expect(
      fetch.mock.calls.every((call) => !String(call[0]).includes('/backend-api/conversation/b')),
    ).toBe(true)
  })

  it('keeps a successful in-flight body then stops without starting the next one', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 3,
        asyncStatus: null,
        isArchived: false,
      },
      b: {
        id: 'b',
        title: 'B',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/backend-api/conversation/a')) {
        await stopChatgptWebConversationHydrate()
        return jsonResponse(200, { conversation_id: 'a', title: 'A', mapping: {}, update_time: 3 })
      }
      return jsonResponse(200, { conversation_id: 'b', title: 'B', mapping: {}, update_time: 2 })
    })

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(meta.hydrateState.status).toBe('paused')
    expect(meta.hydrateState.hydrated).toBe(1)
    expect(meta.hydrateState.nextIndex).toBe(1)
    expect(storageData['chatgptWebConversationSnapshot:a'].source).toBe('hydrate')
    expect(
      fetch.mock.calls.every((call) => !String(call[0]).includes('/backend-api/conversation/b')),
    ).toBe(true)
  })

  it('rejects clearing the skip list while a backup is running', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateFailures: {
        other: {
          conversationId: 'other',
          title: 'Other',
          skipped: true,
          error: 'old',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }
    let release
    fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.advanceTimersByTimeAsync(10)
    await expect(clearChatgptWebHydrateFailures()).rejects.toMatchObject({
      code: 'CHATGPT_HISTORY_HYDRATE_BUSY',
    })
    expect(storageData.chatgptWebConversationMeta.hydrateFailures.other.conversationId).toBe(
      'other',
    )

    await stopChatgptWebConversationHydrate()
    release(jsonResponse(200, { conversation_id: 'a', title: 'A', mapping: {}, update_time: 2 }))
    await vi.runAllTimersAsync()
    await hydrate
  })

  it('marks an orphaned running job as paused when no worker is alive', async () => {
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'running',
        order: 'updated',
        offset: 0,
        limit: 0,
        includeArchived: false,
        candidateIds: ['a'],
        nextIndex: 2,
      },
    }

    const meta = await reconcileChatgptWebHydrateState()
    expect(meta.hydrateState.status).toBe('paused')
    expect(meta.hydrateState.nextIndex).toBe(2)
  })

  it('pauses an orphaned running job on Stop instead of leaving it stopping', async () => {
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'running',
        candidateIds: ['a'],
        nextIndex: 1,
      },
    }

    const meta = await stopChatgptWebConversationHydrate()
    expect(meta.hydrateState.status).toBe('paused')
    expect(meta.hydrateState.nextIndex).toBe(1)
  })

  it('lets Start run after an orphaned running state is reconciled', async () => {
    seedIndex({
      a: {
        id: 'a',
        title: 'A',
        createTime: 1,
        updateTime: 2,
        asyncStatus: null,
        isArchived: false,
      },
    })
    storageData.chatgptWebConversationMeta = {
      hydrateState: {
        status: 'running',
        order: 'updated',
        offset: 0,
        limit: 0,
        includeArchived: false,
        candidateIds: ['a'],
        nextIndex: 0,
      },
    }
    fetch.mockResolvedValue(
      jsonResponse(200, { conversation_id: 'a', title: 'A', mapping: {}, update_time: 2 }),
    )

    const hydrate = runChatgptWebConversationHydrate({ retryCount: 0 })
    await vi.runAllTimersAsync()
    const meta = await hydrate

    expect(meta.hydrateState.status).toBe('complete')
    expect(meta.hydrateState.hydrated).toBe(1)
  })

  it('rejects an automatic content backup', async () => {
    await expect(runChatgptWebConversationHydrate({ automatic: true })).rejects.toMatchObject({
      code: 'CHATGPT_HISTORY_HYDRATE_AUTOMATIC_FORBIDDEN',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps list sync at 100 items per network page after a hydrate job', async () => {
    const { syncChatgptWebConversationCache } = await import(
      '../src/services/clients/chatgpt-web/conversation-api.mjs'
    )
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `list-${index}`,
      title: `List ${index}`,
      create_time: 1,
      update_time: 2,
      is_archived: false,
    }))
    fetch.mockResolvedValue(jsonResponse(200, { items, total: 100 }))

    await syncChatgptWebConversationCache({ mode: 'incremental', automatic: true })

    expect(String(fetch.mock.calls[0][0])).toContain('limit=100')
    expect(storageData.chatgptWebConversationMeta.syncState.status).toBe('complete')
    expect(storageData.chatgptWebConversationMeta.hydrateState).toBeUndefined()
  })
})
