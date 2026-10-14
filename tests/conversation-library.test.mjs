import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildConversationExportFilename,
  conversationToMarkdown,
  parseChatgptConversationReference,
} from '../src/services/clients/chatgpt-web/conversation-export.mjs'

const state = vi.hoisted(() => ({ data: {}, get: vi.fn(), getKeys: vi.fn(), sendMessage: vi.fn() }))
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: state.get,
        getKeys: state.getKeys,
      },
    },
    runtime: { sendMessage: state.sendMessage },
  },
}))
const {
  buildCachedConversationList,
  listCachedChatgptConversations,
  readChatgptConversationForExport,
} = await import('../src/services/clients/chatgpt-web/conversation-library.mjs')
const { clearInvalidation, isChatgptWebConversationSnapshotStale } = await import(
  '../src/services/clients/chatgpt-web/conversation-cache.mjs'
)

function snapshot(id, complete = true) {
  return {
    conversationId: id,
    updateTime: 10,
    asyncStatus: null,
    snapshot: {
      conversation_id: id,
      title: `Title ${id}`,
      current_node: `${id}-answer`,
      messages: [
        { id: `${id}-question`, author: { role: 'user' }, content: { parts: ['Question'] } },
        {
          id: `${id}-answer`,
          author: { role: 'assistant' },
          content: { parts: ['Answer'] },
          status: 'finished_successfully',
          end_turn: true,
        },
      ],
      page_info: { has_previous_page: !complete, start_cursor: complete ? null : 'older' },
    },
  }
}

beforeEach(() => {
  state.data = {
    chatgptWebConversationIndex: {
      a: { id: 'a', title: 'Alpha', updateTime: 10, asyncStatus: null },
    },
  }
  state.get.mockReset().mockImplementation(async (keys) => {
    const names = Array.isArray(keys) ? keys : Object.keys(keys)
    return Object.fromEntries(
      names.map((key) => [key, state.data[key] ?? (Array.isArray(keys) ? undefined : keys[key])]),
    )
  })
  state.getKeys.mockReset().mockImplementation(async () => Object.keys(state.data))
  state.sendMessage.mockReset()
  clearInvalidation()
})

describe('conversation references and export names', () => {
  it.each([
    [' thread-id ', 'thread-id'],
    ['https://chatgpt.com/c/thread-id?model=example#message', 'thread-id'],
    ['https://chatgpt.com/g/project/c/thread-id/', 'thread-id'],
    ['https://chat.openai.com/c/thread-id', 'thread-id'],
  ])('accepts ID or official conversation link %s', (value, expected) => {
    expect(parseChatgptConversationReference(value)).toBe(expected)
  })
  it.each([
    '',
    'bad id',
    'https://example.com/c/id',
    'https://chatgpt.com/share/id',
    'https://chatgpt.com/',
  ])('rejects an unusable reference %s', (value) => {
    expect(() => parseChatgptConversationReference(value)).toThrow()
  })
  it('uses a readable filename without path separators', () => {
    expect(
      buildConversationExportFilename(
        { title: '../报告: test/?', conversationId: 'abcdefgh-123' },
        'md',
      ),
    ).toBe('chatgptbox-..-报告- test---abcdefgh.md')
  })
})

describe('local conversation browsing and selected reads', () => {
  it('searches titles and IDs, includes starred and archived conversations, and paginates', () => {
    const index = Object.fromEntries(
      Array.from({ length: 45 }, (_, i) => [
        String(i),
        {
          title: `Title ${i}`,
          updateTime: i,
          isArchived: i === 44,
          isStarred: i === 43,
        },
      ]),
    )
    expect(buildCachedConversationList(index, [], { offset: 20 }).items).toHaveLength(20)
    expect(buildCachedConversationList(index, [], { filter: 'archived' }).items[0].id).toBe('44')
    expect(buildCachedConversationList(index, [], { query: 'Title 43' }).items[0].id).toBe('43')
    expect(buildCachedConversationList(index, [], { query: '44' }).total).toBe(1)
  })

  it('lists local metadata without reading any conversation bodies or contacting ChatGPT', async () => {
    state.data['chatgptWebConversationSnapshot:a'] = snapshot('a')
    state.data.chatgptWebConversationIndex.a.snapshotHistoryComplete = false
    expect((await listCachedChatgptConversations()).items[0]).toMatchObject({
      id: 'a',
      hasSnapshot: true,
      historyComplete: false,
    })
    expect(
      state.get.mock.calls.every(
        ([keys]) => !JSON.stringify(keys).includes('chatgptWebConversationSnapshot:'),
      ),
    ).toBe(true)
    expect(state.sendMessage).not.toHaveBeenCalled()
  })

  it('previews a partial cache offline and exports from a fresh complete cache without network calls', async () => {
    state.data['chatgptWebConversationSnapshot:a'] = snapshot('a', false)
    expect(
      (await readChatgptConversationForExport('a', { cachedOnly: true })).history.complete,
    ).toBe(false)
    state.data['chatgptWebConversationSnapshot:a'] = snapshot('a')
    const result = await readChatgptConversationForExport('a')
    expect(conversationToMarkdown(result)).toContain('## Assistant\n\nAnswer')
    expect(state.sendMessage).not.toHaveBeenCalled()
  })

  it('reads only the selected conversation when its body is missing', async () => {
    state.sendMessage.mockResolvedValue({
      conversationId: 'a',
      history: { complete: true },
      messages: [],
    })
    await readChatgptConversationForExport('https://chatgpt.com/c/a')
    expect(state.sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'CHATGPT_WEB_GET_CONVERSATION',
      data: { conversationId: 'a', forceRefresh: false },
    })
  })

  it('refreshes stale cached contents instead of exporting an outdated body', async () => {
    state.data['chatgptWebConversationSnapshot:a'] = snapshot('a')
    state.data.chatgptWebConversationIndex.a.updateTime = 11
    expect(
      isChatgptWebConversationSnapshotStale(
        state.data.chatgptWebConversationIndex.a,
        state.data['chatgptWebConversationSnapshot:a'],
      ),
    ).toBe(true)
    state.sendMessage.mockResolvedValue({
      conversationId: 'a',
      history: { complete: true },
      messages: [],
    })
    await readChatgptConversationForExport('a')
    expect(state.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not report an interrupted body download as a complete export', async () => {
    state.data['chatgptWebConversationSnapshot:a'] = snapshot('a', false)
    state.sendMessage.mockResolvedValue({
      conversationId: 'a',
      history: { complete: false },
      cache: { refreshError: 'Bad Gateway' },
    })
    await expect(readChatgptConversationForExport('a')).rejects.toThrow('Bad Gateway')
  })

  it('rejects a response for a different conversation', async () => {
    state.sendMessage.mockResolvedValue({ conversationId: 'other', history: { complete: true } })
    await expect(readChatgptConversationForExport('a')).rejects.toThrow('ID does not match')
  })
})
