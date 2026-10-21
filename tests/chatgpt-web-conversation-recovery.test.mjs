import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storageData = vi.hoisted(() => ({}))
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        async get(defaults = {}) {
          return Object.fromEntries(
            Object.entries(defaults).map(([key, fallback]) => [key, storageData[key] ?? fallback]),
          )
        },
        async set(values) {
          Object.assign(storageData, values)
        },
      },
    },
    cookies: { getAll: async () => [], get: async () => null },
    alarms: { clear: async () => true },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  },
}))
vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: async () => ({
    accessToken: 'test-token',
    customChatGptWebApiUrl: 'https://chatgpt.com',
    apiServerRequestTimeoutSeconds: 30,
  }),
}))
vi.mock('../src/services/wrappers.mjs', () => ({
  getChatGptAccessToken: async () => 'test-token',
}))
vi.mock('../src/services/clients/chatgpt-web/client.mjs', () => ({
  generateAnswersWithChatgptWebApi: vi.fn(),
}))

const { getChatgptWebConversation, refreshChatgptWebConversation } = await import(
  '../src/services/clients/chatgpt-web/conversation-api.mjs'
)
const { clearInvalidation, exportConversationCache, saveChatgptWebConversationSnapshot } =
  await import('../src/services/clients/chatgpt-web/conversation-cache.mjs')
const { createChatgptWebTurnRecovery } = await import(
  '../src/services/clients/chatgpt-web/turn-recovery.mjs'
)
const { default: browserMock } = await import('webextension-polyfill')
const { default: browserAlias } = await vi.importActual('webextension-polyfill')
const originalAliasStorage = browserAlias.storage.local

function snapshot({
  userId = 'question',
  assistantId = 'answer',
  currentNode = assistantId,
  complete = false,
  asyncStatus = null,
} = {}) {
  return {
    conversation_id: 'thread',
    update_time: 20,
    async_status: asyncStatus,
    current_node: currentNode,
    messages: [
      { id: userId, author: { role: 'user' }, content: { parts: ['Question'] } },
      {
        id: assistantId,
        author: { role: 'assistant' },
        content: { parts: ['Complete answer'] },
        status: 'finished_successfully',
        end_turn: true,
      },
    ],
    page_info: { has_previous_page: !complete, start_cursor: complete ? null : 'older' },
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  // Lazy storage imports can resolve the alias directly after an asynchronous
  // callback. Keep those reads on the same fixture as the mocked polyfill.
  browserAlias.storage.local = browserMock.storage.local
  Object.keys(storageData).forEach((key) => delete storageData[key])
  clearInvalidation()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  browserAlias.storage.local = originalAliasStorage
  vi.unstubAllGlobals()
})

describe('conversation branch selection', () => {
  it('checks only the anchored newest page when recovering a turn', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(snapshot()))
    const result = await getChatgptWebConversation({
      conversationId: 'thread',
      userMessageId: 'question',
      forceRefresh: true,
      latestOnly: true,
      requestTimeoutMs: 10_000,
    })
    expect(result.queryMessage.messageId).toBe('question')
    expect(result.message).toMatchObject({ isFinal: true, text: 'Complete answer' })
    expect(result.history.complete).toBe(false)
    expect(result.cache).toMatchObject({ source: 'network', stale: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])(
    'preserves downloaded history and exports during recovery (complete=%s)',
    async (complete) => {
      const cached = {
        ...snapshot({ userId: 'question-12', assistantId: 'answer-12', complete }),
        messages: Array.from(
          { length: 12 },
          (_, index) =>
            snapshot({
              userId: `question-${index + 1}`,
              assistantId: `answer-${index + 1}`,
            }).messages,
        ).flat(),
      }
      storageData.chatgptWebConversationIndex = {
        thread: { id: 'thread', updateTime: 20, asyncStatus: null, pending: false },
      }
      await saveChatgptWebConversationSnapshot(cached)
      const exportedBefore = await exportConversationCache()
      const newestPage = {
        ...cached,
        update_time: 30,
        messages: cached.messages.slice(-20),
        page_info: { has_previous_page: true, start_cursor: 'older-newest' },
      }
      newestPage.messages[newestPage.messages.length - 1] = {
        ...newestPage.messages.at(-1),
        content: { parts: ['Fresh recovered answer'] },
      }
      fetch.mockResolvedValueOnce(jsonResponse(newestPage))
      const ids = { conversationId: 'thread', messageId: 'question-12' }
      const recover = createChatgptWebTurnRecovery({
        readConversation: getChatgptWebConversation,
        getStatus: async () => ({ ...ids, status: 'running' }),
        recordStatus: (record) => record,
      })

      expect(await recover(ids)).toMatchObject({
        ...ids,
        status: 'completed',
        text: 'Fresh recovered answer',
      })
      const exportedAfter = await exportConversationCache()
      expect(exportedAfter.data.snapshots.thread).toEqual(exportedBefore.data.snapshots.thread)
      expect(exportedAfter.data.index.thread.snapshotHistoryComplete).toBe(complete)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(new URL(fetch.mock.calls[0][0]).searchParams.get('include_message_id')).toBe(
        ids.messageId,
      )
    },
  )

  it('aborts a stalled turn-recovery fetch within its shorter read timeout', async () => {
    fetch.mockImplementationOnce(
      (_url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    await expect(
      getChatgptWebConversation({
        conversationId: 'thread',
        userMessageId: 'question',
        forceRefresh: true,
        latestOnly: true,
        requestTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: 'CHATGPT_HISTORY_HYDRATE_TIMEOUT' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { userMessageId: 'old-question', expectedAnchor: 'old-question' },
    { assistantMessageId: 'old-answer', expectedAnchor: 'old-answer' },
    {
      userMessageId: 'old-question',
      assistantMessageId: 'old-answer',
      expectedAnchor: 'old-answer',
    },
  ])(
    'reads the requested branch without replacing the current branch cache: %j',
    async (options) => {
      const current = snapshot({
        userId: 'new-question',
        assistantId: 'new-answer',
        complete: true,
      })
      await saveChatgptWebConversationSnapshot(current)
      fetch.mockImplementationOnce(async (resource) => {
        expect(new URL(resource).searchParams.get('include_message_id')).toBe(
          options.expectedAnchor,
        )
        return jsonResponse(
          snapshot({
            userId: 'old-question',
            assistantId: 'old-answer',
            currentNode: 'new-answer',
            complete: true,
          }),
        )
      })

      const result = await getChatgptWebConversation({ conversationId: 'thread', ...options })
      expect(result.queryMessage.messageId).toBe('old-question')
      expect(result.message.messageId).toBe('old-answer')
      expect(storageData['chatgptWebConversationSnapshot:thread'].snapshot).toEqual(current)
      expect(
        (await getChatgptWebConversation({ conversationId: 'thread' })).message.messageId,
      ).toBe('new-answer')
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('starts at the requested branch instead of resuming an unrelated partial cache', async () => {
    await saveChatgptWebConversationSnapshot(
      snapshot({ userId: 'new-question', assistantId: 'new-answer' }),
    )
    fetch.mockResolvedValueOnce(
      jsonResponse(snapshot({ userId: 'old-question', assistantId: 'old-answer', complete: true })),
    )
    const result = await getChatgptWebConversation({
      conversationId: 'thread',
      userMessageId: 'old-question',
    })
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.pathname).toBe('/backend-api/conversations/thread')
    expect(url.searchParams.get('include_message_id')).toBe('old-question')
    expect(result.queryMessage.messageId).toBe('old-question')
  })

  it('selects an older assistant version even when its user message is already cached', async () => {
    await saveChatgptWebConversationSnapshot(
      snapshot({ assistantId: 'new-answer', complete: true }),
    )
    fetch.mockResolvedValueOnce(
      jsonResponse(
        snapshot({ assistantId: 'old-answer', currentNode: 'new-answer', complete: true }),
      ),
    )
    const result = await getChatgptWebConversation({
      conversationId: 'thread',
      userMessageId: 'question',
      assistantMessageId: 'old-answer',
    })
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('include_message_id')).toBe(
      'old-answer',
    )
    expect(result.message.messageId).toBe('old-answer')
  })

  it('does not return an unrelated cached branch when the anchored fetch fails', async () => {
    await saveChatgptWebConversationSnapshot(snapshot({ complete: true }))
    fetch.mockResolvedValueOnce(jsonResponse({ message: 'Bad Gateway' }, 502))
    await expect(
      getChatgptWebConversation({ conversationId: 'thread', userMessageId: 'old-question' }),
    ).rejects.toThrow('Bad Gateway')
  })

  it('can read an alternate branch from a legacy full-tree cache without a request', async () => {
    const mapping = {}
    for (const branch of ['old', 'new']) {
      const messages = snapshot({
        userId: `${branch}-question`,
        assistantId: `${branch}-answer`,
      }).messages
      mapping[messages[0].id] = {
        id: messages[0].id,
        parent: null,
        children: [messages[1].id],
        message: messages[0],
      }
      mapping[messages[1].id] = {
        id: messages[1].id,
        parent: messages[0].id,
        children: [],
        message: messages[1],
      }
    }
    await saveChatgptWebConversationSnapshot({
      conversation_id: 'thread',
      current_node: 'new-answer',
      async_status: null,
      mapping,
    })
    const result = await getChatgptWebConversation({
      conversationId: 'thread',
      userMessageId: 'old-question',
    })
    expect(result.message.messageId).toBe('old-answer')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('expired history cursor recovery', () => {
  it.each([
    { detail: 'invalid_cursor' },
    { error: 'invalid_cursor' },
    { error: { message: 'invalid_cursor' } },
    { detail: { code: 'invalid_cursor', message: 'The cursor expired' } },
  ])('restarts through the HTTP error parser for %j', async (payload) => {
    await saveChatgptWebConversationSnapshot(snapshot())
    fetch
      .mockResolvedValueOnce(jsonResponse(payload, 400))
      .mockResolvedValueOnce(jsonResponse(snapshot({ complete: true })))

    const result = await getChatgptWebConversation({
      conversationId: 'thread',
      userMessageId: 'question',
    })

    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('before')).toBe('older')
    const restart = new URL(fetch.mock.calls[1][0])
    expect(restart.pathname).toBe('/backend-api/conversations/thread')
    expect(restart.searchParams.get('include_message_id')).toBe('question')
    expect(result).toMatchObject({
      history: { complete: true },
      cache: { refreshError: null, stale: false },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not restart repeatedly when the replacement cursor also expires', async () => {
    await saveChatgptWebConversationSnapshot(snapshot())
    fetch
      .mockResolvedValueOnce(jsonResponse({ detail: 'invalid_cursor' }, 400))
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse({ detail: 'invalid_cursor' }, 400))

    const result = await getChatgptWebConversation({ conversationId: 'thread' })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      history: { complete: false },
      cache: { refreshError: 'invalid_cursor', stale: true },
    })
  })
})

describe('answer recovery after a history page fails', () => {
  it.each([
    { before: 'in_progress', after: null, pending: false },
    { before: null, after: 'in_progress', pending: true },
  ])(
    'keeps newly fetched status after an older-page failure: %j',
    async ({ before, after, pending }) => {
      storageData.chatgptWebConversationIndex = {
        thread: { id: 'thread', updateTime: 10, asyncStatus: before, pending: before !== null },
      }
      fetch
        .mockResolvedValueOnce(jsonResponse(snapshot({ asyncStatus: after })))
        .mockResolvedValueOnce(jsonResponse({ message: 'Bad Gateway' }, 502))
      const result = await getChatgptWebConversation({ conversationId: 'thread' })
      expect(result).toMatchObject({
        pending,
        asyncStatus: after,
        updateTime: 20,
        message: { isFinal: !pending, text: 'Complete answer' },
        history: { complete: false },
        cache: { source: 'network', stale: true, refreshError: 'Bad Gateway' },
      })
    },
  )

  it('returns the newest answer and the history error from refresh', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad Gateway' }, 502))
    const result = await refreshChatgptWebConversation({
      conversationId: 'thread',
      userMessageId: 'question',
      assistantMessageId: 'answer',
    })
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('include_message_id')).toBe('answer')
    expect(result).toMatchObject({
      text: 'Complete answer',
      pending: false,
      conversation: {
        history: { complete: false },
        cache: { refreshError: 'Bad Gateway', stale: true },
      },
    })
  })

  it('continues into the real SSE resume reader after an older-page failure', async () => {
    const finalMessage = snapshot().messages[1]
    const stream = new TextEncoder().encode(
      `data: ${JSON.stringify({ message: finalMessage })}\n\ndata: [DONE]\n\n`,
    )
    fetch
      .mockResolvedValueOnce(jsonResponse(snapshot({ asyncStatus: 'in_progress' })))
      .mockResolvedValueOnce(jsonResponse({ message: 'Bad Gateway' }, 502))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(stream.slice(0, 23))
              controller.enqueue(stream.slice(23))
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
    const result = await refreshChatgptWebConversation({
      conversationId: 'thread',
      preferResume: true,
      conduitToken: 'test-conduit',
    })
    expect(fetch.mock.calls[2][0]).toContain('/backend-api/f/conversation/resume')
    expect(fetch.mock.calls[2][1].method).toBe('POST')
    expect(result).toMatchObject({
      source: 'conversation+resume',
      text: 'Complete answer',
      pending: false,
      resume: { completed: true },
      conversation: { history: { complete: false }, cache: { refreshError: 'Bad Gateway' } },
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('still rejects refresh when the newest page fails, even with a cached answer', async () => {
    await saveChatgptWebConversationSnapshot(snapshot({ complete: true }))
    fetch.mockResolvedValueOnce(jsonResponse({ message: 'Bad Gateway' }, 502))
    await expect(refreshChatgptWebConversation({ conversationId: 'thread' })).rejects.toThrow(
      'Bad Gateway',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
