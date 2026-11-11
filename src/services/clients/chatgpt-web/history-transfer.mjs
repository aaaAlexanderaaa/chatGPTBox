import { bindingSnapshotKey } from '../../session-binding.mjs'
import {
  isPlainObject,
  cloneJson,
  stringifyKey,
  toSortableTimestamp,
  countObjectKeys,
  pickNonEmptyString,
  pickMaxTimestampValue,
  compareByTimestampAndRichness,
  mergeConversationIndexMaps,
} from './history-merge.mjs'
import {
  CHATGPT_WEB_CONVERSATION_INDEX_KEY,
  CHATGPT_WEB_CONVERSATION_META_KEY,
  CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX,
  normalizeChatgptWebConversationIndexEntry,
} from './conversation-cache.mjs'
import {
  CHATGPT_WEB_API_THREADS_KEY,
  CHATGPT_WEB_SESSION_SNAPSHOTS_KEY,
  MAX_CHATGPT_WEB_API_THREADS,
  MAX_CHATGPT_WEB_SESSION_SNAPSHOTS,
  normalizeChatgptWebBridgeMessages,
} from './thread-state.mjs'

import { getChatgptWebConversationHistoryInfo } from './conversation-pages.mjs'

export const CHATGPT_WEB_HISTORY_EXPORT_SCOPE = 'chatgpt-web-history'
export const CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION = 2
export const DEFAULT_CHATGPT_HISTORY_VOLUME_MAX_BYTES = 16 * 1024 * 1024
export const CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE = 40
export const CHATGPT_WEB_HISTORY_MIXED_EXPORT_IDS_ERROR =
  'ChatGPT history volume files are from different exports'
export const CHATGPT_WEB_HISTORY_EMPTY_IMPORT_ERROR = 'No ChatGPT history data found in import file'
export const CHATGPT_WEB_HISTORY_CATALOG_KEYS = [
  CHATGPT_WEB_CONVERSATION_INDEX_KEY,
  CHATGPT_WEB_CONVERSATION_META_KEY,
  CHATGPT_WEB_SESSION_SNAPSHOTS_KEY,
  CHATGPT_WEB_API_THREADS_KEY,
]

const STORAGE_WRITE_CHUNK_SIZE = CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE
const STORAGE_READ_CHUNK_SIZE = CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE

async function getBrowserStorage() {
  const { default: Browser } = await import('webextension-polyfill')
  return Browser.storage.local
}

function getSnapshotRichness(record) {
  if (!isPlainObject(record)) return 0
  const snapshot = isPlainObject(record.snapshot) ? record.snapshot : null
  return (
    countObjectKeys(snapshot) * 100 +
    (snapshot?.mapping ? countObjectKeys(snapshot.mapping) : snapshot?.messages?.length || 0)
  )
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

function getSnapshotRevisionTimestamp(record) {
  const value = record.updateTime ?? record.snapshot?.update_time ?? record.snapshot?.updateTime
  if (typeof value === 'number' || (typeof value === 'string' && value.trim())) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric
  }
  return toSortableTimestamp(value)
}

function compareConversationSnapshotRecords(existing, incoming) {
  const existingRevision = getSnapshotRevisionTimestamp(existing)
  const incomingRevision = getSnapshotRevisionTimestamp(incoming)
  if (existingRevision > 0 && incomingRevision > 0) {
    if (existingRevision !== incomingRevision) return existingRevision - incomingRevision
    if (isPlainObject(existing.snapshot) && isPlainObject(incoming.snapshot)) {
      // Download time does not make an interrupted copy of the same server
      // revision more useful than history that has already been downloaded.
      const existingHistory = getChatgptWebConversationHistoryInfo(existing.snapshot)
      const incomingHistory = getChatgptWebConversationHistoryInfo(incoming.snapshot)
      const completeness = Number(existingHistory.complete) - Number(incomingHistory.complete)
      if (completeness) return completeness
      if (existingHistory.complete && existingHistory.scope !== incomingHistory.scope) {
        return existingHistory.scope === 'conversation_tree' ? 1 : -1
      }
      const messageCount = existingHistory.loadedMessageCount - incomingHistory.loadedMessageCount
      if (messageCount) return messageCount
    }
  }
  // Older exports can lack a server revision. Preserve their existing
  // timestamp/richness ordering, and use it to break equal-coverage ties.
  return compareByTimestampAndRichness(
    Math.max(toSortableTimestamp(existing.updateTime), toSortableTimestamp(existing.cachedAt)),
    Math.max(toSortableTimestamp(incoming.updateTime), toSortableTimestamp(incoming.cachedAt)),
    getSnapshotRichness(existing),
    getSnapshotRichness(incoming),
  )
}

function mergeConversationSnapshotRecord(existingRecord = {}, incomingRecord = {}) {
  const normalizedExisting = normalizeConversationSnapshotRecord(existingRecord)
  const normalizedIncoming = normalizeConversationSnapshotRecord(
    incomingRecord,
    normalizedExisting?.conversationId || '',
  )
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting

  const preferredIsIncoming =
    compareConversationSnapshotRecords(normalizedExisting, normalizedIncoming) <= 0
  const preferred = preferredIsIncoming ? normalizedIncoming : normalizedExisting
  const fallback = preferred === normalizedIncoming ? normalizedExisting : normalizedIncoming
  return {
    ...preferred,
    conversationId: preferred.conversationId || fallback.conversationId,
    source: pickNonEmptyString(preferred.source, fallback.source) || null,
    snapshot: cloneJson(preferred.snapshot || fallback.snapshot || null),
  }
}

function mergeConversationMeta(existingMeta = {}) {
  const existing = isPlainObject(existingMeta) ? existingMeta : {}
  return {
    // Sync bookkeeping belongs to the current browser/account context.
    // Imports should not mark remote state as freshly synced.
    ...existing,
    lastSyncAt: existing.lastSyncAt ?? null,
    lastArchivedSyncAt: existing.lastArchivedSyncAt ?? null,
    lastSyncError: existing.lastSyncError ?? null,
    lastSyncItemCount: Number.isFinite(existing.lastSyncItemCount)
      ? Number(existing.lastSyncItemCount)
      : 0,
    lastIncrementalSyncAt: existing.lastIncrementalSyncAt ?? null,
    adaptiveSyncIntervalHours: Number(existing.adaptiveSyncIntervalHours) || 6,
    safetyLock: existing.safetyLock ?? null,
    syncState: existing.syncState ?? { status: 'idle' },
    requestStats: existing.requestStats ?? {
      total: 0,
      automatic: 0,
      manual: 0,
      list: 0,
      detail: 0,
      rateLimited: 0,
      hourly: {},
      recent: [],
    },
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
      (snapshot) => bindingSnapshotKey(snapshot),
    )
      .slice(0, limit)
      .map((snapshot) => [bindingSnapshotKey(snapshot), snapshot]),
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
    remoteBindingGeneration: record.remoteBindingGeneration || null,
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

  const remoteFallback =
    preferred.conversationId &&
    fallback.conversationId &&
    preferred.conversationId !== fallback.conversationId
      ? {}
      : fallback
  return {
    sessionId: preferred.sessionId || fallback.sessionId,
    remoteBindingGeneration: preferred.remoteBindingGeneration || null,
    conversationId: pickNonEmptyString(preferred.conversationId, fallback.conversationId) || null,
    parentMessageId:
      pickNonEmptyString(preferred.parentMessageId, remoteFallback.parentMessageId) || null,
    messageId: pickNonEmptyString(preferred.messageId, remoteFallback.messageId) || null,
    wsRequestId: pickNonEmptyString(preferred.wsRequestId, remoteFallback.wsRequestId) || null,
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
  for (const record of [...Object.values(existingEntries), ...Object.values(incomingEntries)]) {
    const snapshot = normalizeSessionSnapshotRecord(record)
    if (!snapshot) continue
    const key = bindingSnapshotKey(snapshot)
    merged[key] = mergeSessionSnapshotRecord(merged[key], snapshot)
  }

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
  return (
    (Array.isArray(record?.transcript) ? record.transcript.length : 0) * 10 +
    countNonEmptyValues([record?.conversationId, record?.parentMessageId, record?.sessionId])
  )
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
  for (const thread of [
    ...(Array.isArray(existingThreads) ? existingThreads : []),
    ...(Array.isArray(incomingThreads) ? incomingThreads : []),
  ]) {
    const normalizedThread = normalizeApiThreadRecord(thread)
    if (!normalizedThread) continue
    const dedupeKey = getApiThreadDedupKey(normalizedThread)
    const currentThread = mergedByKey.get(dedupeKey)
    mergedByKey.set(
      dedupeKey,
      currentThread ? mergeApiThreadRecord(currentThread, normalizedThread) : normalizedThread,
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
    Object.entries(isPlainObject(data) ? data : {}).filter(([key]) =>
      isChatgptHistoryStorageKey(key),
    ),
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

export function summarizeChatgptHistoryLibrary(index, snapshotKeys = [], meta = {}) {
  const entries = isPlainObject(index) ? index : {}
  const conversationIds = Object.keys(entries)
  const snapshotKeyList = Array.isArray(snapshotKeys)
    ? snapshotKeys
    : snapshotKeys instanceof Set
    ? [...snapshotKeys]
    : []
  const snapshotIdSet = new Set(
    snapshotKeyList
      .map((key) => {
        const text = String(key || '')
        return text.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX)
          ? text.slice(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX.length)
          : ''
      })
      .filter(Boolean),
  )
  const indexIdSet = new Set(conversationIds)

  let activeCount = 0
  let archivedCount = 0
  let missingActiveBodyCount = 0
  let missingArchivedBodyCount = 0

  for (const id of conversationIds) {
    const archived = entries[id]?.isArchived === true
    if (archived) archivedCount += 1
    else activeCount += 1
    if (!snapshotIdSet.has(id)) {
      if (archived) missingArchivedBodyCount += 1
      else missingActiveBodyCount += 1
    }
  }

  return {
    conversationCount: conversationIds.length,
    activeCount,
    archivedCount,
    snapshotCount: snapshotIdSet.size,
    missingBodyCount: missingActiveBodyCount + missingArchivedBodyCount,
    missingActiveBodyCount,
    missingArchivedBodyCount,
    extraSnapshotCount: [...snapshotIdSet].filter((id) => !indexIdSet.has(id)).length,
    lastSyncAt: meta?.lastSyncAt ?? null,
    lastArchivedSyncAt: meta?.lastArchivedSyncAt ?? null,
    lastIncrementalSyncAt: meta?.lastIncrementalSyncAt ?? null,
    lastHydrateAt: meta?.hydrateState?.completedAt ?? null,
  }
}

function collectSnapshotKeys(data = {}) {
  return Object.keys(filterChatgptHistoryStorageData(data)).filter((key) =>
    key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX),
  )
}

export function summarizeChatgptHistoryExport(data = {}) {
  const filtered = filterChatgptHistoryStorageData(data)
  const snapshots = collectSnapshotKeys(filtered).map((key) => filtered[key]?.snapshot)
  const partialSnapshotCount = snapshots.filter(
    (snapshot) => snapshot && !getChatgptWebConversationHistoryInfo(snapshot).complete,
  ).length
  return {
    ...summarizeChatgptHistoryStorageData(filtered),
    ...summarizeChatgptHistoryLibrary(
      filtered[CHATGPT_WEB_CONVERSATION_INDEX_KEY],
      collectSnapshotKeys(filtered),
      filtered[CHATGPT_WEB_CONVERSATION_META_KEY],
    ),
    partialSnapshotCount,
    currentBranchSnapshotCount: snapshots.filter((snapshot) => Array.isArray(snapshot?.messages))
      .length,
  }
}

export function normalizeImportPayload(payload = {}) {
  if (!isPlainObject(payload)) return {}
  // Keep backups made by the former API Server "Export Cache" button readable.
  if (
    payload.version === 1 &&
    isPlainObject(payload.data?.index) &&
    isPlainObject(payload.data?.snapshots)
  ) {
    return {
      [CHATGPT_WEB_CONVERSATION_INDEX_KEY]: payload.data.index,
      [CHATGPT_WEB_CONVERSATION_META_KEY]: payload.data.meta || {},
      ...Object.fromEntries(
        Object.entries(payload.data.snapshots).map(([id, record]) => [
          `${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`,
          record,
        ]),
      ),
    }
  }
  if (payload.scope === CHATGPT_WEB_HISTORY_EXPORT_SCOPE && isPlainObject(payload.storage)) {
    return filterChatgptHistoryStorageData(payload.storage)
  }
  if (isPlainObject(payload.storage)) {
    return filterChatgptHistoryStorageData(payload.storage)
  }
  return filterChatgptHistoryStorageData(payload)
}

function collectImportPayloads(payload) {
  return Array.isArray(payload) ? payload : [payload]
}

function assertSameHistoryExportId(payloads = []) {
  const exportIds = new Set()
  for (const item of payloads) {
    if (isPlainObject(item) && typeof item.exportId === 'string' && item.exportId.trim()) {
      exportIds.add(item.exportId.trim())
    }
  }
  if (exportIds.size > 1) {
    throw new Error(CHATGPT_WEB_HISTORY_MIXED_EXPORT_IDS_ERROR)
  }
}

export function getCompactJsonSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function createStorageSizeAccountant() {
  const valueSizes = new Map()
  return {
    remember(key, value) {
      valueSizes.set(key, getCompactJsonSize(value))
    },
    sizeOf(keys) {
      if (keys.length === 0) return 2
      let size = 1
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) size += 1
        size += getCompactJsonSize(keys[index]) + 1 + (valueSizes.get(keys[index]) || 0)
      }
      return size + 1
    },
  }
}

export function packChatgptHistoryStorageIntoVolumeMaps(
  storageData = {},
  { maxVolumeBytes = DEFAULT_CHATGPT_HISTORY_VOLUME_MAX_BYTES, envelopeOverhead = 0 } = {},
) {
  const filtered = filterChatgptHistoryStorageData(storageData)
  const accountant = createStorageSizeAccountant()
  const catalogKeys = CHATGPT_WEB_HISTORY_CATALOG_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(filtered, key),
  )
  const snapshotKeys = Object.keys(filtered)
    .filter((key) => key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX))
    .sort()

  for (const key of [...catalogKeys, ...snapshotKeys]) {
    accountant.remember(key, filtered[key])
  }

  const storageBudget = Math.max(2, maxVolumeBytes - Math.max(0, envelopeOverhead))
  const volumes = []
  const pushVolume = (keys) => {
    volumes.push(Object.fromEntries(keys.map((key) => [key, filtered[key]])))
  }

  let currentKeys = [...catalogKeys]
  for (const key of snapshotKeys) {
    const proposed = [...currentKeys, key]
    const proposedSize = accountant.sizeOf(proposed)
    if (proposedSize <= storageBudget || currentKeys.length === 0) {
      currentKeys = proposed
      continue
    }
    pushVolume(currentKeys)
    currentKeys = [key]
  }
  if (currentKeys.length > 0 || volumes.length === 0) {
    pushVolume(currentKeys)
  }
  return volumes
}

function createHistoryExportId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `export-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function estimateVolumeEnvelopeOverhead({ exportedAt, exportId, summary }) {
  return (
    getCompactJsonSize({
      scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
      schemaVersion: CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION,
      exportedAt,
      exportId,
      volume: { index: 1, count: 1 },
      storage: {},
      summary,
    }) - 2
  )
}

export function buildChatgptHistoryVolumePayloads(
  storageData = {},
  {
    maxVolumeBytes = DEFAULT_CHATGPT_HISTORY_VOLUME_MAX_BYTES,
    exportId = createHistoryExportId(),
    exportedAt = new Date().toISOString(),
    summary = summarizeChatgptHistoryExport(storageData),
  } = {},
) {
  const storageMaps = packChatgptHistoryStorageIntoVolumeMaps(storageData, {
    maxVolumeBytes,
    envelopeOverhead: estimateVolumeEnvelopeOverhead({ exportedAt, exportId, summary }),
  })
  return storageMaps.map((storage, index) => ({
    scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
    schemaVersion: CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION,
    exportedAt,
    exportId,
    volume: { index: index + 1, count: storageMaps.length },
    storage,
    summary,
  }))
}

/**
 * List ChatGPT history keys without `storage.get(null)`.
 *
 * Prefer `storage.getKeys()` when the browser provides it. Fallback: known
 * catalog keys plus snapshot keys derived from the conversation index.
 * Limitation of the fallback: extra snapshots whose ids are not in the index
 * are missed, because discovering them would require dumping all storage.
 */
export async function listChatgptHistoryStorageKeys(storage) {
  if (typeof storage.getKeys === 'function') {
    const keys = await storage.getKeys()
    return [...new Set((Array.isArray(keys) ? keys : []).filter(isChatgptHistoryStorageKey))]
  }

  const indexResult = await storage.get([CHATGPT_WEB_CONVERSATION_INDEX_KEY])
  const index = isPlainObject(indexResult?.[CHATGPT_WEB_CONVERSATION_INDEX_KEY])
    ? indexResult[CHATGPT_WEB_CONVERSATION_INDEX_KEY]
    : {}
  const snapshotKeys = Object.keys(index)
    .map((id) => stringifyKey(id))
    .filter(Boolean)
    .map((id) => `${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`)
  return [...new Set([...CHATGPT_WEB_HISTORY_CATALOG_KEYS, ...snapshotKeys])]
}

async function readStorageEntries(storage, keys = []) {
  const uniqueKeys = [...new Set(keys)]
  const result = {}
  for (let index = 0; index < uniqueKeys.length; index += STORAGE_READ_CHUNK_SIZE) {
    const chunk = uniqueKeys.slice(index, index + STORAGE_READ_CHUNK_SIZE)
    if (chunk.length === 0) continue
    const data = await storage.get(chunk)
    if (isPlainObject(data)) Object.assign(result, data)
  }
  return result
}

async function readChatgptHistoryStorageData(storage) {
  const keys = await listChatgptHistoryStorageKeys(storage)
  return filterChatgptHistoryStorageData(await readStorageEntries(storage, keys))
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

  const snapshotKeys = new Set([...Object.keys(filteredExisting), ...Object.keys(filteredIncoming)])

  snapshotKeys.forEach((key) => {
    if (!key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX)) return
    const mergedSnapshot = mergeConversationSnapshotRecord(
      filteredExisting[key],
      filteredIncoming[key],
    )
    if (mergedSnapshot?.conversationId) merged[key] = mergedSnapshot
  })

  return merged
}

async function writeStorageEntries(storage, entries = []) {
  for (let index = 0; index < entries.length; index += STORAGE_WRITE_CHUNK_SIZE) {
    await storage.set(Object.fromEntries(entries.slice(index, index + STORAGE_WRITE_CHUNK_SIZE)))
  }
}

export async function getChatgptHistoryLibraryStats() {
  const storage = await getBrowserStorage()
  const catalog = await storage.get([
    CHATGPT_WEB_CONVERSATION_INDEX_KEY,
    CHATGPT_WEB_CONVERSATION_META_KEY,
  ])
  const index = catalog[CHATGPT_WEB_CONVERSATION_INDEX_KEY] || {}
  const hasKeyDiscovery = typeof storage.getKeys === 'function'
  const keys = hasKeyDiscovery
    ? await storage.getKeys()
    : Object.entries(index)
        .filter(([, entry]) => entry?.snapshotCachedAt)
        .map(([id]) => `${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`)
  const snapshotKeys = keys.filter((key) =>
    key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX),
  )
  let partialSnapshotCount = 0,
    currentBranchSnapshotCount = 0,
    unknownCoverageSnapshotCount = 0
  for (const key of snapshotKeys) {
    const entry = index[key.slice(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX.length)]
    if (typeof entry?.snapshotHistoryComplete !== 'boolean') unknownCoverageSnapshotCount += 1
    else if (!entry.snapshotHistoryComplete) partialSnapshotCount += 1
    if (entry?.snapshotHistoryScope === 'current_branch') currentBranchSnapshotCount += 1
  }
  return {
    ...summarizeChatgptHistoryLibrary(
      index,
      snapshotKeys,
      catalog[CHATGPT_WEB_CONVERSATION_META_KEY],
    ),
    partialSnapshotCount,
    currentBranchSnapshotCount,
    unknownCoverageSnapshotCount,
    snapshotCountEstimated: !hasKeyDiscovery,
  }
}

export async function buildChatgptHistoryExportVolumes({
  maxVolumeBytes = DEFAULT_CHATGPT_HISTORY_VOLUME_MAX_BYTES,
  conversationIds,
} = {}) {
  const storage = await getBrowserStorage()
  let historyData
  if (conversationIds !== undefined) {
    if (
      !Array.isArray(conversationIds) ||
      !conversationIds.length ||
      conversationIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new Error('Select at least one conversation to export')
    }
    const ids = [...new Set(conversationIds.map((id) => id.trim()))]
    const selected = await readStorageEntries(
      storage,
      ids.map((id) => `${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`),
    )
    const catalog = await storage.get([CHATGPT_WEB_CONVERSATION_INDEX_KEY])
    const index = catalog[CHATGPT_WEB_CONVERSATION_INDEX_KEY] || {}
    const entries = Object.create(null)
    for (const id of ids) {
      const record = selected[`${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`]
      if (!record?.snapshot) throw new Error('Conversation body is not cached')
      if (
        (record.conversationId && record.conversationId !== id) ||
        (record.snapshot.conversation_id && record.snapshot.conversation_id !== id)
      ) {
        throw new Error('Conversation response ID does not match')
      }
      entries[id] =
        index[id] ||
        normalizeChatgptWebConversationIndexEntry({
          id,
          title: record.snapshot.title,
          create_time: record.snapshot.create_time,
          update_time: record.snapshot.update_time,
          async_status: record.snapshot.async_status,
          is_archived: record.snapshot.is_archived,
          is_starred: record.snapshot.is_starred,
        })
    }
    historyData = { [CHATGPT_WEB_CONVERSATION_INDEX_KEY]: entries, ...selected }
  } else {
    historyData = await readChatgptHistoryStorageData(storage)
  }
  const summary = summarizeChatgptHistoryExport(historyData)
  const exportId = createHistoryExportId()
  const exportedAt = new Date().toISOString()
  const volumes = buildChatgptHistoryVolumePayloads(historyData, {
    maxVolumeBytes,
    exportId,
    exportedAt,
    summary,
  })
  return { exportId, volumes, summary }
}

export async function exportChatgptHistoryData(options = {}) {
  return buildChatgptHistoryExportVolumes(options)
}

// File exports use two bounded passes: measure individual records, then read
// and hand off one volume at a time. The in-memory API above remains useful
// for selected-conversation clipboard exports.
export async function streamChatgptHistoryExport({
  writeVolume,
  maxVolumeBytes = DEFAULT_CHATGPT_HISTORY_VOLUME_MAX_BYTES,
} = {}) {
  if (typeof writeVolume !== 'function') throw new Error('A volume writer is required')
  const storage = await getBrowserStorage()
  const keys = await listChatgptHistoryStorageKeys(storage)
  const catalog = await storage.get(CHATGPT_WEB_HISTORY_CATALOG_KEYS)
  const catalogKeys = CHATGPT_WEB_HISTORY_CATALOG_KEYS.filter((key) => Object.hasOwn(catalog, key))
  const accountant = createStorageSizeAccountant()
  for (const key of catalogKeys) accountant.remember(key, catalog[key])
  const snapshotKeys = []
  let partialSnapshotCount = 0,
    currentBranchSnapshotCount = 0
  for (const key of keys
    .filter((key) => key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX))
    .sort()) {
    const data = await storage.get([key])
    if (!Object.hasOwn(data, key)) continue
    snapshotKeys.push(key)
    accountant.remember(key, data[key])
    const snapshot = data[key]?.snapshot
    if (snapshot && !getChatgptWebConversationHistoryInfo(snapshot).complete)
      partialSnapshotCount += 1
    if (Array.isArray(snapshot?.messages)) currentBranchSnapshotCount += 1
  }
  const summary = {
    ...summarizeChatgptHistoryStorageData(catalog),
    ...summarizeChatgptHistoryLibrary(
      catalog[CHATGPT_WEB_CONVERSATION_INDEX_KEY],
      snapshotKeys,
      catalog[CHATGPT_WEB_CONVERSATION_META_KEY],
    ),
    partialSnapshotCount,
    currentBranchSnapshotCount,
  }
  const exportId = createHistoryExportId()
  const exportedAt = new Date().toISOString()
  const budget = Math.max(
    2,
    maxVolumeBytes - estimateVolumeEnvelopeOverhead({ exportId, exportedAt, summary }) - 32,
  )
  const groups = []
  let current = [...catalogKeys]
  for (const key of snapshotKeys) {
    if (current.length && accountant.sizeOf([...current, key]) > budget) {
      groups.push(current)
      current = []
    }
    current.push(key)
  }
  if (current.length || !groups.length) groups.push(current)
  for (let index = 0; index < groups.length; index += 1) {
    const volumeStorage = {}
    for (const key of groups[index]) {
      if (Object.hasOwn(catalog, key)) volumeStorage[key] = catalog[key]
      else {
        const data = await storage.get([key])
        if (!Object.hasOwn(data, key))
          throw new Error(
            'History changed during export. Export again while backups and chats are idle.',
          )
        volumeStorage[key] = data[key]
      }
    }
    await writeVolume({
      scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
      schemaVersion: CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION,
      exportedAt,
      exportId,
      volume: { index: index + 1, count: groups.length },
      storage: volumeStorage,
      summary,
    })
  }
  return { exportId, summary, volumeCount: groups.length }
}

export async function importChatgptHistoryData(payload) {
  const payloads = collectImportPayloads(payload)
  assertSameHistoryExportId(payloads)

  let incomingData = {}
  let foundHistory = false
  for (const item of payloads) {
    const part = normalizeImportPayload(item)
    if (Object.keys(part).length === 0) continue
    foundHistory = true
    incomingData = mergeChatgptHistoryStorageData(incomingData, part)
  }
  if (!foundHistory) {
    throw new Error(CHATGPT_WEB_HISTORY_EMPTY_IMPORT_ERROR)
  }

  const storage = await getBrowserStorage()
  const existingHistoryData = await readChatgptHistoryStorageData(storage)
  const mergedHistoryData = mergeChatgptHistoryStorageData(existingHistoryData, incomingData)
  let indexWritten = false
  if (incomingData[CHATGPT_WEB_CONVERSATION_INDEX_KEY]) {
    const { mutateChatgptWebConversationIndex } = await import('./conversation-cache.mjs')
    const result = await mutateChatgptWebConversationIndex('mergeImport', {
      entries: incomingData[CHATGPT_WEB_CONVERSATION_INDEX_KEY],
    })
    mergedHistoryData[CHATGPT_WEB_CONVERSATION_INDEX_KEY] = result.entries
    indexWritten =
      JSON.stringify(existingHistoryData[CHATGPT_WEB_CONVERSATION_INDEX_KEY] || {}) !==
      JSON.stringify(result.entries)
  }
  const entriesToWrite = Object.entries(mergedHistoryData).filter(([key, value]) => {
    if (key === CHATGPT_WEB_CONVERSATION_INDEX_KEY) return false
    return JSON.stringify(existingHistoryData[key] ?? null) !== JSON.stringify(value ?? null)
  })

  if (entriesToWrite.length > 0) {
    await writeStorageEntries(storage, entriesToWrite)
  }

  return {
    importedAt: new Date().toISOString(),
    keysWritten: entriesToWrite.length + Number(indexWritten),
    before: summarizeChatgptHistoryExport(existingHistoryData),
    incoming: summarizeChatgptHistoryExport(incomingData),
    after: summarizeChatgptHistoryExport(mergedHistoryData),
  }
}
