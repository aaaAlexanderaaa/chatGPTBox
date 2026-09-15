import {
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
} from '../../../config/limits.mjs'
import { getUserConfig } from '../../../config/storage.mjs'
import {
  getCachedChatgptWebConversationRecord,
  getChatgptWebConversationIndex,
  getChatgptWebConversationMeta,
  updateChatgptWebConversationMeta,
} from './conversation-cache.mjs'
import {
  fetchChatgptWebConversationSnapshotForHydrate,
  stopChatgptWebConversationCacheSync,
  syncChatgptWebConversationCache,
} from './conversation-api.mjs'
import {
  buildHydrateCandidateIds,
  decideHydrateAction,
  hydrateJobFingerprint,
  isHydrateAuthStopStatus,
  isHydrateCircuitOpen,
  needsHydrateConversationBody,
  nextHydrateConsecutiveFailures,
  normalizeHydrateOrder,
  resolveHydrateBulkStart,
  shouldSkipHydrateFailure,
} from './conversation-hydrate-policy.mjs'

let activeHydrateJob = null
let activeHydrateRetry = null
let hydrateCancelRequested = false

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function createAbortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function createHydrateError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeHydrateFailures(failures = {}) {
  return failures && typeof failures === 'object' && !Array.isArray(failures) ? { ...failures } : {}
}

function resolveChatgptWebHydrateOptions(config = {}, payload = {}) {
  return {
    refreshListFirst: payload.refreshListFirst === true,
    includeArchived:
      payload.includeArchived === true ||
      (payload.includeArchived == null && config.chatgptWebHistoryHydrateIncludeArchived === true),
    order: normalizeHydrateOrder(payload.order || config.chatgptWebHistoryHydrateOrder),
    offset: clampInt(
      payload.offset ?? config.chatgptWebHistoryHydrateOffset,
      DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
      0,
      100000,
    ),
    limit: clampInt(
      payload.limit ?? config.chatgptWebHistoryHydrateLimit,
      DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
      0,
      100000,
    ),
    retryCount: clampInt(
      payload.retryCount ?? config.chatgptWebHistoryHydrateRetryCount,
      DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
      0,
      5,
    ),
    resume: payload.resume === true,
    automatic: payload.automatic === true,
  }
}

async function assertHistoryEnabled() {
  const config = await getUserConfig().catch(() => ({}))
  if (config.chatgptWebHistorySyncEnabled !== true) {
    throw createHydrateError(
      'CHATGPT_HISTORY_SYNC_DISABLED',
      'ChatGPT history synchronization is disabled in settings',
    )
  }
  return config
}

async function assertHydrateSafetyLockClear() {
  const meta = await getChatgptWebConversationMeta()
  if (meta?.safetyLock?.reason === 'rate_limited') {
    const error = createHydrateError(
      'CHATGPT_HISTORY_RATE_LIMITED',
      'ChatGPT history synchronization is paused after HTTP 429; review the settings and unlock it manually',
    )
    error.status = 429
    throw error
  }
  return meta
}

async function hydrateShouldAbort() {
  if (!activeHydrateJob) return false
  if (hydrateCancelRequested) return true
  const meta = await getChatgptWebConversationMeta()
  return meta?.hydrateState?.status === 'pause_requested'
}

async function throwIfHydrateCancelled() {
  if (await hydrateShouldAbort()) throw createAbortError()
}

function createHydrateState(options, extras = {}) {
  return {
    ...hydrateJobFingerprint(options),
    status: extras.status || 'running',
    candidateIds: extras.candidateIds || [],
    nextIndex: extras.nextIndex || 0,
    fetchedCount: extras.fetchedCount || 0,
    hydrated: extras.hydrated || 0,
    skippedFresh: extras.skippedFresh || 0,
    skippedFailed: extras.skippedFailed || 0,
    failed: extras.failed || 0,
    consecutiveFailures: extras.consecutiveFailures || 0,
    currentConversationId: extras.currentConversationId || null,
    phase: extras.phase || 'hydrate',
    lastError: extras.lastError || null,
    startedAt: extras.startedAt || new Date().toISOString(),
    updatedAt: extras.updatedAt || new Date().toISOString(),
    completedAt: extras.completedAt || null,
    pausedAt: extras.pausedAt || null,
  }
}

async function persistHydrateState(partial, extras = {}) {
  return await updateChatgptWebConversationMeta((meta) => {
    const current = meta.hydrateState || {}
    const nextStatus = Object.prototype.hasOwnProperty.call(partial, 'status')
      ? partial.status
      : current.status
    const status =
      current.status === 'pause_requested' && nextStatus === 'running'
        ? 'pause_requested'
        : nextStatus
    return {
      ...meta,
      lastHydrateError:
        extras.lastHydrateError === undefined ? meta.lastHydrateError : extras.lastHydrateError,
      hydrateFailures:
        extras.hydrateFailures === undefined ? meta.hydrateFailures : extras.hydrateFailures,
      hydrateState: {
        ...current,
        ...partial,
        status,
        updatedAt: new Date().toISOString(),
      },
    }
  })
}

async function persistHydrateProgress(partial, extras = {}) {
  const meta = await persistHydrateState({ status: 'running', ...partial }, extras)
  if (hydrateCancelRequested || meta?.hydrateState?.status === 'pause_requested') {
    throw createAbortError()
  }
  return meta
}

function recordHydrateFailure(failures, { conversationId, title, error, attempts }) {
  return {
    ...normalizeHydrateFailures(failures),
    [conversationId]: {
      conversationId,
      title: typeof title === 'string' ? title : '',
      error: error?.message || String(error || 'unknown error'),
      status: error?.status || null,
      code: error?.code || null,
      attempts,
      skipped: true,
      failedAt: new Date().toISOString(),
    },
  }
}

async function hydrateConversationWithRetries(conversationId, retryCount) {
  const attempts = Math.max(1, retryCount + 1)
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await throwIfHydrateCancelled()
    try {
      await fetchChatgptWebConversationSnapshotForHydrate(conversationId, {
        shouldAbort: hydrateShouldAbort,
      })
      return { ok: true, attempts: attempt + 1 }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      lastError = error
      if (error?.code === 'CHATGPT_HISTORY_RATE_LIMITED' || error?.status === 429) throw error
      if (isHydrateAuthStopStatus(error?.status)) throw error
      await throwIfHydrateCancelled()
    }
  }
  return { ok: false, attempts, error: lastError }
}

async function refreshListForHydrate(includeArchived) {
  await persistHydrateProgress({ phase: 'list_refresh' })
  try {
    await syncChatgptWebConversationCache({
      includeArchived,
      mode: 'full',
      automatic: false,
      reason: 'hydrate_refresh_list',
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      await throwIfHydrateCancelled()
      return
    }
    throw error
  }
  await throwIfHydrateCancelled()
}

function snapshotProgress(state) {
  return {
    nextIndex: state.nextIndex,
    fetchedCount: state.fetchedCount,
    hydrated: state.hydrated,
    skippedFresh: state.skippedFresh,
    skippedFailed: state.skippedFailed,
    failed: state.failed,
    consecutiveFailures: state.consecutiveFailures,
  }
}

function createHydrateBusyError() {
  return createHydrateError(
    'CHATGPT_HISTORY_HYDRATE_BUSY',
    'A conversation content backup is already running',
  )
}

export async function reconcileChatgptWebHydrateState() {
  if (activeHydrateJob) return await getChatgptWebConversationMeta()
  const pausedAt = new Date().toISOString()
  return await updateChatgptWebConversationMeta((meta) => {
    const status = meta?.hydrateState?.status
    if (status !== 'running' && status !== 'pause_requested') return meta
    return {
      ...meta,
      hydrateState: {
        ...(meta.hydrateState || {}),
        status: 'paused',
        pausedAt,
        updatedAt: pausedAt,
      },
    }
  })
}

export async function runChatgptWebConversationHydrate(payload = {}) {
  if (activeHydrateJob) return await activeHydrateJob
  if (activeHydrateRetry) throw createHydrateBusyError()

  await reconcileChatgptWebHydrateState()
  hydrateCancelRequested = false
  activeHydrateJob = (async () => {
    const config = await assertHistoryEnabled()
    await assertHydrateSafetyLockClear()
    const options = resolveChatgptWebHydrateOptions(config, payload)
    if (options.automatic === true) {
      throw createHydrateError(
        'CHATGPT_HISTORY_HYDRATE_AUTOMATIC_FORBIDDEN',
        'Content backup cannot run automatically',
      )
    }

    const previousMeta = await getChatgptWebConversationMeta()
    const bulkStart = resolveHydrateBulkStart({
      resume: options.resume,
      state: previousMeta.hydrateState,
      options,
    })
    if (bulkStart === 'circuit') {
      throw createHydrateError(
        'CHATGPT_HISTORY_HYDRATE_CIRCUIT_OPEN',
        'Content backup is paused after repeated failures. Resume the same job or reset the circuit first.',
      )
    }
    if (bulkStart === 'reject') {
      throw createHydrateError(
        'CHATGPT_HISTORY_HYDRATE_RESUME_MISMATCH',
        'Cannot resume: current backup settings do not match the paused job. Start a new backup or restore the previous settings.',
      )
    }

    try {
      if (bulkStart === 'start' && options.refreshListFirst) {
        await refreshListForHydrate(options.includeArchived)
      }
      await throwIfHydrateCancelled()

      const index = await getChatgptWebConversationIndex()
      const startedAt = new Date().toISOString()
      const previous = previousMeta.hydrateState || {}
      const progress =
        bulkStart === 'restore'
          ? {
              candidateIds: previous.candidateIds,
              nextIndex: Number(previous.nextIndex) || 0,
              fetchedCount: Number(previous.fetchedCount) || 0,
              hydrated: Number(previous.hydrated) || 0,
              skippedFresh: Number(previous.skippedFresh) || 0,
              skippedFailed: Number(previous.skippedFailed) || 0,
              failed: Number(previous.failed) || 0,
              consecutiveFailures: Number(previous.consecutiveFailures) || 0,
              startedAt: previous.startedAt || startedAt,
            }
          : {
              candidateIds: buildHydrateCandidateIds(index, options),
              nextIndex: 0,
              fetchedCount: 0,
              hydrated: 0,
              skippedFresh: 0,
              skippedFailed: 0,
              failed: 0,
              consecutiveFailures: 0,
              startedAt,
            }

      let failures = normalizeHydrateFailures(previousMeta.hydrateFailures)
      await persistHydrateProgress(createHydrateState(options, { ...progress, phase: 'hydrate' }), {
        lastHydrateError: null,
        hydrateFailures: failures,
      })

      while (progress.nextIndex < progress.candidateIds.length) {
        await throwIfHydrateCancelled()
        if (options.limit > 0 && progress.fetchedCount >= options.limit) break

        const conversationId = progress.candidateIds[progress.nextIndex]
        const indexEntry = index[conversationId] || { id: conversationId }
        const cached = await getCachedChatgptWebConversationRecord(conversationId)
        const action = decideHydrateAction({
          needsBody: needsHydrateConversationBody(indexEntry, cached),
          skippedFailure: shouldSkipHydrateFailure(failures[conversationId]),
        })

        if (action !== 'fetch') {
          if (action === 'skip_failed') progress.skippedFailed += 1
          else progress.skippedFresh += 1
          progress.nextIndex += 1
          await persistHydrateProgress({
            phase: 'hydrate',
            currentConversationId: conversationId,
            ...snapshotProgress(progress),
          })
          continue
        }

        const result = await hydrateConversationWithRetries(conversationId, options.retryCount)
        progress.fetchedCount += 1
        if (result.ok) {
          progress.hydrated += 1
          progress.consecutiveFailures = nextHydrateConsecutiveFailures(
            progress.consecutiveFailures,
            true,
          )
          delete failures[conversationId]
        } else {
          progress.failed += 1
          progress.consecutiveFailures = nextHydrateConsecutiveFailures(
            progress.consecutiveFailures,
            false,
          )
          failures = recordHydrateFailure(failures, {
            conversationId,
            title: indexEntry.title,
            error: result.error,
            attempts: result.attempts,
          })
        }

        progress.nextIndex += 1
        await persistHydrateProgress(
          {
            phase: 'hydrate',
            currentConversationId: conversationId,
            ...snapshotProgress(progress),
          },
          {
            hydrateFailures: failures,
            lastHydrateError: result.ok ? null : result.error?.message,
          },
        )

        if (!result.ok && isHydrateCircuitOpen(progress.consecutiveFailures)) {
          await persistHydrateState(
            {
              status: 'circuit_open',
              lastError: result.error?.message || 'consecutive hydrate failures',
              pausedAt: new Date().toISOString(),
            },
            {
              hydrateFailures: failures,
              lastHydrateError: result.error?.message || 'consecutive hydrate failures',
            },
          )
          return await getChatgptWebConversationMeta()
        }
      }

      await persistHydrateState(
        {
          status: 'complete',
          currentConversationId: null,
          ...snapshotProgress(progress),
          completedAt: new Date().toISOString(),
          lastError: null,
        },
        { lastHydrateError: null, hydrateFailures: failures },
      )
      return await getChatgptWebConversationMeta()
    } catch (error) {
      if (error?.name === 'AbortError') {
        await persistHydrateState({
          status: 'paused',
          pausedAt: new Date().toISOString(),
          lastError: null,
        })
        return await getChatgptWebConversationMeta()
      }
      if (isHydrateAuthStopStatus(error?.status)) {
        await persistHydrateState(
          {
            status: 'auth_failed',
            lastError: error.message,
            pausedAt: new Date().toISOString(),
          },
          { lastHydrateError: error.message },
        )
        throw error
      }
      await persistHydrateState(
        {
          status: 'failed',
          lastError: error?.message || String(error),
        },
        { lastHydrateError: error?.message || String(error) },
      )
      throw error
    }
  })()

  try {
    return await activeHydrateJob
  } finally {
    hydrateCancelRequested = false
    activeHydrateJob = null
  }
}

export async function stopChatgptWebConversationHydrate() {
  if (!activeHydrateJob) {
    hydrateCancelRequested = false
    return await reconcileChatgptWebHydrateState()
  }
  hydrateCancelRequested = true
  const current = await getChatgptWebConversationMeta()
  if (current?.hydrateState?.phase === 'list_refresh' && current?.syncState?.status === 'running') {
    await stopChatgptWebConversationCacheSync()
  }
  const stoppedAt = new Date().toISOString()
  return await updateChatgptWebConversationMeta((meta) => ({
    ...meta,
    hydrateState: {
      ...(meta.hydrateState || {}),
      status: ['running', 'pause_requested'].includes(meta?.hydrateState?.status)
        ? 'pause_requested'
        : 'paused',
      pauseRequestedAt: stoppedAt,
      updatedAt: stoppedAt,
    },
  }))
}

export async function retryChatgptWebHydrateFailure(conversationId) {
  const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!normalizedConversationId) throw new Error('conversationId is required')
  if (activeHydrateJob || activeHydrateRetry) throw createHydrateBusyError()
  await reconcileChatgptWebHydrateState()

  activeHydrateRetry = (async () => {
    await assertHistoryEnabled()
    await assertHydrateSafetyLockClear()
    const config = await getUserConfig().catch(() => ({}))
    const options = resolveChatgptWebHydrateOptions(config, {})
    const previousMeta = await getChatgptWebConversationMeta()
    const index = await getChatgptWebConversationIndex()
    const indexEntry = index[normalizedConversationId] || { id: normalizedConversationId }
    const result = await hydrateConversationWithRetries(
      normalizedConversationId,
      options.retryCount,
    )
    let failures = normalizeHydrateFailures(previousMeta.hydrateFailures)
    if (result.ok) delete failures[normalizedConversationId]
    else {
      failures = recordHydrateFailure(failures, {
        conversationId: normalizedConversationId,
        title: indexEntry.title,
        error: result.error,
        attempts: result.attempts,
      })
    }
    return await updateChatgptWebConversationMeta((meta) => ({
      ...meta,
      hydrateFailures: failures,
      lastHydrateError: result.ok ? null : result.error?.message || String(result.error),
      hydrateState: {
        ...(meta.hydrateState || {}),
        currentConversationId: null,
        updatedAt: new Date().toISOString(),
      },
    }))
  })()

  try {
    return await activeHydrateRetry
  } finally {
    activeHydrateRetry = null
  }
}

export async function resetChatgptWebHydrateCircuit() {
  await reconcileChatgptWebHydrateState()
  const resetAt = new Date().toISOString()
  return await updateChatgptWebConversationMeta((meta) => {
    if (meta?.hydrateState?.status !== 'circuit_open') return meta
    return {
      ...meta,
      lastHydrateError: null,
      hydrateState: {
        ...(meta.hydrateState || {}),
        status: 'paused',
        consecutiveFailures: 0,
        lastError: null,
        updatedAt: resetAt,
      },
    }
  })
}

export async function clearChatgptWebHydrateFailures() {
  if (activeHydrateJob || activeHydrateRetry) throw createHydrateBusyError()
  await reconcileChatgptWebHydrateState()
  const clearedAt = new Date().toISOString()
  return await updateChatgptWebConversationMeta((meta) => ({
    ...meta,
    hydrateFailures: {},
    lastHydrateError: null,
    hydrateState: {
      ...(meta.hydrateState || {}),
      skippedFailed: 0,
      failed: 0,
      lastError: null,
      updatedAt: clearedAt,
    },
  }))
}
