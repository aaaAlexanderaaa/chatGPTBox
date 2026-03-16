import Browser from 'webextension-polyfill'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from '../../config/index.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { getUserConfig } from '../../config/index.mjs'
import { initSession } from '../init-session.mjs'
import { saveChatgptWebSessionSnapshot } from '../chatgpt-web-thread-state.mjs'
import {
  buildChatgptWebConversationListResponse,
  CHATGPT_WEB_CONVERSATION_SYNC_INTERVAL_MINUTES,
  getCachedChatgptWebConversationRecord,
  getChatgptWebConversationIndex,
  getChatgptWebConversationMeta,
  isChatgptWebConversationSnapshotStale,
  mergeChatgptWebConversationIndexEntries,
  overlayChatgptWebConversationStatus,
  saveChatgptWebConversationSnapshot,
  setChatgptWebConversationIndex,
  setChatgptWebConversationMeta,
} from '../chatgpt-web-conversation-cache.mjs'
import { getChatGptAccessToken } from '../wrappers.mjs'
import { generateAnswersWithChatgptWebApi } from './chatgpt-web.mjs'
import {
  extractChatgptWebConversationListItems,
  extractChatgptWebMessageText,
  formatChatgptWebConversationSnapshot,
  isFinalChatgptWebMessageStatus,
  isPendingChatgptWebConversation,
  isPendingChatgptWebMessageStatus,
  selectChatgptWebRefreshResult,
} from './chatgpt-web-conversation-state.mjs'

const TRUSTED_CHATGPT_DESTINATION_SUFFIXES = ['chatgpt.com', 'openai.com']
const DEFAULT_RESUME_TIMEOUT_MS = 10_000
const DEFAULT_CONVERSATION_LIST_PAGE_SIZE = 100
const MAX_CONVERSATION_LIST_PAGES = 200
const CONVERSATION_SYNC_INTERVAL_MS = CHATGPT_WEB_CONVERSATION_SYNC_INTERVAL_MINUTES * 60 * 1000
let activeConversationCacheSync = null
let activeConversationCacheSyncIncludesArchived = false

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

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

function hasSyncTimestampExpired(syncAt, now = Date.now()) {
  const parsed = Date.parse(syncAt || '')
  if (!Number.isFinite(parsed)) return true
  return now - parsed >= CONVERSATION_SYNC_INTERVAL_MS
}

function hasConversationCacheExpired(meta, now = Date.now()) {
  return hasSyncTimestampExpired(meta?.lastSyncAt, now)
}

function hasArchivedConversationCacheExpired(meta, now = Date.now()) {
  return hasSyncTimestampExpired(meta?.lastArchivedSyncAt, now)
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(cookie && { Cookie: cookie }),
      ...(oaiDeviceId && { 'Oai-Device-Id': oaiDeviceId }),
      'Oai-Language': 'en-US',
    },
  }
}

async function fetchChatgptWebJson(path, { method = 'GET', body, signal } = {}) {
  const context = await getChatgptWebRequestContext()
  const response = await fetch(`${context.baseUrl}${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: {
      ...context.headers,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

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

function ensureContainer(target, pathSegments) {
  let cursor = target
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index]
    const nextSegment = pathSegments[index + 1]
    if (cursor[segment] == null) {
      cursor[segment] = /^\d+$/.test(nextSegment) ? [] : {}
    }
    cursor = cursor[segment]
  }
  return {
    container: cursor,
    key: pathSegments[pathSegments.length - 1],
  }
}

function applyResumePatch(target, operation = {}) {
  const rawPath = typeof operation.p === 'string' ? operation.p : ''
  const pathSegments = rawPath.split('/').slice(1).filter(Boolean)

  if (pathSegments.length === 0) return

  const { container, key } = ensureContainer(target, pathSegments)
  const value = operation.v

  switch (operation.o) {
    case 'append': {
      const current = container[key]
      if (typeof current === 'string') {
        container[key] = `${current}${value ?? ''}`
      } else if (Array.isArray(current)) {
        current.push(value)
      } else if (current && typeof current === 'object' && value && typeof value === 'object') {
        Object.assign(current, value)
      } else if (current == null) {
        container[key] = Array.isArray(value) ? [...value] : value
      }
      break
    }
    case 'replace':
    case 'add':
      container[key] = value
      break
    case 'remove':
      if (Array.isArray(container) && /^\d+$/.test(key)) {
        container.splice(Number(key), 1)
      } else {
        delete container[key]
      }
      break
    default:
      break
  }
}

function buildResumeMessageSummary(entry, order) {
  const message = entry?.message
  if (!message || message.author?.role !== 'assistant') return null

  const text = extractChatgptWebMessageText(message)
  const thoughts = Array.isArray(message.content?.thoughts)
    ? message.content.thoughts
        .map((thought) => {
          if (!thought || typeof thought !== 'object') return null
          return {
            summary: typeof thought.summary === 'string' ? thought.summary : '',
            content: typeof thought.content === 'string' ? thought.content : '',
            finished: thought.finished === true,
          }
        })
        .filter(Boolean)
    : []
  const status = typeof message.status === 'string' ? message.status : ''
  const contentType = message.content?.content_type || ''
  const isPending = isPendingChatgptWebMessageStatus(status)
  const isFinal = isFinalChatgptWebMessageStatus(status) || Boolean(text && message.end_turn)

  return {
    id: message.id || null,
    order,
    status,
    channel: message.channel || null,
    contentType,
    endTurn: message.end_turn === true,
    isPending,
    isFinal,
    text,
    textLength: text.length,
    thoughts,
    thoughtCount: thoughts.length,
  }
}

function pickBestResumeMessage(messages = []) {
  return (
    [...messages].filter(Boolean).sort((left, right) => {
      const leftScore =
        (left.textLength > 0 ? 10_000 : 0) +
        (left.channel === 'final' ? 2_000 : 0) +
        (left.contentType === 'text' ? 1_000 : 0) +
        (left.contentType === 'multimodal_text' ? 900 : 0) +
        (left.contentType === 'code' ? 800 : 0) +
        (left.isFinal ? 500 : 0) +
        (left.isPending ? 200 : 0) +
        left.order
      const rightScore =
        (right.textLength > 0 ? 10_000 : 0) +
        (right.channel === 'final' ? 2_000 : 0) +
        (right.contentType === 'text' ? 1_000 : 0) +
        (right.contentType === 'multimodal_text' ? 900 : 0) +
        (right.contentType === 'code' ? 800 : 0) +
        (right.isFinal ? 500 : 0) +
        (right.isPending ? 200 : 0) +
        right.order
      return rightScore - leftScore
    })[0] || null
  )
}

async function fetchChatgptWebConversationListPageFromNetwork({
  offset = 0,
  limit = 28,
  order = 'updated',
  isArchived = false,
  isStarred = false,
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
  return await fetchChatgptWebJson(`/backend-api/conversations?${params.toString()}`)
}

async function fetchChatgptWebConversationSnapshotFromNetwork(conversationId) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) throw new Error('conversationId is required')
  return await fetchChatgptWebJson(
    `/backend-api/conversation/${encodeURIComponent(normalizedConversationId)}`,
  )
}

function findMissingActiveConversationIds(index = {}, items = []) {
  const activeIds = new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeConversationId(item?.id || item?.conversation_id))
      .filter(Boolean),
  )

  return Object.values(index && typeof index === 'object' ? index : {})
    .filter((entry) => entry && typeof entry === 'object' && entry.isArchived !== true)
    .map((entry) => normalizeConversationId(entry.id))
    .filter((id) => id && !activeIds.has(id))
}

async function fetchAllChatgptWebConversationListItems({ isArchived = false } = {}) {
  const items = []
  const normalizedIsArchived = normalizeBooleanQuery(isArchived, false)

  for (let pageIndex = 0; pageIndex < MAX_CONVERSATION_LIST_PAGES; pageIndex += 1) {
    const offset = pageIndex * DEFAULT_CONVERSATION_LIST_PAGE_SIZE
    const response = await fetchChatgptWebConversationListPageFromNetwork({
      offset,
      limit: DEFAULT_CONVERSATION_LIST_PAGE_SIZE,
      order: 'updated',
      isArchived: normalizedIsArchived,
      isStarred: false,
    })
    const pageItems = extractChatgptWebConversationListItems(response)
    items.push(...pageItems)

    const total = parsePositiveInt(response?.total, 0, 0, 1_000_000)
    if (pageItems.length < DEFAULT_CONVERSATION_LIST_PAGE_SIZE) break
    if (total > 0 && items.length >= total) break
  }

  return items
}

async function cacheChatgptWebConversationSnapshotById(conversationId, source = 'unknown') {
  const snapshot = await fetchChatgptWebConversationSnapshotFromNetwork(conversationId)
  await saveChatgptWebConversationSnapshot(snapshot, {
    cachedAt: new Date().toISOString(),
    source,
  })
  return snapshot
}

export async function syncChatgptWebConversationCache({
  force = false,
  includeArchived = false,
} = {}) {
  const shouldIncludeArchived = normalizeBooleanQuery(includeArchived, false)
  if (activeConversationCacheSync) {
    if (!shouldIncludeArchived || activeConversationCacheSyncIncludesArchived) {
      return await activeConversationCacheSync
    }
    await activeConversationCacheSync
  }

  activeConversationCacheSyncIncludesArchived = shouldIncludeArchived

  activeConversationCacheSync = (async () => {
    try {
      const meta = await getChatgptWebConversationMeta()
      const currentIndex = await getChatgptWebConversationIndex()
      const shouldRefreshActive = force === true || hasConversationCacheExpired(meta)
      const shouldRefreshArchived =
        shouldIncludeArchived && (force === true || hasArchivedConversationCacheExpired(meta))

      if (!shouldRefreshActive && !shouldRefreshArchived) {
        return {
          index: currentIndex,
          meta,
          skipped: true,
        }
      }

      const syncedAt = new Date().toISOString()
      let nextEntries = currentIndex
      let nextLastSyncAt = meta?.lastSyncAt || null
      let nextLastSyncItemCount = meta?.lastSyncItemCount || 0
      let nextLastArchivedSyncAt = meta?.lastArchivedSyncAt || null
      const newIds = new Set()
      const updatedIds = new Set()
      const hydrateIds = new Set()
      let activeItems = null

      if (shouldRefreshActive) {
        activeItems = await fetchAllChatgptWebConversationListItems({ isArchived: false })
        const activeMergeResult = mergeChatgptWebConversationIndexEntries(
          nextEntries,
          activeItems,
          syncedAt,
        )
        nextEntries = activeMergeResult.entries
        activeMergeResult.newIds.forEach((conversationId) => {
          newIds.add(conversationId)
          hydrateIds.add(conversationId)
        })
        activeMergeResult.updatedIds.forEach((conversationId) => updatedIds.add(conversationId))
        nextLastSyncAt = syncedAt
        nextLastSyncItemCount = activeItems.length
      }

      const missingActiveConversationIds = Array.isArray(activeItems)
        ? findMissingActiveConversationIds(nextEntries, activeItems)
        : []
      const shouldFetchArchived = shouldRefreshArchived || missingActiveConversationIds.length > 0
      if (shouldFetchArchived) {
        const archivedItems = await fetchAllChatgptWebConversationListItems({ isArchived: true })
        const archivedMergeResult = mergeChatgptWebConversationIndexEntries(
          nextEntries,
          archivedItems,
          syncedAt,
        )
        nextEntries = archivedMergeResult.entries
        archivedMergeResult.newIds.forEach((conversationId) => newIds.add(conversationId))
        archivedMergeResult.updatedIds.forEach((conversationId) => updatedIds.add(conversationId))
        nextLastArchivedSyncAt = syncedAt
      }

      await setChatgptWebConversationIndex(nextEntries)

      for (const conversationId of hydrateIds) {
        try {
          await cacheChatgptWebConversationSnapshotById(conversationId, 'hourly_sync_new')
        } catch {
          /* keep the list entry even when detail hydration fails */
        }
      }

      const nextMeta = {
        ...meta,
        lastSyncAt: nextLastSyncAt,
        lastArchivedSyncAt: nextLastArchivedSyncAt,
        lastSyncError: null,
        lastSyncItemCount: nextLastSyncItemCount,
      }
      await setChatgptWebConversationMeta(nextMeta)
      return {
        index: nextEntries,
        meta: nextMeta,
        newIds: [...newIds],
        updatedIds: [...updatedIds],
        skipped: false,
      }
    } catch (error) {
      const meta = await getChatgptWebConversationMeta()
      const nextMeta = {
        ...meta,
        lastSyncError: error?.message || String(error),
      }
      await setChatgptWebConversationMeta(nextMeta)
      throw error
    } finally {
      activeConversationCacheSync = null
      activeConversationCacheSyncIncludesArchived = false
    }
  })()

  return await activeConversationCacheSync
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

  const shouldSync =
    forceSync ||
    Object.keys(index).length === 0 ||
    hasConversationCacheExpired(meta) ||
    (shouldIncludeArchived && hasArchivedConversationCacheExpired(meta))
  if (shouldSync) {
    try {
      const syncResult = await syncChatgptWebConversationCache({
        force: forceSync,
        includeArchived: shouldIncludeArchived,
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
      if (!snapshot) throw error
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
} = {}) {
  if (typeof conversationId !== 'string' || !conversationId.trim()) {
    throw new Error('conversationId is required')
  }

  const normalizedOffset = parsePositiveInt(offset, 0, 0, 1_000_000)
  const normalizedTimeoutMs = parsePositiveInt(timeoutMs, DEFAULT_RESUME_TIMEOUT_MS, 1000, 60_000)
  const context = await getChatgptWebRequestContext()
  const controller = new AbortController()
  const entries = new Map()
  let activeCursor = null
  let title = ''
  let inputMessage = null
  let handoff = null
  let eventCount = 0
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(createAbortError())
  }, normalizedTimeoutMs)

  try {
    await fetchSSE(`${context.baseUrl}/backend-api/f/conversation/resume`, {
      method: 'POST',
      signal: controller.signal,
      credentials: 'include',
      headers: {
        ...context.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId.trim(),
        offset: normalizedOffset,
      }),
      onMessage() {},
      onStart() {},
      onEnd() {},
      onResponse() {},
      onError(error) {
        if (error?.name === 'AbortError') return
        throw error
      },
      onEvent(event) {
        if (event.type !== 'event') return
        eventCount += 1
        const eventName = event.event || ''
        let payload = null
        try {
          payload = event.data ? JSON.parse(event.data) : null
        } catch {
          payload = null
        }
        if (!payload || typeof payload !== 'object') return

        if (!eventName) {
          if (payload.type === 'title_generation') {
            title = typeof payload.title === 'string' ? payload.title : title
          } else if (payload.type === 'stream_handoff') {
            handoff = payload
          } else if (payload.type === 'input_message') {
            inputMessage = payload.input_message || inputMessage
          }
          return
        }

        if (eventName !== 'delta') return
        if (payload.c != null) activeCursor = payload.c
        const cursor = payload.c != null ? payload.c : activeCursor
        if (cursor == null) return

        if (payload.o === 'add' && payload.v && typeof payload.v === 'object') {
          entries.set(cursor, cloneJson(payload.v))
          return
        }

        if (!entries.has(cursor) && payload.v && payload.v.message) {
          entries.set(cursor, cloneJson(payload.v))
          return
        }

        if (!entries.has(cursor) || !Array.isArray(payload.v)) return
        const entry = entries.get(cursor)
        payload.v.forEach((operation) => applyResumePatch(entry, operation))
      },
    })
  } finally {
    clearTimeout(timeout)
  }

  const assistantMessages = [...entries.values()]
    .map((entry, index) => buildResumeMessageSummary(entry, index))
    .filter(Boolean)
  const bestMessage = pickBestResumeMessage(assistantMessages)

  return {
    conversationId: conversationId.trim(),
    fetchedAt: new Date().toISOString(),
    timedOut,
    offset: normalizedOffset,
    eventCount,
    title: title || null,
    pending: Boolean(bestMessage?.isPending),
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
  preferResume = true,
  resumeTimeoutMs = DEFAULT_RESUME_TIMEOUT_MS,
  think = false,
} = {}) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) throw new Error('conversationId is required')
  const snapshot = await cacheChatgptWebConversationSnapshotById(
    normalizedConversationId,
    'explicit_refresh',
  )
  const conversation = formatChatgptWebConversationSnapshot(snapshot, {
    userMessageId,
    assistantMessageId,
    think,
  })

  let resume = null
  if (preferResume && isPendingChatgptWebConversation(conversation)) {
    resume = await resumeChatgptWebConversation({
      conversationId: normalizedConversationId,
      offset,
      timeoutMs: resumeTimeoutMs,
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

  let conversationSnapshot
  try {
    conversationSnapshot = await cacheChatgptWebConversationSnapshotById(
      normalizedConversationId,
      'send_preflight_refresh',
    )
  } catch {
    const cachedRecord = await getCachedChatgptWebConversationRecord(normalizedConversationId)
    conversationSnapshot = cachedRecord?.snapshot || null
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
    preferResume: true,
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
