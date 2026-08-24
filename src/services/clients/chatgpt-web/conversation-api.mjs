import Browser from 'webextension-polyfill'
import {
  CHATGPT_WEB_DEFAULT_MODEL_KEY,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
} from '../../../config/limits.mjs'
import { fetchSSE } from '../../../utils/fetch-sse.mjs'
import { getUserConfig } from '../../../config/storage.mjs'
import { initSession } from '../../init-session.mjs'
import { saveChatgptWebSessionSnapshot } from './thread-state.mjs'
import {
  buildChatgptWebConversationListResponse,
  getCachedChatgptWebConversationRecord,
  getChatgptWebConversationIndex,
  getChatgptWebConversationMeta,
  isChatgptWebConversationSnapshotStale,
  mergeChatgptWebConversationIndexEntries,
  overlayChatgptWebConversationStatus,
  saveChatgptWebConversationSnapshot,
  setChatgptWebConversationIndex,
  setChatgptWebConversationMeta,
  clearInvalidation,
} from './conversation-cache.mjs'
import {
  CHATGPT_WEB_HISTORY_SYNC_ALARM,
  getChatgptWebHistoryRequestIntervalMs,
  getNextAdaptiveSyncIntervalHours,
} from './conversation-sync-policy.mjs'
import { getChatGptAccessToken } from '../../wrappers.mjs'
import { generateAnswersWithChatgptWebApi } from './client.mjs'
import {
  extractChatgptWebConversationListItems,
  formatChatgptWebConversationSnapshot,
  isPendingChatgptWebConversation,
  selectChatgptWebRefreshResult,
} from './conversation-state.mjs'
import { applyResumePatch, consumeChatgptWebResumeDeltaStream } from './resume-delta.mjs'
import { buildChatgptWebConversationHeaders } from './request-wire.mjs'

export { applyResumePatch }

const TRUSTED_CHATGPT_DESTINATION_SUFFIXES = ['chatgpt.com', 'openai.com']
const DEFAULT_RESUME_TIMEOUT_MS = 180_000
const MAX_RESUME_TIMEOUT_MS = 3_600_000
const DEFAULT_CONVERSATION_LIST_PAGE_SIZE = 100
const MAX_CONVERSATION_LIST_PAGES = 200
let activeConversationCacheSync = null
let activeConversationCacheSyncIncludesArchived = false
let activeConversationCacheSyncMode = null

function isTrustedChatgptDestination(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return TRUSTED_CHATGPT_DESTINATION_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}

function createAbortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function normalizeBooleanQuery(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeConversationId(conversationId) {
  return typeof conversationId === 'string' ? conversationId.trim() : ''
}

function createDefaultRequestStats() {
  return {
    total: 0,
    automatic: 0,
    manual: 0,
    list: 0,
    detail: 0,
    rateLimited: 0,
    hourly: {},
    recent: [],
  }
}

function normalizeRequestStats(stats = {}) {
  return { ...createDefaultRequestStats(), ...(stats || {}) }
}

async function updateConversationMeta(updater) {
  const current = await getChatgptWebConversationMeta()
  const next = updater(current && typeof current === 'object' ? current : {})
  await setChatgptWebConversationMeta(next)
  return next
}

async function recordHistoryRequest({ kind, automatic, reason, status = null }) {
  const now = new Date().toISOString()
  return await updateConversationMeta((meta) => {
    const stats = normalizeRequestStats(meta.requestStats)
    const recent = Array.isArray(stats.recent) ? stats.recent : []
    const cutoff = Date.now() - 60 * 60 * 1000
    const hourlyCutoff = Date.now() - 24 * 60 * 60 * 1000
    const hourKey = now.slice(0, 13)
    const hourly = Object.fromEntries(
      Object.entries(stats.hourly || {}).filter(
        ([key]) => Date.parse(`${key}:00:00.000Z`) >= hourlyCutoff,
      ),
    )
    hourly[hourKey] = (Number(hourly[hourKey]) || 0) + 1
    return {
      ...meta,
      requestStats: {
        ...stats,
        total: stats.total + 1,
        automatic: stats.automatic + (automatic ? 1 : 0),
        manual: stats.manual + (automatic ? 0 : 1),
        list: stats.list + (kind === 'list' ? 1 : 0),
        detail: stats.detail + (kind === 'detail' ? 1 : 0),
        rateLimited: stats.rateLimited + (status === 429 ? 1 : 0),
        lastRequestAt: now,
        hourly,
        recent: [...recent, { at: now, kind, automatic, reason, status }]
          .filter((entry) => Date.parse(entry?.at || '') >= cutoff)
          .slice(-100),
      },
    }
  })
}

async function engageHistoryRateLimitSafetyLock({ path, reason }) {
  const suspendedAt = new Date().toISOString()
  const meta = await updateConversationMeta((current) => ({
    ...current,
    lastSyncError: 'HTTP 429: ChatGPT history synchronization was stopped',
    safetyLock: {
      reason: 'rate_limited',
      status: 429,
      suspendedAt,
      endpointKind: path.includes('/conversations?') ? 'list' : 'detail',
      syncReason: reason || 'unknown',
    },
    syncState: {
      ...(current.syncState || {}),
      status: 'rate_limited',
      stoppedAt: suspendedAt,
    },
  }))
  await Promise.resolve(Browser.alarms?.clear?.(CHATGPT_WEB_HISTORY_SYNC_ALARM)).catch(() => {})
  const badgeApi = Browser.action || Browser.browserAction
  await Promise.resolve(badgeApi?.setBadgeText?.({ text: '429' })).catch(() => {})
  await Promise.resolve(badgeApi?.setBadgeBackgroundColor?.({ color: '#b91c1c' })).catch(() => {})
  return meta
}

async function assertHistorySafetyLockClear() {
  const meta = await getChatgptWebConversationMeta()
  if (meta?.safetyLock?.reason === 'rate_limited') {
    const error = new Error(
      'ChatGPT history synchronization is paused after HTTP 429; review the settings and unlock it manually',
    )
    error.code = 'CHATGPT_HISTORY_RATE_LIMITED'
    error.status = 429
    throw error
  }
  if (meta?.syncState?.status === 'pause_requested') {
    throw createAbortError()
  }
  return meta
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHistoryRequestSlot(rpm) {
  await assertHistorySafetyLockClear()
  const config = await getUserConfig().catch(() => ({}))
  if (config.chatgptWebHistorySyncEnabled !== true) {
    const error = new Error('ChatGPT history synchronization is disabled in settings')
    error.code = 'CHATGPT_HISTORY_SYNC_DISABLED'
    throw error
  }
  const intervalMs = getChatgptWebHistoryRequestIntervalMs(
    config.chatgptWebHistorySyncRpm || rpm || DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  )
  const meta = await getChatgptWebConversationMeta()
  const nextAt = Date.parse(meta?.nextHistoryRequestAt || '')
  let remaining = Number.isFinite(nextAt) ? Math.max(0, nextAt - Date.now()) : 0
  while (remaining > 0) {
    await wait(Math.min(remaining, 30_000))
    remaining = Math.max(0, nextAt - Date.now())
    await assertHistorySafetyLockClear()
  }
  const reservedAt = Date.now()
  await updateConversationMeta((current) => ({
    ...current,
    nextHistoryRequestAt: new Date(reservedAt + intervalMs).toISOString(),
  }))
}

function createInMemoryPort(onPostMessage) {
  const messageListeners = new Set()
  const disconnectListeners = new Set()

  return {
    postMessage(message) {
      onPostMessage(message)
    },
    disconnect() {
      disconnectListeners.forEach((listener) => {
        try {
          listener()
        } catch {
          /* ignore */
        }
      })
    },
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener)
      },
      removeListener(listener) {
        messageListeners.delete(listener)
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener)
      },
      removeListener(listener) {
        disconnectListeners.delete(listener)
      },
    },
  }
}

async function getChatgptWebRequestContext() {
  const config = await getUserConfig()
  const accessToken = await getChatGptAccessToken()
  const baseUrl = config.customChatGptWebApiUrl || 'https://chatgpt.com'
  const shouldAttachCookies = isTrustedChatgptDestination(baseUrl)
  let cookie = ''
  let oaiDeviceId = ''

  if (shouldAttachCookies && Browser.cookies?.getAll) {
    cookie = (await Browser.cookies.getAll({ url: 'https://chatgpt.com/' }))
      .map((entry) => `${entry.name}=${entry.value}`)
      .join('; ')
    oaiDeviceId =
      (
        await Browser.cookies.get({
          url: 'https://chatgpt.com/',
          name: 'oai-did',
        })
      )?.value || ''
  }

  return {
    accessToken,
    baseUrl,
    config,
    cookie,
    oaiDeviceId,
    language: 'en-US',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(cookie && { Cookie: cookie }),
      ...(oaiDeviceId && { 'Oai-Device-Id': oaiDeviceId }),
      ...(config.chatgptAccountId && { 'Chatgpt-Account-Id': config.chatgptAccountId }),
      'Oai-Language': 'en-US',
    },
  }
}

async function fetchChatgptWebJson(
  path,
  { method = 'GET', body, signal, historyRequest = null } = {},
) {
  if (historyRequest?.limited !== false) {
    await waitForHistoryRequestSlot(historyRequest.rpm)
  }
  const context = await getChatgptWebRequestContext()
  let response
  try {
    response = await fetch(`${context.baseUrl}${path}`, {
      method,
      signal,
      credentials: 'include',
      headers: {
        ...context.headers,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (historyRequest) {
      await recordHistoryRequest({
        kind: historyRequest.kind,
        automatic: historyRequest.automatic === true,
        reason: historyRequest.reason,
      })
    }
    throw error
  }

  if (historyRequest) {
    await recordHistoryRequest({
      kind: historyRequest.kind,
      automatic: historyRequest.automatic === true,
      reason: historyRequest.reason,
      status: response.status,
    })
    if (response.status === 429) {
      await engageHistoryRateLimitSafetyLock({ path, reason: historyRequest.reason })
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    let errorPayload = null
    try {
      errorPayload = errorText ? JSON.parse(errorText) : null
    } catch {
      errorPayload = null
    }
    const error = new Error(
      errorPayload?.detail?.message ||
        errorPayload?.message ||
        errorText ||
        `ChatGPT request failed with ${response.status} ${response.statusText}`,
    )
    error.status = response.status
    error.code = errorPayload?.detail?.code || errorPayload?.code || null
    throw error
  }

  return response.json()
}

function isChatgptWebConversationNotReadyError(error) {
  if (error?.status === 404 && error?.code === 'conversation_not_found') return true
  return /don[’']t have access to this conversation/i.test(error?.message || '')
}

function readErrorFromConversationFetch(error) {
  return {
    status: error?.status || null,
    code: error?.code || null,
    message: error?.message || String(error),
    retryable: true,
  }
}

async function getLocalCreatedConversationStub(conversationId) {
  const index = await getChatgptWebConversationIndex()
  const entry = index[conversationId]
  if (entry?.localCreateAck !== true) return null
  const cached = await getCachedChatgptWebConversationRecord(conversationId)
  if (cached?.snapshot) return null
  return entry
}

function formatLocalCreateStubConversation(conversationId, entry, options = {}) {
  return formatChatgptWebConversationSnapshot(
    {
      conversation_id: conversationId,
      title: entry?.title || '',
      async_status: entry?.asyncStatus || 'in_progress',
      mapping: {},
    },
    options,
  )
}

function formatLocalCreateStubRefresh(conversationId, entry, error) {
  const conversation = formatLocalCreateStubConversation(conversationId, entry)
  return {
    fetchedAt: new Date().toISOString(),
    conversationId,
    pending: true,
    asyncStatus: conversation.asyncStatus,
    source: 'local_create_stub',
    conversation,
    resume: null,
    text: '',
    readError: readErrorFromConversationFetch(error),
  }
}

async function fetchChatgptWebConversationListPageFromNetwork({
  offset = 0,
  limit = 28,
  order = 'updated',
  isArchived = false,
  isStarred = false,
  historyRequest = null,
} = {}) {
  const normalizedOffset = parsePositiveInt(offset, 0, 0, 100_000)
  const normalizedLimit = parsePositiveInt(limit, 28, 1, 100)
  const params = new URLSearchParams({
    offset: String(normalizedOffset),
    limit: String(normalizedLimit),
    order: typeof order === 'string' && order ? order : 'updated',
    is_archived: String(normalizeBooleanQuery(isArchived, false)),
    is_starred: String(normalizeBooleanQuery(isStarred, false)),
  })
  return await fetchChatgptWebJson(`/backend-api/conversations?${params.toString()}`, {
    historyRequest,
  })
}

async function fetchChatgptWebConversationSnapshotFromNetwork(
  conversationId,
  historyRequest = null,
) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) throw new Error('conversationId is required')
  return await fetchChatgptWebJson(
    `/backend-api/conversation/${encodeURIComponent(normalizedConversationId)}`,
    { historyRequest },
  )
}

async function cacheChatgptWebConversationSnapshotById(conversationId, source = 'unknown') {
  const snapshot = await fetchChatgptWebConversationSnapshotFromNetwork(conversationId, {
    kind: 'detail',
    automatic: false,
    reason: source,
    limited: false,
  })
  await saveChatgptWebConversationSnapshot(snapshot, {
    cachedAt: new Date().toISOString(),
    source,
  })
  return snapshot
}

export async function syncChatgptWebConversationCache({
  includeArchived = false,
  mode = 'full',
  automatic = false,
  reason = 'manual',
  resume = false,
} = {}) {
  const normalizedMode = mode === 'incremental' ? 'incremental' : 'full'
  const shouldIncludeArchived = normalizeBooleanQuery(includeArchived, false)
  if (activeConversationCacheSync) {
    const activeCoversRequest =
      (normalizedMode === 'incremental' || activeConversationCacheSyncMode === 'full') &&
      (!shouldIncludeArchived || activeConversationCacheSyncIncludesArchived)
    if (activeCoversRequest) {
      return await activeConversationCacheSync
    }
    await activeConversationCacheSync
  }

  activeConversationCacheSyncIncludesArchived = shouldIncludeArchived
  activeConversationCacheSyncMode = normalizedMode

  activeConversationCacheSync = (async () => {
    try {
      if (resume === true) {
        await updateConversationMeta((meta) => ({
          ...meta,
          syncState:
            meta?.syncState?.status === 'pause_requested'
              ? { ...(meta.syncState || {}), status: 'paused' }
              : meta.syncState,
        }))
      }
      await assertHistorySafetyLockClear()
      const config = await getUserConfig().catch(() => ({}))
      if (config.chatgptWebHistorySyncEnabled !== true) {
        const error = new Error('ChatGPT history synchronization is disabled in settings')
        error.code = 'CHATGPT_HISTORY_SYNC_DISABLED'
        throw error
      }
      const rpm = config.chatgptWebHistorySyncRpm || DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM
      const previousMeta = await getChatgptWebConversationMeta()
      let nextEntries = await getChatgptWebConversationIndex()
      const syncedAt = new Date().toISOString()
      const newIds = new Set()
      const updatedIds = new Set()
      const phases = normalizedMode === 'full' && shouldIncludeArchived ? [false, true] : [false]
      const resumable =
        resume === true &&
        previousMeta?.syncState?.mode === normalizedMode &&
        Boolean(previousMeta?.syncState?.includeArchived) === shouldIncludeArchived &&
        ['failed', 'paused'].includes(previousMeta?.syncState?.status)
      let pagesCompleted = resumable ? Number(previousMeta.syncState.pagesCompleted) || 0 : 0
      let itemsFetched = resumable ? Number(previousMeta.syncState.itemsFetched) || 0 : 0
      let expectedTotal = resumable ? Number(previousMeta.syncState.expectedTotal) || 0 : 0
      let phaseExpectedTotal = resumable
        ? Number(previousMeta.syncState.phaseExpectedTotal) || 0
        : 0
      let resumePhase = resumable ? previousMeta.syncState.phase || 'active' : 'active'
      let resumeOffset = resumable ? Number(previousMeta.syncState.nextOffset) || 0 : 0

      await updateConversationMeta((meta) => ({
        ...meta,
        lastSyncError: null,
        syncState: {
          status: 'running',
          mode: normalizedMode,
          reason,
          automatic: automatic === true,
          includeArchived: shouldIncludeArchived,
          phase: resumePhase,
          nextOffset: resumeOffset,
          pagesCompleted,
          itemsFetched,
          expectedTotal,
          phaseExpectedTotal,
          requestCountAtStart: Number(meta?.requestStats?.total) || 0,
          startedAt: resumable ? previousMeta.syncState.startedAt || syncedAt : syncedAt,
          updatedAt: syncedAt,
        },
      }))

      for (const isArchived of phases) {
        const phase = isArchived ? 'archived' : 'active'
        if (resumable && resumePhase === 'archived' && phase === 'active') continue
        let offset = resumable && resumePhase === phase ? resumeOffset : 0
        const phaseBaseItemsFetched =
          resumable && resumePhase === phase ? Math.max(0, itemsFetched - offset) : itemsFetched
        if (!(resumable && resumePhase === phase)) phaseExpectedTotal = 0
        const maxPages = normalizedMode === 'incremental' ? 1 : MAX_CONVERSATION_LIST_PAGES

        await updateConversationMeta((meta) => ({
          ...meta,
          syncState: {
            ...(meta.syncState || {}),
            phase,
            nextOffset: offset,
            phaseExpectedTotal,
            updatedAt: new Date().toISOString(),
          },
        }))

        for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
          await assertHistorySafetyLockClear()
          const response = await fetchChatgptWebConversationListPageFromNetwork({
            offset,
            limit: DEFAULT_CONVERSATION_LIST_PAGE_SIZE,
            order: 'updated',
            isArchived,
            isStarred: false,
            historyRequest: {
              rpm,
              automatic: automatic === true,
              reason,
              kind: 'list',
            },
          })
          const pageItems = extractChatgptWebConversationListItems(response)
          const mergeResult = mergeChatgptWebConversationIndexEntries(
            nextEntries,
            pageItems,
            syncedAt,
          )
          nextEntries = mergeResult.entries
          mergeResult.newIds.forEach((conversationId) => newIds.add(conversationId))
          mergeResult.updatedIds.forEach((conversationId) => updatedIds.add(conversationId))
          await setChatgptWebConversationIndex(nextEntries)

          pagesCompleted += 1
          itemsFetched += pageItems.length
          phaseExpectedTotal = parsePositiveInt(response?.total, phaseExpectedTotal, 0, 1_000_000)
          expectedTotal = phaseBaseItemsFetched + phaseExpectedTotal
          offset += DEFAULT_CONVERSATION_LIST_PAGE_SIZE
          await updateConversationMeta((meta) => ({
            ...meta,
            syncState: {
              ...(meta.syncState || {}),
              status: meta?.syncState?.status === 'pause_requested' ? 'pause_requested' : 'running',
              phase,
              nextOffset: offset,
              pagesCompleted,
              itemsFetched,
              expectedTotal,
              phaseExpectedTotal,
              lastSuccessfulPageAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }))

          if (normalizedMode === 'incremental') break
          if (pageItems.length < DEFAULT_CONVERSATION_LIST_PAGE_SIZE) break
          if (phaseExpectedTotal > 0 && offset >= phaseExpectedTotal) break
        }

        resumePhase = phase
        resumeOffset = 0
      }

      const changed = newIds.size > 0 || updatedIds.size > 0
      const completedAt = new Date().toISOString()
      const nextMeta = await updateConversationMeta((meta) => ({
        ...meta,
        ...(normalizedMode === 'full'
          ? {
              lastSyncAt: completedAt,
              lastSyncItemCount: Object.values(nextEntries).filter(
                (entry) => entry?.isArchived !== true,
              ).length,
              ...(shouldIncludeArchived && { lastArchivedSyncAt: completedAt }),
            }
          : { lastIncrementalSyncAt: completedAt }),
        ...(automatic === true && normalizedMode === 'incremental'
          ? {
              adaptiveSyncIntervalHours: getNextAdaptiveSyncIntervalHours(
                meta.adaptiveSyncIntervalHours,
                changed,
              ),
            }
          : {}),
        lastSyncError: null,
        syncState: {
          ...(meta.syncState || {}),
          status: 'complete',
          completedAt,
          updatedAt: completedAt,
        },
      }))
      clearInvalidation()
      return {
        index: nextEntries,
        meta: nextMeta,
        newIds: [...newIds],
        updatedIds: [...updatedIds],
        skipped: false,
        pagesCompleted,
        itemsFetched,
      }
    } catch (error) {
      await updateConversationMeta((meta) => ({
        ...meta,
        lastSyncError: error?.message || String(error),
        syncState:
          meta?.safetyLock?.reason === 'rate_limited'
            ? meta.syncState
            : error?.name === 'AbortError'
            ? {
                ...(meta.syncState || {}),
                status: 'paused',
                pausedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : {
                ...(meta.syncState || {}),
                status: 'failed',
                failedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
      }))
      throw error
    } finally {
      activeConversationCacheSync = null
      activeConversationCacheSyncIncludesArchived = false
      activeConversationCacheSyncMode = null
    }
  })()

  return await activeConversationCacheSync
}

export async function stopChatgptWebConversationCacheSync() {
  const stoppedAt = new Date().toISOString()
  return await updateConversationMeta((meta) => ({
    ...meta,
    syncState: {
      ...(meta.syncState || {}),
      status: ['running', 'pause_requested'].includes(meta?.syncState?.status)
        ? 'pause_requested'
        : 'paused',
      pauseRequestedAt: stoppedAt,
      updatedAt: stoppedAt,
    },
  }))
}

export async function unlockChatgptWebConversationSync() {
  const config = await getUserConfig().catch(() => ({}))
  if (config.chatgptWebHistorySyncEnabled !== true) {
    const error = new Error('Enable ChatGPT history synchronization before unlocking it')
    error.code = 'CHATGPT_HISTORY_SYNC_DISABLED'
    throw error
  }
  const unlockedAt = new Date().toISOString()
  const nextMeta = await updateConversationMeta((meta) => ({
    ...meta,
    safetyLock: null,
    lastSyncError: null,
    nextHistoryRequestAt: null,
    syncState: {
      ...(meta.syncState || {}),
      status: 'paused',
      unlockedAt,
      updatedAt: unlockedAt,
    },
  }))
  const badgeApi = Browser.action || Browser.browserAction
  await Promise.resolve(badgeApi?.setBadgeText?.({ text: '' })).catch(() => {})
  return nextMeta
}

export async function listChatgptWebConversations({
  offset = 0,
  limit = 28,
  order = 'updated',
  isArchived = false,
  isStarred = false,
  forceSync = false,
} = {}) {
  const shouldIncludeArchived = normalizeBooleanQuery(isArchived, false)
  let index = await getChatgptWebConversationIndex()
  let meta = await getChatgptWebConversationMeta()

  if (forceSync) {
    try {
      const syncResult = await syncChatgptWebConversationCache({
        includeArchived: shouldIncludeArchived,
        mode: 'full',
        automatic: false,
        reason: 'list_force_sync',
      })
      index = syncResult.index
      meta = syncResult.meta
    } catch (error) {
      if (Object.keys(index).length === 0) throw error
    }
  }

  return buildChatgptWebConversationListResponse(
    index,
    {
      offset,
      limit,
      order,
      isArchived,
      isStarred,
    },
    meta,
  )
}

export async function getChatgptWebConversation({
  conversationId,
  userMessageId,
  assistantMessageId,
  think = false,
  forceRefresh = false,
} = {}) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) throw new Error('conversationId is required')

  const [index, meta, cachedRecord] = await Promise.all([
    getChatgptWebConversationIndex(),
    getChatgptWebConversationMeta(),
    getCachedChatgptWebConversationRecord(normalizedConversationId),
  ])
  const indexEntry = index[normalizedConversationId] || null
  const stale = isChatgptWebConversationSnapshotStale(indexEntry, cachedRecord)
  let snapshot = cachedRecord?.snapshot || null
  let cacheSource = snapshot ? 'cache' : 'network'
  let refreshError = null
  let refreshAttempted = false

  if (forceRefresh || !snapshot || stale) {
    refreshAttempted = true
    try {
      snapshot = await cacheChatgptWebConversationSnapshotById(
        normalizedConversationId,
        forceRefresh ? 'get_force_refresh' : stale ? 'get_stale_refresh' : 'get_cache_miss',
      )
      cacheSource = 'network'
    } catch (error) {
      refreshError = error
      if (!snapshot) {
        const stub = await getLocalCreatedConversationStub(normalizedConversationId)
        if (stub && isChatgptWebConversationNotReadyError(error)) {
          return {
            ...formatLocalCreateStubConversation(normalizedConversationId, stub, {
              userMessageId,
              assistantMessageId,
              think,
            }),
            pending: true,
            readError: readErrorFromConversationFetch(error),
            cache: {
              source: 'local_create_stub',
              stale: true,
              refreshAttempted: true,
              refreshError: error?.message || null,
              cachedAt: cachedRecord?.cachedAt || null,
              listSyncedAt: meta?.lastSyncAt || null,
            },
          }
        }
        throw error
      }
    }
  }

  const effectiveSnapshot = overlayChatgptWebConversationStatus(snapshot, indexEntry)
  const formatted = formatChatgptWebConversationSnapshot(effectiveSnapshot, {
    userMessageId,
    assistantMessageId,
    think,
  })

  return {
    ...formatted,
    cache: {
      source: cacheSource,
      stale: stale || Boolean(refreshError),
      refreshAttempted,
      refreshError: refreshError?.message || null,
      cachedAt: cachedRecord?.cachedAt || null,
      listSyncedAt: meta?.lastSyncAt || null,
    },
  }
}

export async function resumeChatgptWebConversation({
  conversationId,
  offset = 0,
  timeoutMs = DEFAULT_RESUME_TIMEOUT_MS,
  conduitToken = '',
} = {}) {
  if (typeof conversationId !== 'string' || !conversationId.trim()) {
    throw new Error('conversationId is required')
  }

  const normalizedOffset = parsePositiveInt(offset, 0, 0, 1_000_000)
  const normalizedTimeoutMs = parsePositiveInt(
    timeoutMs,
    DEFAULT_RESUME_TIMEOUT_MS,
    1000,
    MAX_RESUME_TIMEOUT_MS,
  )
  const context = await getChatgptWebRequestContext()
  const controller = new AbortController()
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(createAbortError())
  }, normalizedTimeoutMs)

  let result
  try {
    result = await consumeChatgptWebResumeDeltaStream({
      url: `${context.baseUrl}/backend-api/f/conversation/resume`,
      headers: buildChatgptWebConversationHeaders({
        accessToken: context.accessToken,
        cookie: context.cookie,
        oaiDeviceId: context.oaiDeviceId,
        language: context.language,
        accountId: context.config.chatgptAccountId || '',
        conduitToken: typeof conduitToken === 'string' ? conduitToken.trim() : '',
        apiPath: '/backend-api/f/conversation/resume',
      }),
      body: {
        conversation_id: conversationId.trim(),
        offset: normalizedOffset,
      },
      signal: controller.signal,
      fetchSSE,
    })
  } finally {
    clearTimeout(timeout)
  }

  const { assistantMessages, bestMessage, handoff, inputMessage, title } = result

  return {
    conversationId: conversationId.trim(),
    fetchedAt: new Date().toISOString(),
    timedOut,
    offset: result.offset,
    eventCount: result.eventCount,
    title: title || null,
    pending: Boolean(bestMessage?.isPending),
    authoritativeDone: result.authoritativeDone,
    completed: result.completed,
    inputMessageId: inputMessage?.id || null,
    handoff:
      handoff && typeof handoff === 'object'
        ? {
            turnExchangeId: handoff.turn_exchange_id || null,
            options: Array.isArray(handoff.options) ? handoff.options : [],
          }
        : null,
    message: bestMessage,
    assistantMessages: assistantMessages.map((message) => ({
      id: message.id,
      order: message.order,
      status: message.status,
      channel: message.channel,
      contentType: message.contentType,
      textLength: message.textLength,
      textPreview: message.text.slice(0, 400),
      thoughtCount: message.thoughtCount,
      isPending: message.isPending,
      isFinal: message.isFinal,
    })),
  }
}

export async function refreshChatgptWebConversation({
  conversationId,
  userMessageId,
  assistantMessageId,
  offset = 0,
  preferResume = false,
  resumeTimeoutMs = DEFAULT_RESUME_TIMEOUT_MS,
  conduitToken = '',
  think = false,
} = {}) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) throw new Error('conversationId is required')
  let snapshot
  try {
    snapshot = await cacheChatgptWebConversationSnapshotById(
      normalizedConversationId,
      'explicit_refresh',
    )
  } catch (error) {
    const stub = await getLocalCreatedConversationStub(normalizedConversationId)
    if (stub && isChatgptWebConversationNotReadyError(error)) {
      return formatLocalCreateStubRefresh(normalizedConversationId, stub, error)
    }
    throw error
  }
  const conversation = formatChatgptWebConversationSnapshot(snapshot, {
    userMessageId,
    assistantMessageId,
    think,
  })

  const normalizedConduitToken = typeof conduitToken === 'string' ? conduitToken.trim() : ''
  let resume = null
  if (preferResume && (normalizedConduitToken || isPendingChatgptWebConversation(conversation))) {
    resume = await resumeChatgptWebConversation({
      conversationId: normalizedConversationId,
      offset,
      timeoutMs: resumeTimeoutMs,
      conduitToken: normalizedConduitToken,
    }).catch((error) => ({
      conversationId: normalizedConversationId,
      fetchedAt: new Date().toISOString(),
      error: error?.message || String(error),
    }))
  }

  const selection = selectChatgptWebRefreshResult(conversation, resume)

  return {
    fetchedAt: new Date().toISOString(),
    conversationId: conversation?.conversationId || normalizedConversationId,
    pending: selection.pending,
    asyncStatus: conversation.asyncStatus,
    source: resume ? 'conversation+resume' : 'conversation',
    conversation,
    resume,
    text: selection.text,
  }
}

export async function sendChatgptWebConversationMessage({
  conversationId,
  query,
  model,
  think = false,
} = {}) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''
  if (!normalizedConversationId) throw new Error('conversationId is required')
  if (!normalizedQuery) throw new Error('query is required')

  const cachedRecord = await getCachedChatgptWebConversationRecord(normalizedConversationId)
  let conversationSnapshot = cachedRecord?.snapshot || null
  if (!conversationSnapshot) {
    conversationSnapshot = await cacheChatgptWebConversationSnapshotById(
      normalizedConversationId,
      'send_preflight_cache_miss',
    )
  }

  if (!conversationSnapshot || typeof conversationSnapshot !== 'object') {
    throw new Error(
      `Conversation ${normalizedConversationId} is not cached and could not be fetched`,
    )
  }
  if (!conversationSnapshot.current_node) {
    throw new Error('Conversation current node is required before sending a follow-up')
  }

  const accessToken = await getChatGptAccessToken()
  const session = initSession({
    question: normalizedQuery,
    modelName: CHATGPT_WEB_DEFAULT_MODEL_KEY,
    autoClean: false,
    chatgptWebHistoryDisabledOverride: false,
    chatgptWebIncrementalOutput: false,
  })
  session.conversationId = normalizedConversationId
  session.parentMessageId = conversationSnapshot.current_node
  session.chatgptWebModelSlugOverride =
    (typeof model === 'string' && model.trim()) ||
    conversationSnapshot.default_model_slug ||
    undefined

  const result = await new Promise((resolve, reject) => {
    let latestAnswer = ''
    let latestSession = session
    const port = createInMemoryPort((message) => {
      if (message?.error) {
        reject(new Error(message.error))
        return
      }
      if (message?.session && typeof message.session === 'object') {
        latestSession = { ...latestSession, ...message.session }
      }
      if (typeof message?.answer === 'string') latestAnswer = message.answer
      if (message?.done === true) {
        resolve({
          answer: latestAnswer,
          session: latestSession,
        })
      }
    })

    generateAnswersWithChatgptWebApi(port, normalizedQuery, latestSession, accessToken).catch(
      (error) => reject(error),
    )
  })

  await saveChatgptWebSessionSnapshot(result.session, { source: 'conversation_message' }).catch(
    () => {},
  )

  const refreshed = await refreshChatgptWebConversation({
    conversationId: normalizedConversationId,
    preferResume: false,
    think,
  }).catch(async () => {
    const conversation = await getChatgptWebConversation({
      conversationId: normalizedConversationId,
      think,
      forceRefresh: true,
    })
    return {
      fetchedAt: new Date().toISOString(),
      conversationId: conversation.conversationId || normalizedConversationId,
      pending: conversation.pending === true,
      asyncStatus: conversation.asyncStatus,
      source: 'conversation',
      conversation,
      resume: null,
      text: conversation?.message?.text || result.answer || '',
    }
  })

  return {
    ...refreshed,
    query: normalizedQuery,
  }
}
