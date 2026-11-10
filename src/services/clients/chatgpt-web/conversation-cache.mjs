import { mergeConversationIndexMaps } from './history-merge.mjs'
import { RuntimeMessage } from '../../../protocol/messages.mjs'
import {
  formatChatgptWebConversationListItem,
  isPendingChatgptWebConversation,
  pickChatgptWebConversationTitle,
} from './conversation-state.mjs'
import { getChatgptWebConversationHistoryInfo } from './conversation-pages.mjs'

export const CHATGPT_WEB_CONVERSATION_INDEX_KEY = 'chatgptWebConversationIndex'
export const CHATGPT_WEB_CONVERSATION_META_KEY = 'chatgptWebConversationMeta'
export const CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX = 'chatgptWebConversationSnapshot:'
export const CHATGPT_WEB_CONVERSATION_CACHE_VERSION = 1

const invalidatedConversationIds = new Set()
const localCreateAckEntries = new Map()
let allInvalidated = false

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
  // ChatGPT list dates can be ISO strings, while local create stubs use Unix seconds.
  const toMilliseconds = (numeric) =>
    Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric
  if (typeof value === 'number' && Number.isFinite(value)) return toMilliseconds(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return toMilliseconds(numeric)
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
    title: pickChatgptWebConversationTitle(
      formatted.title,
      existingEntry?.title,
      existingEntry?.rawItem?.title,
    ),
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
    let nextEntry = {
      ...previous,
      ...normalizedItem,
      firstSeenAt: previous?.firstSeenAt || syncedAt,
      lastSeenAt: syncedAt,
    }

    if (
      previous?.localTurnMessageId &&
      timestampToSortableNumber(nextEntry.updateTime) <
        timestampToSortableNumber(previous.updateTime)
    ) {
      nextEntry = {
        ...nextEntry,
        pending: previous.pending,
        asyncStatus: previous.asyncStatus,
        updateTime: previous.updateTime,
        rawItem: {
          ...nextEntry.rawItem,
          pending: previous.pending,
          async_status: previous.asyncStatus,
          update_time: previous.updateTime,
        },
      }
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
    .map((entry) => ({
      ...cloneJson(entry.rawItem || entry),
      id: entry.id,
      title: pickChatgptWebConversationTitle(entry.rawItem?.title, entry.title),
      create_time: entry.createTime ?? entry.rawItem?.create_time ?? null,
      update_time: entry.updateTime ?? entry.rawItem?.update_time ?? null,
      async_status: normalizeNullable(entry.asyncStatus),
      pending: entry.pending === true,
    }))

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

export function isChatgptWebConversationSnapshotStale(
  indexEntry,
  snapshotRecord,
  { requireComplete = true } = {},
) {
  const id = normalizeConversationId(indexEntry?.id || snapshotRecord?.conversationId)
  if (allInvalidated) return true
  if (id && invalidatedConversationIds.has(id)) return true
  if (
    requireComplete &&
    snapshotRecord?.snapshot &&
    !getChatgptWebConversationHistoryInfo(snapshotRecord.snapshot).complete
  )
    return true

  if (!indexEntry || typeof indexEntry !== 'object') return snapshotRecord == null
  if (!snapshotRecord || typeof snapshotRecord !== 'object') return true

  if (!compareMaybeEqual(indexEntry.asyncStatus, snapshotRecord.asyncStatus)) return true

  const indexUpdateTime = timestampToSortableNumber(indexEntry.updateTime)
  const snapshotUpdateTime = timestampToSortableNumber(snapshotRecord.updateTime)
  if (indexUpdateTime > snapshotUpdateTime) return true

  if (indexEntry.pending === true && snapshotRecord.pending !== true) return true

  return false
}

export function invalidateConversation(conversationId) {
  const id = normalizeConversationId(conversationId)
  if (id) invalidatedConversationIds.add(id)
}

export function invalidateAll() {
  allInvalidated = true
}

export function clearInvalidation(conversationId) {
  if (conversationId) {
    invalidatedConversationIds.delete(normalizeConversationId(conversationId))
  } else {
    invalidatedConversationIds.clear()
    localCreateAckEntries.clear()
    allInvalidated = false
  }
}

export async function exportConversationCache() {
  const index = await getChatgptWebConversationIndex()
  const meta = await getChatgptWebConversationMeta()

  const snapshots = {}
  const conversationIds = Object.keys(index)
  for (const id of conversationIds) {
    const record = await getCachedChatgptWebConversationRecord(id)
    if (record) {
      snapshots[id] = record
    }
  }

  return {
    version: CHATGPT_WEB_CONVERSATION_CACHE_VERSION,
    timestamp: new Date().toISOString(),
    count: conversationIds.length,
    data: {
      index,
      meta,
      snapshots,
    },
  }
}

export async function importConversationCache(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import data')
  if (data.version !== CHATGPT_WEB_CONVERSATION_CACHE_VERSION) {
    throw new Error(`Unsupported cache version: ${data.version}`)
  }

  const { index, meta, snapshots } = data.data || {}
  if (!index || typeof index !== 'object') throw new Error('Invalid index in import data')

  const storage = await getBrowserStorage()

  // Merge index
  await mutateChatgptWebConversationIndex('mergeImport', { entries: index })

  // Update meta if newer
  if (meta && typeof meta === 'object') {
    const currentMeta = await getChatgptWebConversationMeta()
    const nextMeta = {
      ...currentMeta,
      lastSyncAt:
        timestampToSortableNumber(meta.lastSyncAt) >
        timestampToSortableNumber(currentMeta.lastSyncAt)
          ? meta.lastSyncAt
          : currentMeta.lastSyncAt,
      lastArchivedSyncAt:
        timestampToSortableNumber(meta.lastArchivedSyncAt) >
        timestampToSortableNumber(currentMeta.lastArchivedSyncAt)
          ? meta.lastArchivedSyncAt
          : currentMeta.lastArchivedSyncAt,
    }
    await setChatgptWebConversationMeta(nextMeta)
  }

  // Import snapshots
  if (snapshots && typeof snapshots === 'object') {
    const storageUpdates = {}
    for (const [id, record] of Object.entries(snapshots)) {
      if (record && typeof record === 'object' && record.conversationId === id) {
        const key = makeChatgptWebConversationSnapshotStorageKey(id)
        storageUpdates[key] = record
      }
    }
    if (Object.keys(storageUpdates).length > 0) {
      await storage.set(storageUpdates)
    }
  }

  invalidateAll()
  return { success: true, count: Object.keys(index).length }
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
    title: pickChatgptWebConversationTitle(
      indexEntry.rawItem?.title,
      indexEntry.title,
      conversation.title,
    ),
    update_time:
      indexEntry.updateTime !== undefined ? indexEntry.updateTime : conversation.update_time,
    async_status:
      indexEntry.asyncStatus !== undefined ? indexEntry.asyncStatus : conversation.async_status,
  }
}

async function getStoredChatgptWebConversationIndex() {
  const storage = await getBrowserStorage()
  const data = (await storage.get({ [CHATGPT_WEB_CONVERSATION_INDEX_KEY]: {} })) || {}
  const entries = data[CHATGPT_WEB_CONVERSATION_INDEX_KEY]
  return entries && typeof entries === 'object' ? { ...entries } : {}
}

function overlayLocalCreateAckEntries(entries = {}) {
  const next = entries && typeof entries === 'object' ? { ...entries } : {}
  for (const [id, entry] of localCreateAckEntries) {
    if (!next[id]) next[id] = entry
  }
  return next
}

export async function getChatgptWebConversationIndex() {
  return overlayLocalCreateAckEntries(await getStoredChatgptWebConversationIndex())
}

export async function setChatgptWebConversationIndex(entries) {
  const storage = await getBrowserStorage()
  await storage.set({
    [CHATGPT_WEB_CONVERSATION_INDEX_KEY]: entries && typeof entries === 'object' ? entries : {},
  })
}

let conversationIndexWriteQueue = Promise.resolve()

function updateConversationIndex(updater) {
  const run = conversationIndexWriteQueue.then(async () => {
    const current = await getChatgptWebConversationIndex()
    const result = await updater(current)
    await setChatgptWebConversationIndex(result.entries)
    return result
  })
  conversationIndexWriteQueue = run.catch(() => {})
  return run
}

let localIndexMutationOwner = false

// Explicit for MV3 workers and MV2 background pages (which also have a DOM).
export function registerChatgptWebCacheMutationOwner() {
  localIndexMutationOwner = true
}

export async function mutateChatgptWebConversationIndex(method, payload) {
  if (!localIndexMutationOwner && typeof document !== 'undefined') {
    const { default: Browser } = await import('webextension-polyfill')
    return Browser.runtime.sendMessage({
      type: RuntimeMessage.ChatgptWebCacheMutation,
      data: { method, payload },
    })
  }
  return applyChatgptWebCacheMutation(method, payload)
}

// Called locally by the background router; never accepts arbitrary keys/updaters.
export function applyChatgptWebCacheMutation(method, payload = {}) {
  if (method === 'mergeImport') {
    if (!payload.entries || typeof payload.entries !== 'object' || Array.isArray(payload.entries))
      throw new Error('Invalid imported conversation index')
    return updateConversationIndex(async (entries) => {
      const merged = mergeConversationIndexMaps(entries, payload.entries)
      for (const [id, entry] of Object.entries(entries)) {
        if (!payload.entries[id]) merged[id] = entry
        else if (entry.localTurnMessageId) {
          merged[id].localTurnMessageId = entry.localTurnMessageId
          if (
            timestampToSortableNumber(merged[id].updateTime) <=
            timestampToSortableNumber(entry.updateTime)
          ) {
            for (const key of ['pending', 'asyncStatus', 'updateTime', 'rawItem'])
              merged[id][key] = entry[key]
          }
        }
      }
      return { entries: merged }
    })
  }
  if (method === 'mergePage') {
    if (!Array.isArray(payload.items) || payload.items.length > 100)
      throw new Error('Invalid conversation index page')
    return updateConversationIndex((entries) =>
      mergeChatgptWebConversationIndexEntries(entries, payload.items, payload.syncedAt),
    )
  }
  if (method === 'snapshot') {
    const { record, title: snapshotTitle, history } = payload
    if (!record?.conversationId || typeof record.conversationId !== 'string')
      throw new Error('Invalid conversation snapshot identity')
    return updateConversationIndex((entries) => {
      const existing = entries[record.conversationId]
      if (!existing) return { entries }
      const stale =
        !!existing.localTurnMessageId &&
        (!record.updateTime ||
          timestampToSortableNumber(record.updateTime) <
            timestampToSortableNumber(existing.updateTime))
      const title = pickChatgptWebConversationTitle(
        existing.rawItem?.title,
        existing.title,
        snapshotTitle,
      )
      const status = stale
        ? {}
        : {
            pending: record.pending === true,
            asyncStatus: record.asyncStatus,
            updateTime: record.updateTime ?? existing.updateTime,
          }
      entries[record.conversationId] = {
        ...existing,
        ...status,
        title,
        rawItem: {
          ...existing.rawItem,
          title,
          ...(stale
            ? {}
            : {
                pending: record.pending === true,
                async_status: record.asyncStatus,
                update_time: record.updateTime ?? existing.updateTime,
              }),
        },
        snapshotCachedAt: record.cachedAt,
        snapshotUpdateTime: record.updateTime,
        snapshotAsyncStatus: record.asyncStatus,
        snapshotHistoryComplete: history?.complete === true,
        snapshotHistoryScope: history?.scope || null,
      }
      return { entries, stale }
    })
  }
  throw new Error('Unsupported conversation index mutation')
}

export async function getChatgptWebConversationMeta() {
  const storage = await getBrowserStorage()
  const data = await storage.get({
    [CHATGPT_WEB_CONVERSATION_META_KEY]: {
      lastSyncAt: null,
      lastIncrementalSyncAt: null,
      lastArchivedSyncAt: null,
      lastSyncError: null,
      lastSyncItemCount: 0,
      adaptiveSyncIntervalHours: 6,
      safetyLock: null,
      syncState: { status: 'idle' },
      requestStats: {
        total: 0,
        automatic: 0,
        manual: 0,
        list: 0,
        detail: 0,
        rateLimited: 0,
        hourly: {},
        recent: [],
      },
    },
  })
  const meta = data?.[CHATGPT_WEB_CONVERSATION_META_KEY]
  return meta && typeof meta === 'object' ? meta : {}
}

export async function setChatgptWebConversationMeta(meta) {
  const storage = await getBrowserStorage()
  await storage.set({
    [CHATGPT_WEB_CONVERSATION_META_KEY]: meta && typeof meta === 'object' ? meta : {},
  })
}

let conversationMetaWriteQueue = Promise.resolve()

export async function updateChatgptWebConversationMeta(updater) {
  const run = conversationMetaWriteQueue.then(async () => {
    const current = await getChatgptWebConversationMeta()
    const base = current && typeof current === 'object' ? current : {}
    const next = await updater(base)
    await setChatgptWebConversationMeta(next && typeof next === 'object' ? next : {})
    return next
  })
  conversationMetaWriteQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function getCachedChatgptWebConversationRecord(conversationId) {
  const key = makeChatgptWebConversationSnapshotStorageKey(conversationId)
  const storage = await getBrowserStorage()
  const data = (await storage.get({ [key]: null })) || {}
  return data[key] && typeof data[key] === 'object' ? data[key] : null
}

export async function setCachedChatgptWebConversationRecord(record) {
  const key = makeChatgptWebConversationSnapshotStorageKey(record?.conversationId)
  const storage = await getBrowserStorage()
  await storage.set({ [key]: record })
}

function buildChatgptWebCreatedConversationIndexEntry(
  conversationId,
  { title = 'new chat', createdAt = new Date().toISOString() } = {},
) {
  const id = normalizeConversationId(conversationId)
  if (!id) throw new Error('conversationId is required')
  const createdAtUnix = timestampToSortableNumber(createdAt) || Date.now() / 1000
  const unixSeconds = createdAtUnix > 1e12 ? createdAtUnix / 1000 : createdAtUnix
  const normalized = normalizeChatgptWebConversationIndexEntry(
    {
      id,
      title,
      create_time: unixSeconds,
      update_time: unixSeconds,
      async_status: 'in_progress',
    },
    null,
  )
  if (!normalized) throw new Error('conversationId is required')
  return {
    ...normalized,
    pending: true,
    localCreateAck: true,
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
  }
}

export async function rememberChatgptWebCreatedConversationIndexEntry(
  conversationId,
  options = {},
) {
  const id = normalizeConversationId(conversationId)
  if (!id) throw new Error('conversationId is required')
  const stored = await getStoredChatgptWebConversationIndex()
  const existing = stored[id] || localCreateAckEntries.get(id) || null
  if (existing) return existing
  const entry = buildChatgptWebCreatedConversationIndexEntry(id, options)
  localCreateAckEntries.set(id, entry)
  return entry
}

export async function upsertChatgptWebCreatedConversationIndexEntry(conversationId, options = {}) {
  const entry = await rememberChatgptWebCreatedConversationIndexEntry(conversationId, options)
  await updateConversationIndex((entries) => ({
    entries: { ...entries, [entry.id]: entries[entry.id] || entry },
  }))
  localCreateAckEntries.delete(entry.id)
  return entry
}

export async function updateChatgptWebConversationTurnIndex({
  conversationId,
  messageId,
  status,
} = {}) {
  if (!conversationId || !messageId || !['running', 'completed'].includes(status)) return
  const run = updateConversationIndex(async (index) => {
    const entry = index[conversationId]
    if (!entry) return { entries: index }
    // A delayed completion from an earlier turn must not clear a newer send.
    if (status === 'completed' && entry.localTurnMessageId !== messageId) return { entries: index }
    const pending = status === 'running'
    const asyncStatus = pending ? 'in_progress' : null
    const updateTime = new Date().toISOString()
    index[conversationId] = {
      ...entry,
      localTurnMessageId: messageId,
      pending,
      asyncStatus,
      updateTime,
      rawItem: {
        ...entry.rawItem,
        id: conversationId,
        title: entry.title,
        pending,
        async_status: asyncStatus,
        update_time: updateTime,
      },
    }
    // The list status is known, but the cached body may still belong to the
    // preceding turn. Fetch that body on the next read instead of fabricating it.
    invalidateConversation(conversationId)
    return { entries: index }
  })
  return run
}

export async function saveChatgptWebConversationSnapshot(conversation, options = {}) {
  const record = createChatgptWebConversationSnapshotRecord(conversation, options)
  await setCachedChatgptWebConversationRecord(record)

  const indexRecord = { ...record }
  delete indexRecord.snapshot
  const result = await mutateChatgptWebConversationIndex('snapshot', {
    record: indexRecord,
    title: conversation.title,
    history: getChatgptWebConversationHistoryInfo(conversation),
  })
  if (!result?.stale) clearInvalidation(record.conversationId)
  return record
}
