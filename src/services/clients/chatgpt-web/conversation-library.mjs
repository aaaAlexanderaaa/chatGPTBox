import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../../../protocol/messages.mjs'
import {
  getCachedChatgptWebConversationRecord,
  getChatgptWebConversationIndex,
  CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX,
  isChatgptWebConversationSnapshotStale,
} from './conversation-cache.mjs'
import {
  formatChatgptWebConversationSnapshot,
  pickChatgptWebConversationTitle,
} from './conversation-state.mjs'
import { parseChatgptConversationReference } from './conversation-export.mjs'

function timestamp(value) {
  if (value == null || value === '') return 0
  const number = Number(value)
  if (Number.isFinite(number)) return Math.abs(number) < 1e12 ? number * 1000 : number
  return Date.parse(value) || 0
}

export function buildCachedConversationList(
  index = {},
  keys = [],
  { query = '', filter = 'all', offset = 0, limit = 20 } = {},
) {
  const snapshotIds = new Set(
    keys
      .filter((key) => key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX))
      .map((key) => key.slice(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX.length)),
  )
  const ids = new Set([...Object.keys(index), ...snapshotIds])
  const search = query.trim().toLowerCase()
  const items = [...ids]
    .map((id) => {
      const entry = index[id] || {}
      return {
        id,
        title: entry.title || entry.rawItem?.title || id,
        updateTime: entry.updateTime ?? entry.createTime ?? null,
        isArchived: entry.isArchived === true,
        hasSnapshot: snapshotIds.has(id),
        historyComplete: entry.snapshotHistoryComplete ?? null,
        historyScope: entry.snapshotHistoryScope || null,
      }
    })
    .filter((item) => filter === 'all' || item.isArchived === (filter === 'archived'))
    .filter((item) => !search || `${item.title}\n${item.id}`.toLowerCase().includes(search))
    .sort(
      (left, right) =>
        timestamp(right.updateTime) - timestamp(left.updateTime) || left.id.localeCompare(right.id),
    )
  const start = Math.max(0, Number(offset) || 0)
  const count = Math.max(1, Math.min(100, Number(limit) || 20))
  return {
    items: items.slice(start, start + count),
    total: items.length,
    offset: start,
    limit: count,
  }
}

export async function listCachedChatgptConversations(options) {
  const index = await getChatgptWebConversationIndex()
  const keys =
    typeof Browser.storage.local.getKeys === 'function'
      ? await Browser.storage.local.getKeys()
      : Object.entries(index)
          .filter(([, entry]) => entry.snapshotCachedAt)
          .map(([id]) => `${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`)
  return buildCachedConversationList(index, keys, options)
}

export async function readChatgptConversationForExport(
  reference,
  { refresh = false, cachedOnly = false } = {},
) {
  const conversationId = parseChatgptConversationReference(reference)
  const index = await getChatgptWebConversationIndex()
  const record = await getCachedChatgptWebConversationRecord(conversationId)
  if (
    record?.snapshot &&
    (cachedOnly ||
      (!refresh && !isChatgptWebConversationSnapshotStale(index[conversationId], record)))
  ) {
    if (record.conversationId && record.conversationId !== conversationId) {
      throw new Error('Conversation response ID does not match')
    }
    const formatted = formatChatgptWebConversationSnapshot(record.snapshot)
    if (formatted.conversationId && formatted.conversationId !== conversationId) {
      throw new Error('Conversation response ID does not match')
    }
    return {
      ...formatted,
      conversationId,
      cachedAt: record.cachedAt,
      title: pickChatgptWebConversationTitle(
        index[conversationId]?.rawItem?.title,
        index[conversationId]?.title,
        formatted.title,
      ),
    }
  }
  if (cachedOnly) return null
  const result = await Browser.runtime.sendMessage({
    type: RuntimeMessage.ChatgptWebGetConversation,
    data: { conversationId, forceRefresh: refresh },
  })
  if (!result || result.error) throw new Error(result?.error || 'Conversation could not be loaded')
  if (result.conversationId !== conversationId)
    throw new Error('Conversation response ID does not match')
  if (result.history?.complete !== true || result.cache?.refreshError) {
    throw new Error(
      result.cache?.refreshError || 'Conversation history is incomplete; try loading it again',
    )
  }
  return result
}
