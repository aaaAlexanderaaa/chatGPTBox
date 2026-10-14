import { describe, expect, it, vi } from 'vitest'
import {
  getChatgptWebConversationHistoryInfo,
  loadChatgptWebConversationPages,
} from '../src/services/clients/chatgpt-web/conversation-pages.mjs'
import { formatChatgptWebConversationSnapshot } from '../src/services/clients/chatgpt-web/conversation-state.mjs'

function message(id, role = 'user') {
  return {
    id,
    author: { role },
    content: { content_type: 'text', parts: [id] },
    status: 'finished_successfully',
    end_turn: role === 'assistant',
  }
}

function page(messages, cursor = null, extra = {}) {
  return {
    messages,
    page_info: { has_previous_page: cursor !== null, start_cursor: cursor },
    ...extra,
  }
}

describe('native ChatGPT conversation pagination', () => {
  it('selects the requested branch on the initial request and follows its cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([message('selected')], 'older'))
      .mockResolvedValueOnce(page([message('old')]))
    await loadChatgptWebConversationPages({
      conversationId: 'thread',
      includeMessageId: 'selected/+ =',
      fetchPage,
    })
    expect(
      new URL(fetchPage.mock.calls[0][0], 'https://chatgpt.com').searchParams.get(
        'include_message_id',
      ),
    ).toBe('selected/+ =')
    const older = new URL(fetchPage.mock.calls[1][0], 'https://chatgpt.com')
    expect(older.searchParams.get('before')).toBe('older')
    expect(older.searchParams.has('include_message_id')).toBe(false)
  })

  it('preserves the requested branch when restarting an expired cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid_cursor'), { status: 400 }))
      .mockResolvedValueOnce(page([message('selected')]))
    await loadChatgptWebConversationPages({
      conversationId: 'thread',
      includeMessageId: 'selected',
      snapshot: page([message('selected')], 'expired'),
      fetchPage,
    })
    expect(
      new URL(fetchPage.mock.calls[1][0], 'https://chatgpt.com').searchParams.get(
        'include_message_id',
      ),
    ).toBe('selected')
  })

  it('loads native before cursors, preserves newest metadata, and deduplicates page boundaries', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        page([message('u2'), message('a2', 'assistant')], 'older/+ =', {
          conversation_id: 'thread',
          current_node: 'a2',
          title: 'Title',
          safe_urls: ['https://example.com/new'],
          blocked_urls: [],
        }),
      )
      .mockResolvedValueOnce(
        page([message('u1'), message('a1', 'assistant'), message('u2')], null, {
          safe_urls: ['https://example.com/old'],
          blocked_urls: ['https://example.com/blocked'],
        }),
      )
    const checkpoints = []
    const result = await loadChatgptWebConversationPages({
      conversationId: 'thread',
      fetchPage,
      onSnapshot: async (snapshot) => checkpoints.push(snapshot),
    })
    const initial = new URL(fetchPage.mock.calls[0][0], 'https://chatgpt.com')
    const older = new URL(fetchPage.mock.calls[1][0], 'https://chatgpt.com')
    expect(initial.pathname).toBe('/backend-api/conversations/thread')
    expect(initial.searchParams.get('num_turns')).toBe('10')
    expect(older.pathname).toBe('/backend-api/conversations/thread/messages')
    expect(older.searchParams.get('before')).toBe('older/+ =')
    expect(older.searchParams.get('include_has_versions')).toBe('true')
    expect(result.messages.map((entry) => entry.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(result.current_node).toBe('a2')
    expect(result.title).toBe('Title')
    expect(result.safe_urls).toEqual(['https://example.com/new', 'https://example.com/old'])
    expect(result.blocked_urls).toEqual(['https://example.com/blocked'])
    expect(checkpoints[0].page_info.has_previous_page).toBe(true)
    expect(getChatgptWebConversationHistoryInfo(result)).toMatchObject({
      complete: true,
      scope: 'current_branch',
      loadedMessageCount: 4,
    })
  })

  it('preserves the first and last of 300 turns through loading and formatting', async () => {
    const allMessages = Array.from({ length: 300 }, (_, index) => [
      message(`u${index + 1}`),
      message(`a${index + 1}`, 'assistant'),
    ]).flat()
    let offset = allMessages.length
    const fetchPage = vi.fn(async (path) => {
      const url = new URL(path, 'https://chatgpt.com')
      if (fetchPage.mock.calls.length > 1)
        expect(url.searchParams.get('before')).toBe(String(offset))
      const end = offset
      offset = Math.max(0, offset - 20)
      return page(allMessages.slice(offset, end), offset ? String(offset) : null, {
        conversation_id: 'long',
        current_node: 'a300',
      })
    })
    const raw = await loadChatgptWebConversationPages({ conversationId: 'long', fetchPage })
    const formatted = formatChatgptWebConversationSnapshot(raw)
    expect(fetchPage).toHaveBeenCalledTimes(30)
    expect(formatted.messages).toHaveLength(600)
    expect(formatted.messages[0].text).toBe('u1')
    expect(formatted.messages.at(-1).text).toBe('a300')
    expect(raw).not.toHaveProperty('mapping')
  })

  it('retains a usable checkpoint after 502 and resumes its native cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([message('new')], 'old'))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
    let checkpoint
    await expect(
      loadChatgptWebConversationPages({
        conversationId: 'thread',
        fetchPage,
        onSnapshot: async (snapshot) => {
          checkpoint = snapshot
        },
      }),
    ).rejects.toMatchObject({ status: 502 })
    expect(getChatgptWebConversationHistoryInfo(checkpoint).complete).toBe(false)
    const resume = vi.fn(async () => page([message('old')]))
    const result = await loadChatgptWebConversationPages({
      conversationId: 'thread',
      fetchPage: resume,
      snapshot: checkpoint,
    })
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume.mock.calls[0][0]).toContain('/messages?before=old')
    expect(result.messages.map((entry) => entry.id)).toEqual(['old', 'new'])
  })

  it('only uses the legacy full-tree endpoint when the initial endpoint is unavailable', async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
      .mockResolvedValueOnce({ conversation_id: 'thread', mapping: {} })
    const result = await loadChatgptWebConversationPages({ conversationId: 'thread', fetchPage })
    expect(fetchPage.mock.calls[1][0]).toBe('/backend-api/conversation/thread')
    expect(getChatgptWebConversationHistoryInfo(result).scope).toBe('conversation_tree')
  })

  it.each([401, 429, 502])(
    'does not fall back to the full-tree request after HTTP %s',
    async (status) => {
      const fetchPage = vi.fn().mockRejectedValue(Object.assign(new Error('failed'), { status }))
      await expect(
        loadChatgptWebConversationPages({ conversationId: 'thread', fetchPage }),
      ).rejects.toMatchObject({ status })
      expect(fetchPage).toHaveBeenCalledTimes(1)
    },
  )

  it('skips empty pages using their native cursor and rejects cursor cycles', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([], 'a'))
      .mockResolvedValueOnce(page([], 'b'))
      .mockResolvedValueOnce(page([message('old')], 'a'))
    const onSnapshot = vi.fn()
    await expect(
      loadChatgptWebConversationPages({ conversationId: 'thread', fetchPage, onSnapshot }),
    ).rejects.toThrow('cursor did not advance')
    expect(onSnapshot).toHaveBeenCalledTimes(2)
  })

  it('restarts from the newest page once when a saved cursor expires', async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid_cursor'), { status: 400 }))
      .mockResolvedValueOnce(page([message('fresh')], 'fresh-cursor'))
      .mockRejectedValueOnce(Object.assign(new Error('invalid_cursor'), { status: 400 }))
    await expect(
      loadChatgptWebConversationPages({
        conversationId: 'thread',
        fetchPage,
        snapshot: page([message('old-new')], 'expired'),
      }),
    ).rejects.toThrow('invalid_cursor')
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage.mock.calls[1][0]).toMatch(/^\/backend-api\/conversations\/thread\?/)
  })

  it('pauses after saving a page without fetching the next one', async () => {
    let paused = false
    const fetchPage = vi.fn().mockResolvedValue(page([message('new')], 'old'))
    await expect(
      loadChatgptWebConversationPages({
        conversationId: 'thread',
        fetchPage,
        onSnapshot: async () => {
          paused = true
        },
        shouldAbort: () => paused,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it.each([
    page([message('duplicate'), message('duplicate')]),
    page([message('wrong')], null, { conversation_id: 'other' }),
    { messages: [message('missing-cursor')], page_info: { has_previous_page: true } },
  ])('rejects invalid pages before caching them', async (invalid) => {
    const onSnapshot = vi.fn()
    await expect(
      loadChatgptWebConversationPages({
        conversationId: 'thread',
        fetchPage: async () => invalid,
        onSnapshot,
      }),
    ).rejects.toThrow()
    expect(onSnapshot).not.toHaveBeenCalled()
  })
})
