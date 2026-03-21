import {
  CHATGPT_WEB_CONVERSATION_INDEX_KEY,
  CHATGPT_WEB_CONVERSATION_META_KEY,
  CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX,
} from './chatgpt-web-conversation-cache.mjs'
import {
  CHATGPT_WEB_API_THREADS_KEY,
  CHATGPT_WEB_SESSION_SNAPSHOTS_KEY,
  MAX_CHATGPT_WEB_API_THREADS,
  MAX_CHATGPT_WEB_SESSION_SNAPSHOTS,
  normalizeChatgptWebBridgeMessages,
} from './chatgpt-web-thread-state.mjs'

export const CHATGPT_WEB_HISTORY_EXPORT_SCOPE = 'chatgpt-web-history'
export const CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION = 1

const STORAGE_WRITE_CHUNK_SIZE = 40

async function getBrowserStorage() {
  const { default: Browser } = await import('webextension-polyfill')
  return Browser.storage.local
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function stringifyKey(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toSortableTimestamp(value) {
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

function countObjectKeys(value) {
  return isPlainObject(value) ? Object.keys(value).length : 0
}

function pickNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function pickMinTimestampValue(...values) {
  const candidates = values
    .map((value) => ({ value, sortable: toSortableTimestamp(value) }))
    .filter((candidate) => candidate.sortable > 0)
    .sort((left, right) => left.sortable - right.sortable)
  return candidates[0]?.value ?? null
}

function pickMaxTimestampValue(...values) {
  const candidates = values
    .map((value) => ({ value, sortable: toSortableTimestamp(value) }))
    .filter((candidate) => candidate.sortable > 0)
    .sort((left, right) => right.sortable - left.sortable)
  return candidates[0]?.value ?? null
}

function chooseValueFromNewer(existingValue, incomingValue, existingTimestamp, incomingTimestamp) {
  const existingDefined = existingValue !== undefined && existingValue !== null
  const incomingDefined = incomingValue !== undefined && incomingValue !== null
  if (existingDefined && !incomingDefined) return existingValue
  if (!existingDefined && incomingDefined) return incomingValue
  if (!existingDefined && !incomingDefined) return null
  return incomingTimestamp >= existingTimestamp ? incomingValue : existingValue
}

function compareByTimestampAndRichness(leftTimestamp, rightTimestamp, leftRichness = 0, rightRichness = 0) {
  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp
  if (leftRichness !== rightRichness) return leftRichness - rightRichness
  return 0
}

function getConversationIndexEntryFreshness(entry) {
  // Detail snapshot hydration does not refresh the list payload, so it must
  // not make stale `rawItem` metadata win during import merges.
  return Math.max(
    toSortableTimestamp(entry?.updateTime),
    toSortableTimestamp(entry?.lastSeenAt),
    toSortableTimestamp(entry?.createTime),
  )
}

function normalizeConversationIndexEntry(entry = {}, fallbackId = '') {
  const id = stringifyKey(entry?.id || fallbackId)
  if (!id) return null

  return {
    id,
    title: typeof entry?.title === 'string' ? entry.title : '',
    createTime: entry?.createTime ?? null,
    updateTime: entry?.updateTime ?? null,
    asyncStatus: entry?.asyncStatus ?? null,
    pending: entry?.pending === true,
    isArchived: entry?.isArchived === true,
    isStarred: entry?.isStarred === true,
    workspaceId: entry?.workspaceId ?? null,
    snippet: entry?.snippet ?? null,
    safeUrlCount: Number.isFinite(entry?.safeUrlCount) ? Number(entry.safeUrlCount) : 0,
    blockedUrlCount: Number.isFinite(entry?.blockedUrlCount) ? Number(entry.blockedUrlCount) : 0,
    rawItem: cloneJson(entry?.rawItem || null),
    firstSeenAt: entry?.firstSeenAt ?? null,
    lastSeenAt: entry?.lastSeenAt ?? null,
    snapshotCachedAt: entry?.snapshotCachedAt ?? null,
    snapshotUpdateTime: entry?.snapshotUpdateTime ?? null,
    snapshotAsyncStatus: entry?.snapshotAsyncStatus ?? null,
  }
}

function mergeConversationIndexEntry(existingEntry = {}, incomingEntry = {}) {
  const normalizedExisting = normalizeConversationIndexEntry(existingEntry)
  const normalizedIncoming = normalizeConversationIndexEntry(
    incomingEntry,
    normalizedExisting?.id || '',
  )
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting

  const existingFreshness = getConversationIndexEntryFreshness(normalizedExisting)
  const incomingFreshness = getConversationIndexEntryFreshness(normalizedIncoming)
  const preferred =
    incomingFreshness >= existingFreshness ? normalizedIncoming : normalizedExisting
  const fallback =
    preferred === normalizedIncoming ? normalizedExisting : normalizedIncoming
  const snapshotFreshnessExisting = Math.max(
    toSortableTimestamp(normalizedExisting.snapshotUpdateTime),
    toSortableTimestamp(normalizedExisting.snapshotCachedAt),
  )
  const snapshotFreshnessIncoming = Math.max(
    toSortableTimestamp(normalizedIncoming.snapshotUpdateTime),
    toSortableTimestamp(normalizedIncoming.snapshotCachedAt),
  )

  return {
    id: preferred.id || fallback.id,
    title: pickNonEmptyString(preferred.title, fallback.title),
    createTime:
      pickMinTimestampValue(normalizedExisting.createTime, normalizedIncoming.createTime) ||
      preferred.createTime ||
      fallback.createTime ||
      null,
    updateTime:
      pickMaxTimestampValue(normalizedExisting.updateTime, normalizedIncoming.updateTime) ||
      preferred.updateTime ||
      fallback.updateTime ||
      null,
    asyncStatus: chooseValueFromNewer(
      normalizedExisting.asyncStatus,
      normalizedIncoming.asyncStatus,
      existingFreshness,
      incomingFreshness,
    ),
    pending:
      chooseValueFromNewer(
        normalizedExisting.pending,
        normalizedIncoming.pending,
        existingFreshness,
        incomingFreshness,
      ) === true,
    isArchived:
      chooseValueFromNewer(
        normalizedExisting.isArchived,
        normalizedIncoming.isArchived,
        existingFreshness,
        incomingFreshness,
      ) === true,
    isStarred:
      chooseValueFromNewer(
        normalizedExisting.isStarred,
        normalizedIncoming.isStarred,
        existingFreshness,
        incomingFreshness,
      ) === true,
    workspaceId: preferred.workspaceId ?? fallback.workspaceId ?? null,
    snippet: preferred.snippet ?? fallback.snippet ?? null,
    safeUrlCount: Math.max(normalizedExisting.safeUrlCount, normalizedIncoming.safeUrlCount),
    blockedUrlCount: Math.max(
      normalizedExisting.blockedUrlCount,
      normalizedIncoming.blockedUrlCount,
    ),
    rawItem:
      cloneJson(
        chooseValueFromNewer(
          normalizedExisting.rawItem,
          normalizedIncoming.rawItem,
          existingFreshness,
          incomingFreshness,
        ),
      ) || null,
    firstSeenAt:
      pickMinTimestampValue(normalizedExisting.firstSeenAt, normalizedIncoming.firstSeenAt) ||
      preferred.firstSeenAt ||
      fallback.firstSeenAt ||
      null,
    lastSeenAt:
      pickMaxTimestampValue(normalizedExisting.lastSeenAt, normalizedIncoming.lastSeenAt) ||
      preferred.lastSeenAt ||
      fallback.lastSeenAt ||
      null,
    snapshotCachedAt:
      pickMaxTimestampValue(
        normalizedExisting.snapshotCachedAt,
        normalizedIncoming.snapshotCachedAt,
      ) ||
      preferred.snapshotCachedAt ||
      fallback.snapshotCachedAt ||
      null,
    snapshotUpdateTime:
      pickMaxTimestampValue(
        normalizedExisting.snapshotUpdateTime,
        normalizedIncoming.snapshotUpdateTime,
      ) ||
      preferred.snapshotUpdateTime ||
      fallback.snapshotUpdateTime ||
      null,
    snapshotAsyncStatus: chooseValueFromNewer(
      normalizedExisting.snapshotAsyncStatus,
      normalizedIncoming.snapshotAsyncStatus,
      snapshotFreshnessExisting,
      snapshotFreshnessIncoming,
    ),
  }
}

function mergeConversationIndexMaps(existingIndex = {}, incomingIndex = {}) {
  const merged = {}
  const existingEntries = isPlainObject(existingIndex) ? existingIndex : {}
  const incomingEntries = isPlainObject(incomingIndex) ? incomingIndex : {}
  const ids = new Set([...Object.keys(existingEntries), ...Object.keys(incomingEntries)])

  ids.forEach((id) => {
    const mergedEntry = mergeConversationIndexEntry(existingEntries[id], incomingEntries[id])
    if (mergedEntry?.id) merged[mergedEntry.id] = mergedEntry
  })

  return merged
}

function getSnapshotRichness(record) {
  if (!isPlainObject(record)) return 0
  const snapshot = isPlainObject(record.snapshot) ? record.snapshot : null
  return countObjectKeys(snapshot) * 100 + (snapshot?.mapping ? countObjectKeys(snapshot.mapping) : 0)
}

function normalizeConversationSnapshotRecord(record = {}, fallbackConversationId = '') {
  const conversationId = stringifyKey(record?.conversationId || fallbackConversationId)
  if (!conversationId) return null
  return {
    conversationId,
    cachedAt: record?.cachedAt ?? null,
    source: typeof record?.source === 'string' ? record.source : null,
    updateTime: record?.updateTime ?? null,
    asyncStatus: record?.asyncStatus ?? null,
    pending: record?.pending === true,
    snapshot: cloneJson(record?.snapshot || null),
  }
}

function mergeConversationSnapshotRecord(existingRecord = {}, incomingRecord = {}) {
  const normalizedExisting = normalizeConversationSnapshotRecord(existingRecord)
  const normalizedIncoming = normalizeConversationSnapshotRecord(
    incomingRecord,
    normalizedExisting?.conversationId || '',
  )
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting

  const existingFreshness = Math.max(
    toSortableTimestamp(normalizedExisting.updateTime),
    toSortableTimestamp(normalizedExisting.cachedAt),
  )
  const incomingFreshness = Math.max(
    toSortableTimestamp(normalizedIncoming.updateTime),
    toSortableTimestamp(normalizedIncoming.cachedAt),
  )
  const existingRichness = getSnapshotRichness(normalizedExisting)
  const incomingRichness = getSnapshotRichness(normalizedIncoming)
  const preferredIsIncoming =
    compareByTimestampAndRichness(
      existingFreshness,
      incomingFreshness,
      existingRichness,
      incomingRichness,
    ) <= 0
  const preferred = preferredIsIncoming ? normalizedIncoming : normalizedExisting
  const fallback = preferred === normalizedIncoming ? normalizedExisting : normalizedIncoming

  return {
    conversationId: preferred.conversationId || fallback.conversationId,
    cachedAt:
      pickMaxTimestampValue(normalizedExisting.cachedAt, normalizedIncoming.cachedAt) ||
      preferred.cachedAt ||
      fallback.cachedAt ||
      null,
    source: pickNonEmptyString(preferred.source, fallback.source) || null,
    updateTime:
      pickMaxTimestampValue(normalizedExisting.updateTime, normalizedIncoming.updateTime) ||
      preferred.updateTime ||
      fallback.updateTime ||
      null,
    asyncStatus: chooseValueFromNewer(
      normalizedExisting.asyncStatus,
      normalizedIncoming.asyncStatus,
      existingFreshness,
      incomingFreshness,
    ),
    pending:
      chooseValueFromNewer(
        normalizedExisting.pending,
        normalizedIncoming.pending,
        existingFreshness,
        incomingFreshness,
      ) === true,
    snapshot: cloneJson(preferred.snapshot || fallback.snapshot || null),
  }
}

function mergeConversationMeta(existingMeta = {}) {
  const existing = isPlainObject(existingMeta) ? existingMeta : {}
  return {
    // Sync bookkeeping belongs to the current browser/account context.
    // Imports should not mark remote state as freshly synced.
    lastSyncAt: existing.lastSyncAt ?? null,
    lastArchivedSyncAt: existing.lastArchivedSyncAt ?? null,
    lastSyncError: existing.lastSyncError ?? null,
    lastSyncItemCount: Number.isFinite(existing.lastSyncItemCount)
      ? Number(existing.lastSyncItemCount)
      : 0,
  }
}

function sortByUpdatedAtDescending(entries = [], idSelector = () => '') {
  return [...entries].sort((left, right) => {
    const timestampDiff =
      toSortableTimestamp(right?.updatedAt) - toSortableTimestamp(left?.updatedAt)
    if (timestampDiff !== 0) return timestampDiff
    return String(idSelector(right)).localeCompare(String(idSelector(left)))
  })
}

function trimSessionSnapshotMap(snapshots = {}, limit = MAX_CHATGPT_WEB_SESSION_SNAPSHOTS) {
  return Object.fromEntries(
    sortByUpdatedAtDescending(
      Object.values(isPlainObject(snapshots) ? snapshots : {}).filter(
        (snapshot) => typeof snapshot?.sessionId === 'string' && snapshot.sessionId,
      ),
      (snapshot) => snapshot?.sessionId || '',
    )
      .slice(0, limit)
      .map((snapshot) => [snapshot.sessionId, snapshot]),
  )
}

function countNonEmptyValues(values = []) {
  return values.filter((value) => {
    if (typeof value === 'string') return value.trim().length > 0
    return value !== undefined && value !== null
  }).length
}

function normalizeSessionSnapshotRecord(record = {}, fallbackSessionId = '') {
  const sessionId = stringifyKey(record?.sessionId || fallbackSessionId)
  if (!sessionId) return null

  return {
    sessionId,
    conversationId: stringifyKey(record?.conversationId) || null,
    parentMessageId: stringifyKey(record?.parentMessageId) || null,
    messageId: stringifyKey(record?.messageId) || null,
    wsRequestId: stringifyKey(record?.wsRequestId) || null,
    modelName: pickNonEmptyString(record?.modelName) || null,
    question: pickNonEmptyString(record?.question) || null,
    updatedAt: record?.updatedAt ?? null,
    source: pickNonEmptyString(record?.source) || null,
  }
}

function getSessionSnapshotRichness(record) {
  return countNonEmptyValues([
    record?.conversationId,
    record?.parentMessageId,
    record?.messageId,
    record?.wsRequestId,
    record?.modelName,
    record?.question,
  ])
}

function mergeSessionSnapshotRecord(existingRecord = {}, incomingRecord = {}) {
  const normalizedExisting = normalizeSessionSnapshotRecord(existingRecord)
  const normalizedIncoming = normalizeSessionSnapshotRecord(
    incomingRecord,
    normalizedExisting?.sessionId || '',
  )
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting

  const existingFreshness = toSortableTimestamp(normalizedExisting.updatedAt)
  const incomingFreshness = toSortableTimestamp(normalizedIncoming.updatedAt)
  const existingRichness = getSessionSnapshotRichness(normalizedExisting)
  const incomingRichness = getSessionSnapshotRichness(normalizedIncoming)
  const preferredIsIncoming =
    compareByTimestampAndRichness(
      existingFreshness,
      incomingFreshness,
      existingRichness,
      incomingRichness,
    ) <= 0
  const preferred = preferredIsIncoming ? normalizedIncoming : normalizedExisting
  const fallback = preferred === normalizedIncoming ? normalizedExisting : normalizedIncoming

  return {
    sessionId: preferred.sessionId || fallback.sessionId,
    conversationId: pickNonEmptyString(preferred.conversationId, fallback.conversationId) || null,
    parentMessageId:
      pickNonEmptyString(preferred.parentMessageId, fallback.parentMessageId) || null,
    messageId: pickNonEmptyString(preferred.messageId, fallback.messageId) || null,
    wsRequestId: pickNonEmptyString(preferred.wsRequestId, fallback.wsRequestId) || null,
    modelName: pickNonEmptyString(preferred.modelName, fallback.modelName) || null,
    question: pickNonEmptyString(preferred.question, fallback.question) || null,
    updatedAt:
      pickMaxTimestampValue(normalizedExisting.updatedAt, normalizedIncoming.updatedAt) ||
      preferred.updatedAt ||
      fallback.updatedAt ||
      null,
    source: pickNonEmptyString(preferred.source, fallback.source) || null,
  }
}

function mergeSessionSnapshotMaps(existingSnapshots = {}, incomingSnapshots = {}) {
  const merged = {}
  const existingEntries = isPlainObject(existingSnapshots) ? existingSnapshots : {}
  const incomingEntries = isPlainObject(incomingSnapshots) ? incomingSnapshots : {}
  const sessionIds = new Set([...Object.keys(existingEntries), ...Object.keys(incomingEntries)])

  sessionIds.forEach((sessionId) => {
    const mergedSnapshot = mergeSessionSnapshotRecord(
      existingEntries[sessionId],
      incomingEntries[sessionId],
    )
    if (mergedSnapshot?.sessionId) {
      merged[mergedSnapshot.sessionId] = mergedSnapshot
    }
  })

  return trimSessionSnapshotMap(merged)
}

function normalizeApiThreadRecord(record = {}) {
  const conversationId = stringifyKey(record?.conversationId)
  const parentMessageId = stringifyKey(record?.parentMessageId)
  const transcript = normalizeChatgptWebBridgeMessages(record?.transcript)
  if (!conversationId || !parentMessageId || transcript.length === 0) return null

  return {
    model: pickNonEmptyString(record?.model) || null,
    conversationId,
    parentMessageId,
    sessionId: stringifyKey(record?.sessionId) || null,
    transcript,
    updatedAt: record?.updatedAt ?? null,
  }
}

function getApiThreadDedupKey(record = {}) {
  return JSON.stringify({
    model: record?.model || null,
    transcript: Array.isArray(record?.transcript) ? record.transcript : [],
  })
}

function getApiThreadRichness(record) {
  return (Array.isArray(record?.transcript) ? record.transcript.length : 0) * 10 +
    countNonEmptyValues([record?.conversationId, record?.parentMessageId, record?.sessionId])
}

function trimApiThreads(threads = [], limit = MAX_CHATGPT_WEB_API_THREADS) {
  return sortByUpdatedAtDescending(
    (Array.isArray(threads) ? threads : []).filter(
      (thread) => typeof thread?.conversationId === 'string' && thread.conversationId,
    ),
    (thread) => getApiThreadDedupKey(thread),
  ).slice(0, limit)
}

function mergeApiThreadRecord(existingRecord = {}, incomingRecord = {}) {
  const normalizedExisting = normalizeApiThreadRecord(existingRecord)
  const normalizedIncoming = normalizeApiThreadRecord(incomingRecord)
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting

  const existingFreshness = toSortableTimestamp(normalizedExisting.updatedAt)
  const incomingFreshness = toSortableTimestamp(normalizedIncoming.updatedAt)
  const existingRichness = getApiThreadRichness(normalizedExisting)
  const incomingRichness = getApiThreadRichness(normalizedIncoming)
  const preferredIsIncoming =
    compareByTimestampAndRichness(
      existingFreshness,
      incomingFreshness,
      existingRichness,
      incomingRichness,
    ) <= 0
  const preferred = preferredIsIncoming ? normalizedIncoming : normalizedExisting
  const fallback = preferred === normalizedIncoming ? normalizedExisting : normalizedIncoming

  return {
    model: preferred.model ?? fallback.model ?? null,
    conversationId: preferred.conversationId || fallback.conversationId,
    parentMessageId: preferred.parentMessageId || fallback.parentMessageId,
    sessionId: pickNonEmptyString(preferred.sessionId, fallback.sessionId) || null,
    transcript: cloneJson(
      Array.isArray(preferred.transcript) && preferred.transcript.length > 0
        ? preferred.transcript
        : fallback.transcript,
    ),
    updatedAt:
      pickMaxTimestampValue(normalizedExisting.updatedAt, normalizedIncoming.updatedAt) ||
      preferred.updatedAt ||
      fallback.updatedAt ||
      null,
  }
}

function mergeApiThreads(existingThreads = [], incomingThreads = []) {
  const mergedByKey = new Map()
  for (const thread of [...(Array.isArray(existingThreads) ? existingThreads : []), ...(Array.isArray(incomingThreads) ? incomingThreads : [])]) {
    const normalizedThread = normalizeApiThreadRecord(thread)
    if (!normalizedThread) continue
    const dedupeKey = getApiThreadDedupKey(normalizedThread)
    const currentThread = mergedByKey.get(dedupeKey)
    mergedByKey.set(
      dedupeKey,
      currentThread
        ? mergeApiThreadRecord(currentThread, normalizedThread)
        : normalizedThread,
    )
  }

  return trimApiThreads([...mergedByKey.values()])
}

export function isChatgptHistoryStorageKey(key = '') {
  return (
    key === CHATGPT_WEB_CONVERSATION_INDEX_KEY ||
    key === CHATGPT_WEB_CONVERSATION_META_KEY ||
    key === CHATGPT_WEB_SESSION_SNAPSHOTS_KEY ||
    key === CHATGPT_WEB_API_THREADS_KEY ||
    key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX)
  )
}

export function filterChatgptHistoryStorageData(data = {}) {
  return Object.fromEntries(
    Object.entries(isPlainObject(data) ? data : {}).filter(([key]) => isChatgptHistoryStorageKey(key)),
  )
}

export function summarizeChatgptHistoryStorageData(data = {}) {
  const filtered = filterChatgptHistoryStorageData(data)
  const snapshotCount = Object.keys(filtered).filter((key) =>
    key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX),
  ).length
  return {
    conversationCount: countObjectKeys(filtered[CHATGPT_WEB_CONVERSATION_INDEX_KEY]),
    snapshotCount,
    sessionSnapshotCount: countObjectKeys(filtered[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]),
    apiThreadCount: Array.isArray(filtered[CHATGPT_WEB_API_THREADS_KEY])
      ? filtered[CHATGPT_WEB_API_THREADS_KEY].length
      : 0,
  }
}

function normalizeImportPayload(payload = {}) {
  if (!isPlainObject(payload)) return {}
  if (payload.scope === CHATGPT_WEB_HISTORY_EXPORT_SCOPE && isPlainObject(payload.storage)) {
    return filterChatgptHistoryStorageData(payload.storage)
  }
  if (isPlainObject(payload.storage)) {
    return filterChatgptHistoryStorageData(payload.storage)
  }
  return filterChatgptHistoryStorageData(payload)
}

export function mergeChatgptHistoryStorageData(existingData = {}, incomingData = {}) {
  const filteredExisting = filterChatgptHistoryStorageData(existingData)
  const filteredIncoming = filterChatgptHistoryStorageData(incomingData)
  const merged = {}

  merged[CHATGPT_WEB_CONVERSATION_INDEX_KEY] = mergeConversationIndexMaps(
    filteredExisting[CHATGPT_WEB_CONVERSATION_INDEX_KEY],
    filteredIncoming[CHATGPT_WEB_CONVERSATION_INDEX_KEY],
  )
  merged[CHATGPT_WEB_CONVERSATION_META_KEY] = mergeConversationMeta(
    filteredExisting[CHATGPT_WEB_CONVERSATION_META_KEY],
    filteredIncoming[CHATGPT_WEB_CONVERSATION_META_KEY],
  )
  merged[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] = mergeSessionSnapshotMaps(
    filteredExisting[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY],
    filteredIncoming[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY],
  )
  merged[CHATGPT_WEB_API_THREADS_KEY] = mergeApiThreads(
    filteredExisting[CHATGPT_WEB_API_THREADS_KEY],
    filteredIncoming[CHATGPT_WEB_API_THREADS_KEY],
  )

  const snapshotKeys = new Set([
    ...Object.keys(filteredExisting),
    ...Object.keys(filteredIncoming),
  ])

  snapshotKeys.forEach((key) => {
    if (!key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX)) return
    const mergedSnapshot = mergeConversationSnapshotRecord(filteredExisting[key], filteredIncoming[key])
    if (mergedSnapshot?.conversationId) merged[key] = mergedSnapshot
  })

  return merged
}

async function writeStorageEntries(storage, entries = []) {
  for (let index = 0; index < entries.length; index += STORAGE_WRITE_CHUNK_SIZE) {
    await storage.set(Object.fromEntries(entries.slice(index, index + STORAGE_WRITE_CHUNK_SIZE)))
  }
}

export async function exportChatgptHistoryData() {
  const storage = await getBrowserStorage()
  const allData = await storage.get(null)
  const filteredData = filterChatgptHistoryStorageData(allData)
  return {
    scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
    schemaVersion: CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    storage: filteredData,
    summary: summarizeChatgptHistoryStorageData(filteredData),
  }
}

export async function importChatgptHistoryData(payload) {
  const incomingData = normalizeImportPayload(payload)
  if (Object.keys(incomingData).length === 0) {
    throw new Error('No ChatGPT history data found in import file')
  }

  const storage = await getBrowserStorage()
  const existingAllData = await storage.get(null)
  const existingHistoryData = filterChatgptHistoryStorageData(existingAllData)
  const mergedHistoryData = mergeChatgptHistoryStorageData(existingHistoryData, incomingData)
  const entriesToWrite = Object.entries(mergedHistoryData).filter(([key, value]) => {
    return JSON.stringify(existingHistoryData[key] ?? null) !== JSON.stringify(value ?? null)
  })

  if (entriesToWrite.length > 0) {
    await writeStorageEntries(storage, entriesToWrite)
  }

  return {
    importedAt: new Date().toISOString(),
    keysWritten: entriesToWrite.length,
    before: summarizeChatgptHistoryStorageData(existingHistoryData),
    incoming: summarizeChatgptHistoryStorageData(incomingData),
    after: summarizeChatgptHistoryStorageData(mergedHistoryData),
  }
}
