import {
  formatChatgptWebConversationListItem,
  isPendingChatgptWebConversation,
} from './apis/chatgpt-web-conversation-state.mjs'

export const CHATGPT_WEB_CONVERSATION_INDEX_KEY = 'chatgptWebConversationIndex'
export const CHATGPT_WEB_CONVERSATION_META_KEY = 'chatgptWebConversationMeta'
const CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX = 'chatgptWebConversationSnapshot:'

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function normalizeConversationId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullable(value) {
  return value === undefined ? null : value
}

function timestampToSortableNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function compareMaybeEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function getBrowserStorage() {
  const { default: Browser } = await import('webextension-polyfill')
  return Browser.storage.local
}

export function makeChatgptWebConversationSnapshotStorageKey(conversationId) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) throw new Error('conversationId is required')
  return `${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${normalizedConversationId}`
}

export function normalizeChatgptWebConversationIndexEntry(rawItem = {}, existingEntry = null) {
  const id = normalizeConversationId(rawItem?.id || rawItem?.conversation_id)
  if (!id) return null

  const formatted = formatChatgptWebConversationListItem(rawItem)
  return {
    id,
    title: formatted.title || '',
    createTime: formatted.createTime || null,
    updateTime: formatted.updateTime || null,
    asyncStatus: normalizeNullable(formatted.asyncStatus),
    pending: formatted.pending === true,
    isArchived: formatted.isArchived === true,
    isStarred: formatted.isStarred === true,
    workspaceId: formatted.workspaceId || null,
    snippet: formatted.snippet || null,
    safeUrlCount: formatted.safeUrlCount || 0,
    blockedUrlCount: formatted.blockedUrlCount || 0,
    rawItem: cloneJson(rawItem),
    firstSeenAt: existingEntry?.firstSeenAt || null,
    lastSeenAt: existingEntry?.lastSeenAt || null,
    snapshotCachedAt: existingEntry?.snapshotCachedAt || null,
    snapshotUpdateTime:
      existingEntry?.snapshotUpdateTime !== undefined ? existingEntry.snapshotUpdateTime : null,
    snapshotAsyncStatus:
      existingEntry?.snapshotAsyncStatus !== undefined ? existingEntry.snapshotAsyncStatus : null,
  }
}

export function mergeChatgptWebConversationIndexEntries(
  currentEntries = {},
  incomingItems = [],
  syncedAt = new Date().toISOString(),
) {
  const nextEntries =
    currentEntries && typeof currentEntries === 'object' ? { ...currentEntries } : {}
  const newIds = []
  const updatedIds = []

  for (const rawItem of Array.isArray(incomingItems) ? incomingItems : []) {
    const normalizedItem = normalizeChatgptWebConversationIndexEntry(
      rawItem,
      nextEntries[rawItem?.id || rawItem?.conversation_id] || null,
    )
    if (!normalizedItem) continue

    const previous = nextEntries[normalizedItem.id] || null
    const nextEntry = {
      ...previous,
      ...normalizedItem,
      firstSeenAt: previous?.firstSeenAt || syncedAt,
      lastSeenAt: syncedAt,
    }

    nextEntries[normalizedItem.id] = nextEntry
    if (!previous) {
      newIds.push(normalizedItem.id)
      continue
    }

    const changed =
      previous.title !== nextEntry.title ||
      !compareMaybeEqual(previous.updateTime, nextEntry.updateTime) ||
      !compareMaybeEqual(previous.asyncStatus, nextEntry.asyncStatus) ||
      previous.pending !== nextEntry.pending ||
      previous.isArchived !== nextEntry.isArchived ||
      previous.isStarred !== nextEntry.isStarred ||
      previous.snippet !== nextEntry.snippet
    if (changed) updatedIds.push(normalizedItem.id)
  }

  return {
    entries: nextEntries,
    newIds,
    updatedIds,
  }
}

export function buildChatgptWebConversationListResponse(
  entries = {},
  { offset = 0, limit = 28, order = 'updated', isArchived = false, isStarred = false } = {},
  meta = {},
) {
  const requestedOffset = Math.max(0, parseInt(offset, 10) || 0)
  const requestedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 28))
  const requireArchived = String(isArchived) === 'true' || isArchived === true
  const requireStarred = String(isStarred) === 'true' || isStarred === true

  const items = Object.values(entries && typeof entries === 'object' ? entries : {})
    .filter((entry) => entry && typeof entry === 'object')
    .filter((entry) => entry.isArchived === requireArchived)
    .filter((entry) => entry.isStarred === requireStarred)
    .sort((left, right) => {
      const leftPrimary =
        order === 'created'
          ? timestampToSortableNumber(left?.createTime)
          : timestampToSortableNumber(left?.updateTime || left?.createTime)
      const rightPrimary =
        order === 'created'
          ? timestampToSortableNumber(right?.createTime)
          : timestampToSortableNumber(right?.updateTime || right?.createTime)
      if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary
      return String(right?.id || '').localeCompare(String(left?.id || ''))
    })
    .map((entry) => cloneJson(entry.rawItem || entry))

  return {
    items: items.slice(requestedOffset, requestedOffset + requestedLimit),
    total: items.length,
    limit: requestedLimit,
    offset: requestedOffset,
    order,
    source: 'cache',
    cached_at: requireArchived
      ? meta?.lastArchivedSyncAt || meta?.lastSyncAt || null
      : meta?.lastSyncAt || null,
  }
}

export function createChatgptWebConversationSnapshotRecord(
  conversation,
  { cachedAt = new Date().toISOString(), source = 'unknown' } = {},
) {
  const conversationId = normalizeConversationId(
    conversation?.conversation_id || conversation?.conversationId,
  )
  if (!conversationId) throw new Error('conversationId is required')

  return {
    conversationId,
    cachedAt,
    source,
    updateTime:
      conversation?.update_time !== undefined
        ? conversation.update_time
        : conversation?.updateTime || null,
    asyncStatus:
      conversation?.asyncStatus !== undefined
        ? normalizeNullable(conversation.asyncStatus)
        : normalizeNullable(conversation?.async_status),
    pending: isPendingChatgptWebConversation(conversation),
    snapshot: cloneJson(conversation),
  }
}

export function isChatgptWebConversationSnapshotStale(indexEntry, snapshotRecord) {
  if (!indexEntry || typeof indexEntry !== 'object') return snapshotRecord == null
  if (!snapshotRecord || typeof snapshotRecord !== 'object') return true

  if (!compareMaybeEqual(indexEntry.asyncStatus, snapshotRecord.asyncStatus)) return true

  const indexUpdateTime = timestampToSortableNumber(indexEntry.updateTime)
  const snapshotUpdateTime = timestampToSortableNumber(snapshotRecord.updateTime)
  if (indexUpdateTime > snapshotUpdateTime) return true

  if (indexEntry.pending === true && snapshotRecord.pending !== true) return true

  return false
}

export function overlayChatgptWebConversationStatus(conversation, indexEntry) {
  if (
    !conversation ||
    typeof conversation !== 'object' ||
    !indexEntry ||
    typeof indexEntry !== 'object'
  ) {
    return conversation
  }

  return {
    ...conversation,
    title: indexEntry.title || conversation.title || '',
    update_time:
      indexEntry.updateTime !== undefined ? indexEntry.updateTime : conversation.update_time,
    async_status:
      indexEntry.asyncStatus !== undefined ? indexEntry.asyncStatus : conversation.async_status,
  }
}

export async function getChatgptWebConversationIndex() {
  const storage = await getBrowserStorage()
  const data = await storage.get({ [CHATGPT_WEB_CONVERSATION_INDEX_KEY]: {} })
  const entries = data[CHATGPT_WEB_CONVERSATION_INDEX_KEY]
  return entries && typeof entries === 'object' ? entries : {}
}

export async function setChatgptWebConversationIndex(entries) {
  const storage = await getBrowserStorage()
  await storage.set({
    [CHATGPT_WEB_CONVERSATION_INDEX_KEY]: entries && typeof entries === 'object' ? entries : {},
  })
}

export async function getChatgptWebConversationMeta() {
  const storage = await getBrowserStorage()
  const data = await storage.get({
    [CHATGPT_WEB_CONVERSATION_META_KEY]: {
      lastSyncAt: null,
      lastArchivedSyncAt: null,
      lastSyncError: null,
      lastSyncItemCount: 0,
    },
  })
  const meta = data[CHATGPT_WEB_CONVERSATION_META_KEY]
  return meta && typeof meta === 'object' ? meta : {}
}

export async function setChatgptWebConversationMeta(meta) {
  const storage = await getBrowserStorage()
  await storage.set({
    [CHATGPT_WEB_CONVERSATION_META_KEY]: meta && typeof meta === 'object' ? meta : {},
  })
}

export async function getCachedChatgptWebConversationRecord(conversationId) {
  const key = makeChatgptWebConversationSnapshotStorageKey(conversationId)
  const storage = await getBrowserStorage()
  const data = await storage.get({ [key]: null })
  return data[key] && typeof data[key] === 'object' ? data[key] : null
}

export async function setCachedChatgptWebConversationRecord(record) {
  const key = makeChatgptWebConversationSnapshotStorageKey(record?.conversationId)
  const storage = await getBrowserStorage()
  await storage.set({ [key]: record })
}

export async function saveChatgptWebConversationSnapshot(conversation, options = {}) {
  const record = createChatgptWebConversationSnapshotRecord(conversation, options)
  await setCachedChatgptWebConversationRecord(record)

  const index = await getChatgptWebConversationIndex()
  const existingEntry = index[record.conversationId]
  if (existingEntry) {
    index[record.conversationId] = {
      ...existingEntry,
      snapshotCachedAt: record.cachedAt,
      snapshotUpdateTime: record.updateTime,
      snapshotAsyncStatus: record.asyncStatus,
    }
    await setChatgptWebConversationIndex(index)
  }

  return record
}
