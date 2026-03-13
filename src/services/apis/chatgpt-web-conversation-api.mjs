import Browser from 'webextension-polyfill'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { getUserConfig } from '../../config/index.mjs'
import { getChatGptAccessToken } from '../wrappers.mjs'
import {
  extractChatgptWebConversationListItems,
  extractChatgptWebMessageText,
  formatChatgptWebConversationListItem,
  formatChatgptWebConversationSnapshot,
  isFinalChatgptWebMessageStatus,
  isPendingChatgptWebConversation,
  isPendingChatgptWebMessageStatus,
  selectChatgptWebRefreshResult,
} from './chatgpt-web-conversation-state.mjs'

const TRUSTED_CHATGPT_DESTINATION_SUFFIXES = ['chatgpt.com', 'openai.com']
const DEFAULT_RESUME_TIMEOUT_MS = 10_000

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

export async function listChatgptWebConversations({
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
  const response = await fetchChatgptWebJson(`/backend-api/conversations?${params.toString()}`)

  // Preserve the upstream ChatGPT Web list payload shape for API consumers.
  // UI callers should format `items` on the client side instead of changing
  // the server contract here.
  if (response && typeof response === 'object') return response

  const items = extractChatgptWebConversationListItems(response).map((item) =>
    formatChatgptWebConversationListItem(item),
  )
  return { items }
}

export async function getChatgptWebConversation({
  conversationId,
  userMessageId,
  assistantMessageId,
} = {}) {
  if (typeof conversationId !== 'string' || !conversationId.trim()) {
    throw new Error('conversationId is required')
  }
  const snapshot = await fetchChatgptWebJson(
    `/backend-api/conversation/${encodeURIComponent(conversationId.trim())}`,
  )
  return formatChatgptWebConversationSnapshot(snapshot, {
    userMessageId,
    assistantMessageId,
  })
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
} = {}) {
  const conversation = await getChatgptWebConversation({
    conversationId,
    userMessageId,
    assistantMessageId,
  })

  let resume = null
  if (preferResume && isPendingChatgptWebConversation(conversation)) {
    resume = await resumeChatgptWebConversation({
      conversationId,
      offset,
      timeoutMs: resumeTimeoutMs,
    }).catch((error) => ({
      conversationId,
      fetchedAt: new Date().toISOString(),
      error: error?.message || String(error),
    }))
  }

  const selection = selectChatgptWebRefreshResult(conversation, resume)

  return {
    fetchedAt: new Date().toISOString(),
    conversationId: conversation?.conversationId || conversationId,
    pending: selection.pending,
    asyncStatus: conversation.asyncStatus,
    source: resume ? 'conversation+resume' : 'conversation',
    conversation,
    resume,
    text: selection.text,
  }
}
