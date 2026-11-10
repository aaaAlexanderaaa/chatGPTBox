// Pure history merge rules shared by import and the background index writer.
export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function stringifyKey(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function toSortableTimestamp(value) {
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

export function countObjectKeys(value) {
  return isPlainObject(value) ? Object.keys(value).length : 0
}

export function pickNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

export function pickMinTimestampValue(...values) {
  const candidates = values
    .map((value) => ({ value, sortable: toSortableTimestamp(value) }))
    .filter((candidate) => candidate.sortable > 0)
    .sort((left, right) => left.sortable - right.sortable)
  return candidates[0]?.value ?? null
}

export function pickMaxTimestampValue(...values) {
  const candidates = values
    .map((value) => ({ value, sortable: toSortableTimestamp(value) }))
    .filter((candidate) => candidate.sortable > 0)
    .sort((left, right) => right.sortable - left.sortable)
  return candidates[0]?.value ?? null
}

export function chooseValueFromNewer(
  existingValue,
  incomingValue,
  existingTimestamp,
  incomingTimestamp,
) {
  const existingDefined = existingValue !== undefined && existingValue !== null
  const incomingDefined = incomingValue !== undefined && incomingValue !== null
  if (existingDefined && !incomingDefined) return existingValue
  if (!existingDefined && incomingDefined) return incomingValue
  if (!existingDefined && !incomingDefined) return null
  return incomingTimestamp >= existingTimestamp ? incomingValue : existingValue
}

export function compareByTimestampAndRichness(
  leftTimestamp,
  rightTimestamp,
  leftRichness = 0,
  rightRichness = 0,
) {
  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp
  if (leftRichness !== rightRichness) return leftRichness - rightRichness
  return 0
}

export function getConversationIndexEntryFreshness(entry) {
  // Detail snapshot hydration does not refresh the list payload, so it must
  // not make stale `rawItem` metadata win during import merges.
  return Math.max(
    toSortableTimestamp(entry?.updateTime),
    toSortableTimestamp(entry?.lastSeenAt),
    toSortableTimestamp(entry?.createTime),
  )
}

export function normalizeConversationIndexEntry(entry = {}, fallbackId = '') {
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

export function mergeConversationIndexEntry(existingEntry = {}, incomingEntry = {}) {
  const normalizedExisting = normalizeConversationIndexEntry(existingEntry)
  const normalizedIncoming = normalizeConversationIndexEntry(
    incomingEntry,
    normalizedExisting?.id || '',
  )
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting

  const existingFreshness = getConversationIndexEntryFreshness(normalizedExisting)
  const incomingFreshness = getConversationIndexEntryFreshness(normalizedIncoming)
  const preferred = incomingFreshness >= existingFreshness ? normalizedIncoming : normalizedExisting
  const fallback = preferred === normalizedIncoming ? normalizedExisting : normalizedIncoming
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

export function mergeConversationIndexMaps(existingIndex = {}, incomingIndex = {}) {
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
