import { CHATGPT_WEB_HISTORY_HYDRATE_CIRCUIT_THRESHOLD } from '../../../config/limits.mjs'

export const CHATGPT_WEB_HYDRATE_ORDERS = Object.freeze([
  'updated',
  'updated_asc',
  'created',
  'created_asc',
])

export const CHATGPT_WEB_HYDRATE_RESUMABLE_STATUSES = Object.freeze([
  'paused',
  'failed',
  'circuit_open',
  'auth_failed',
])

export function normalizeHydrateOrder(value) {
  return CHATGPT_WEB_HYDRATE_ORDERS.includes(value) ? value : 'updated'
}

export function timestampToHydrateSortableNumber(value) {
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

export function sortHydrateIndexEntries(
  entries = {},
  { order = 'updated', includeArchived = false } = {},
) {
  const normalizedOrder = normalizeHydrateOrder(order)
  const descending = !normalizedOrder.endsWith('_asc')
  const field = String(normalizedOrder).startsWith('created') ? 'createTime' : 'updateTime'

  return Object.values(entries && typeof entries === 'object' ? entries : {})
    .filter(
      (entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id,
    )
    .filter((entry) => includeArchived === true || entry.isArchived !== true)
    .sort((left, right) => {
      const leftPrimary = timestampToHydrateSortableNumber(left?.[field] || left?.createTime)
      const rightPrimary = timestampToHydrateSortableNumber(right?.[field] || right?.createTime)
      if (leftPrimary !== rightPrimary) {
        return descending ? rightPrimary - leftPrimary : leftPrimary - rightPrimary
      }
      return String(right?.id || '').localeCompare(String(left?.id || ''))
    })
}

export function buildHydrateCandidateIds(entries, { order, includeArchived, offset = 0 } = {}) {
  const start = Math.max(0, parseInt(offset, 10) || 0)
  return sortHydrateIndexEntries(entries, { order, includeArchived })
    .slice(start)
    .map((entry) => entry.id)
}

export function needsHydrateConversationBody(indexEntry, snapshotRecord) {
  const snapshot = snapshotRecord?.snapshot
  if (!snapshot || typeof snapshot !== 'object') return true
  const indexUpdateTime = timestampToHydrateSortableNumber(indexEntry?.updateTime)
  const snapshotUpdateTime = timestampToHydrateSortableNumber(
    snapshotRecord?.updateTime ?? snapshot.update_time ?? snapshot.updateTime,
  )
  return indexUpdateTime > snapshotUpdateTime
}

export function decideHydrateAction({ needsBody, skippedFailure } = {}) {
  if (skippedFailure) return 'skip_failed'
  if (!needsBody) return 'skip_fresh'
  return 'fetch'
}

export function shouldSkipHydrateFailure(failure) {
  return failure?.skipped === true
}

export function nextHydrateConsecutiveFailures(current, succeeded) {
  return succeeded ? 0 : (Number(current) || 0) + 1
}

export function isHydrateCircuitOpen(
  consecutiveFailures,
  threshold = CHATGPT_WEB_HISTORY_HYDRATE_CIRCUIT_THRESHOLD,
) {
  return (Number(consecutiveFailures) || 0) >= threshold
}

export function isHydrateAuthStopStatus(status) {
  return status === 401 || status === 403
}

export function hydrateJobFingerprint({ order, offset, limit, includeArchived } = {}) {
  return {
    order: normalizeHydrateOrder(order),
    offset: Math.max(0, parseInt(offset, 10) || 0),
    limit: Math.max(0, parseInt(limit, 10) || 0),
    includeArchived: includeArchived === true,
  }
}

export function canResumeHydrateState(state, options = {}) {
  if (!state || typeof state !== 'object') return false
  if (!CHATGPT_WEB_HYDRATE_RESUMABLE_STATUSES.includes(state.status)) return false
  if (!Array.isArray(state.candidateIds) || state.candidateIds.length === 0) return false
  return (
    JSON.stringify(hydrateJobFingerprint(state)) === JSON.stringify(hydrateJobFingerprint(options))
  )
}

export function resolveHydrateBulkStart({ resume = false, state, options } = {}) {
  if (resume === true) return canResumeHydrateState(state, options) ? 'restore' : 'reject'
  if (state?.status === 'circuit_open') return 'circuit'
  return 'start'
}

export function listHydrateFailures(failures = {}) {
  return Object.values(failures && typeof failures === 'object' ? failures : {})
    .filter((entry) => entry && typeof entry === 'object' && entry.conversationId)
    .sort((left, right) => String(right.failedAt || '').localeCompare(String(left.failedAt || '')))
}
