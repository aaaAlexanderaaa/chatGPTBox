import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const clearAlarm = vi.fn(async () => true)
const setBadgeText = vi.fn(async () => {})

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
    alarms: { clear: clearAlarm },
    action: {
      setBadgeText,
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
  })),
}))

vi.mock('../src/services/wrappers.mjs', () => ({
  getChatGptAccessToken: vi.fn(async () => 'test-token'),
}))

vi.mock('../src/services/clients/chatgpt-web/client.mjs', () => ({
  generateAnswersWithChatgptWebApi: vi.fn(),
}))

const { syncChatgptWebConversationCache } = await import(
  '../src/services/clients/chatgpt-web/conversation-api.mjs'
)
const { getUserConfig } = await import('../src/config/storage.mjs')

function makeConversation(id) {
  return {
    id,
    title: `Conversation ${id}`,
    create_time: 1,
    update_time: 2,
    is_archived: false,
    is_starred: false,
  }
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Error',
    json: vi.fn(async () => payload),
    text: vi.fn(async () => JSON.stringify(payload)),
  }
}

describe('ChatGPT history sync engine', () => {
  beforeEach(() => {
    Object.keys(storageData).forEach((key) => delete storageData[key])
    clearAlarm.mockClear()
    setBadgeText.mockClear()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
    getUserConfig.mockResolvedValue({
      accessToken: 'test-token',
      chatgptWebHistorySyncEnabled: true,
      chatgptWebHistorySyncRpm: 30,
      customChatGptWebApiUrl: 'https://chatgpt.com',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fetches exactly one page for incremental automatic sync', async () => {
    const items = Array.from({ length: 100 }, (_, index) => makeConversation(`id-${index}`))
    fetch.mockResolvedValue(jsonResponse(200, { items, total: 400 }))

    const result = await syncChatgptWebConversationCache({
      mode: 'incremental',
      automatic: true,
      reason: 'scheduled',
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.pagesCompleted).toBe(1)
    expect(Object.keys(storageData.chatgptWebConversationIndex)).toHaveLength(100)
    expect(storageData.chatgptWebConversationMeta.syncState.status).toBe('complete')
  })

  it('keeps the first page when a later full-sync page fails', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => makeConversation(`id-${index}`))
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { items: firstPage, total: 200 }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'upstream failed' }))

    const assertion = expect(
      syncChatgptWebConversationCache({ mode: 'full', reason: 'manual_full_sync' }),
    ).rejects.toThrow('upstream failed')
    await vi.runAllTimersAsync()
    await assertion

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(Object.keys(storageData.chatgptWebConversationIndex)).toHaveLength(100)
    expect(storageData.chatgptWebConversationMeta.syncState.pagesCompleted).toBe(1)
    expect(storageData.chatgptWebConversationMeta.syncState.nextOffset).toBe(100)
    expect(storageData.chatgptWebConversationMeta.syncState.status).toBe('failed')
  })

  it('spaces bulk requests evenly according to the configured RPM', async () => {
    getUserConfig.mockResolvedValue({
      accessToken: 'test-token',
      chatgptWebHistorySyncEnabled: true,
      chatgptWebHistorySyncRpm: 6,
      customChatGptWebApiUrl: 'https://chatgpt.com',
    })
    const firstPage = Array.from({ length: 100 }, (_, index) => makeConversation(`id-${index}`))
    const secondPage = [makeConversation('id-100')]
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { items: firstPage, total: 101 }))
      .mockResolvedValueOnce(jsonResponse(200, { items: secondPage, total: 101 }))

    const sync = syncChatgptWebConversationCache({ mode: 'full', reason: 'manual_full_sync' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await sync
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('locks all automatic history activity after HTTP 429', async () => {
    fetch.mockResolvedValue(jsonResponse(429, { message: 'rate limited' }))

    await expect(
      syncChatgptWebConversationCache({ mode: 'full', reason: 'manual_full_sync' }),
    ).rejects.toThrow('rate limited')

    const meta = storageData.chatgptWebConversationMeta
    expect(meta.safetyLock).toMatchObject({ reason: 'rate_limited', status: 429 })
    expect(meta.syncState.status).toBe('rate_limited')
    expect(meta.requestStats.rateLimited).toBe(1)
    expect(clearAlarm).toHaveBeenCalled()
    expect(setBadgeText).toHaveBeenCalledWith({ text: '429' })

    await expect(
      syncChatgptWebConversationCache({ mode: 'incremental', automatic: true }),
    ).rejects.toMatchObject({ code: 'CHATGPT_HISTORY_RATE_LIMITED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends the observed ChatGPT account id on history list requests', async () => {
    getUserConfig.mockResolvedValue({
      accessToken: 'test-token',
      chatgptWebHistorySyncEnabled: true,
      chatgptWebHistorySyncRpm: 30,
      customChatGptWebApiUrl: 'https://chatgpt.com',
      chatgptAccountId: 'account-team',
    })
    fetch.mockResolvedValue(jsonResponse(200, { items: [makeConversation('id-1')], total: 1 }))

    await syncChatgptWebConversationCache({ mode: 'incremental', automatic: true })

    expect(fetch.mock.calls[0][1].headers['Chatgpt-Account-Id']).toBe('account-team')
  })

  it('restarts from the active list when resume archived scope no longer matches', async () => {
    const activePage = Array.from({ length: 100 }, (_, index) => makeConversation(`id-${index}`))
    fetch
      .mockResolvedValueOnce(jsonResponse(200, { items: activePage, total: 100 }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'archived failed' }))
      .mockResolvedValue(jsonResponse(200, { items: activePage, total: 100 }))

    const firstSync = expect(
      syncChatgptWebConversationCache({
        mode: 'full',
        includeArchived: true,
        reason: 'manual_full_sync',
      }),
    ).rejects.toThrow('archived failed')
    await vi.runAllTimersAsync()
    await firstSync

    expect(storageData.chatgptWebConversationMeta.syncState).toMatchObject({
      status: 'failed',
      phase: 'archived',
      includeArchived: true,
    })

    const resumed = syncChatgptWebConversationCache({
      mode: 'full',
      includeArchived: false,
      resume: true,
      reason: 'manual_resume',
    })
    await vi.runAllTimersAsync()
    await resumed

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(storageData.chatgptWebConversationMeta.syncState).toMatchObject({
      status: 'complete',
      phase: 'active',
      includeArchived: false,
    })
  })
})
