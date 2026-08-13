import {
  extractChatgptWebMessageText,
  isFinalChatgptWebMessageStatus,
  isPendingChatgptWebMessageStatus,
} from './conversation-state.mjs'

const FORBIDDEN_PATCH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const STREAM_RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 502, 504])
export const CHATGPT_WEB_STREAM_MAX_RETRIES = 12
const STREAM_RETRY_MIN_DELAY_MS = 300
const STREAM_RETRY_MAX_DELAY_MS = 5000
const STREAM_RETRY_BACKOFF_FACTOR = 1.5

function createAbortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function waitWithAbort(ms, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    let timeout
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(createAbortError())
    }
    timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function isRetryableChatgptWebStreamError(error) {
  if (STREAM_RETRYABLE_HTTP_STATUSES.has(error?.status)) return true
  if (error?.name === 'AbortError') return false
  if (error instanceof TypeError || error?.name === 'NetworkError') return true
  return /fetch|network|socket|stream.*(?:closed|disconnect)|terminated/i.test(error?.message || '')
}

function getStreamRetryDelayMs(retryCount) {
  const exponentialDelay = Math.min(
    STREAM_RETRY_MAX_DELAY_MS,
    STREAM_RETRY_MIN_DELAY_MS * STREAM_RETRY_BACKOFF_FACTOR ** Math.max(0, retryCount - 1),
  )
  return Math.round(exponentialDelay * (0.5 + Math.random() * 0.5))
}

export async function waitForChatgptWebStreamRetry(retryCount, signal) {
  await waitWithAbort(getStreamRetryDelayMs(retryCount), signal)
}

function setResumeHeader(headers, name, value) {
  const existingName = Object.keys(headers).find(
    (headerName) => headerName.toLowerCase() === name.toLowerCase(),
  )
  headers[existingName || name] = value
}

function decodeJsonPointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolvePatchTarget(target, pathSegments) {
  let cursor = target
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index]
    const nextSegment = pathSegments[index + 1]
    if (!cursor || typeof cursor !== 'object') return null
    if (!Object.prototype.hasOwnProperty.call(cursor, segment) || cursor[segment] == null) {
      cursor[segment] = /^\d+$/.test(nextSegment) || nextSegment === '-' ? [] : {}
    }
    cursor = cursor[segment]
  }
  if (!cursor || typeof cursor !== 'object') return null
  return { container: cursor, key: pathSegments.at(-1) }
}

export function applyResumePatch(target, operation = {}) {
  const rawPath = typeof operation.p === 'string' ? operation.p : ''
  if (!rawPath.startsWith('/') || rawPath === '/') return false
  const pathSegments = rawPath.split('/').slice(1).map(decodeJsonPointerSegment)
  if (
    pathSegments.length === 0 ||
    pathSegments.some((part) => FORBIDDEN_PATCH_SEGMENTS.has(part))
  ) {
    return false
  }

  const resolved = resolvePatchTarget(target, pathSegments)
  if (!resolved) return false
  const { container, key } = resolved
  const value = operation.v

  switch (operation.o) {
    case 'append': {
      const current = container[key]
      if (typeof current === 'string') container[key] = `${current}${value ?? ''}`
      else if (Array.isArray(current)) current.push(value)
      else if (current && typeof current === 'object' && value && typeof value === 'object') {
        Object.assign(current, value)
      } else if (current == null) container[key] = Array.isArray(value) ? [...value] : value
      else return false
      return true
    }
    case 'replace':
      container[key] = value
      return true
    case 'add':
      if (Array.isArray(container) && key === '-') container.push(value)
      else container[key] = value
      return true
    case 'remove':
      if (Array.isArray(container) && /^\d+$/.test(key)) container.splice(Number(key), 1)
      else delete container[key]
      return true
    default:
      return false
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function summarizeAssistantMessage(entry, order) {
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

  return {
    id: message.id || null,
    order,
    status,
    channel: message.channel || null,
    contentType: message.content?.content_type || '',
    endTurn: message.end_turn === true,
    isPending: isPendingChatgptWebMessageStatus(status),
    isFinal: isFinalChatgptWebMessageStatus(status) || Boolean(text && message.end_turn),
    text,
    textLength: text.length,
    thoughts,
    thoughtCount: thoughts.length,
    message,
  }
}

function pickBestResumeMessage(messages) {
  const score = (message) =>
    (message.textLength > 0 ? 10_000 : 0) +
    (message.channel === 'final' ? 2_000 : 0) +
    (message.contentType === 'text' ? 1_000 : 0) +
    (message.contentType === 'multimodal_text' ? 900 : 0) +
    (message.contentType === 'code' ? 800 : 0) +
    (message.isFinal ? 500 : 0) +
    message.order

  return [...messages].sort((left, right) => score(right) - score(left))[0] || null
}

export function createChatgptWebResumeDeltaAccumulator() {
  const entries = new Map()
  let activeCursor = null
  let authoritativeDone = false
  let eventCount = 0
  let title = ''
  let inputMessage = null
  let handoff = null

  function markAuthoritativeDone() {
    authoritativeDone = true
  }

  function feedEvent(eventName, payload) {
    if (!payload || typeof payload !== 'object') return false
    eventCount += 1

    if (eventName === 'message_stream_complete') {
      markAuthoritativeDone()
      return false
    }

    if (!eventName) {
      if (payload.type === 'message_stream_complete') markAuthoritativeDone()
      else if (payload.type === 'title_generation') {
        title = typeof payload.title === 'string' ? payload.title : title
      } else if (payload.type === 'stream_handoff') handoff = payload
      else if (payload.type === 'input_message')
        inputMessage = payload.input_message || inputMessage
      return false
    }

    if (eventName !== 'delta') return false
    if (payload.c != null) activeCursor = payload.c
    const cursor = payload.c != null ? payload.c : activeCursor
    if (cursor == null) return false

    if (payload.o === 'add' && payload.v && typeof payload.v === 'object') {
      entries.set(cursor, cloneJson(payload.v))
      return true
    }
    if (!entries.has(cursor) && payload.v?.message) {
      entries.set(cursor, cloneJson(payload.v))
      return true
    }
    if (!entries.has(cursor) || !Array.isArray(payload.v)) return false

    const entry = entries.get(cursor)
    return payload.v.reduce(
      (changed, operation) => applyResumePatch(entry, operation) || changed,
      false,
    )
  }

  function getAssistantMessages() {
    return [...entries.values()]
      .map((entry, index) => summarizeAssistantMessage(entry, index))
      .filter(Boolean)
  }

  function getResult() {
    const assistantMessages = getAssistantMessages()
    const bestMessage = pickBestResumeMessage(assistantMessages)
    const completed = Boolean(
      authoritativeDone &&
        bestMessage?.text &&
        bestMessage.isFinal &&
        bestMessage.isPending !== true,
    )
    return {
      authoritativeDone,
      completed,
      eventCount,
      title,
      inputMessage,
      handoff,
      bestMessage,
      assistantMessages,
    }
  }

  return { feedEvent, getAssistantMessages, getResult, markAuthoritativeDone }
}

export async function consumeChatgptWebResumeDeltaStream({
  url,
  headers,
  body,
  signal,
  fetchSSE,
  onMessageSnapshot,
  onHandoff,
  maxRetries = CHATGPT_WEB_STREAM_MAX_RETRIES,
  waitForRetry = waitForChatgptWebStreamRetry,
}) {
  const accumulator = createChatgptWebResumeDeltaAccumulator()
  const resumeHeaders = { ...headers }
  const resumeBody = { ...body }
  let offset = Number.isInteger(body?.offset) && body.offset >= 0 ? body.offset : 0
  let retryCount = 0
  let finished = false

  while (!finished) {
    try {
      await fetchSSE(url, {
        method: 'POST',
        signal,
        credentials: 'include',
        headers: resumeHeaders,
        body: JSON.stringify({ ...resumeBody, offset }),
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
          offset += 1
          const eventName = event.event || ''
          if (typeof event.data === 'string' && event.data.trim() === '[DONE]') {
            accumulator.markAuthoritativeDone()
            return
          }
          if (eventName === 'message_stream_complete') {
            accumulator.markAuthoritativeDone()
          }

          let payload = null
          try {
            payload = event.data ? JSON.parse(event.data) : null
          } catch {
            return
          }
          if (!payload || typeof payload !== 'object') return

          if (payload.type === 'resume_conversation_token') {
            if (typeof payload.token === 'string' && payload.token.trim()) {
              setResumeHeader(resumeHeaders, 'X-Conduit-Token', payload.token.trim())
            }
            if (typeof payload.conversation_id === 'string' && payload.conversation_id.trim()) {
              resumeBody.conversation_id = payload.conversation_id.trim()
            }
          }
          if (payload.type === 'stream_handoff') onHandoff?.(payload)
          if (payload.conversation_id && payload.message) {
            onMessageSnapshot?.({
              conversation_id: payload.conversation_id,
              message: payload.message,
            })
          }

          if (!accumulator.feedEvent(eventName, payload)) return
          const bestMessage = accumulator.getResult().bestMessage
          if (!bestMessage?.message) return
          onMessageSnapshot?.({
            conversation_id: resumeBody.conversation_id,
            message: bestMessage.message,
          })
        },
      })
      finished = true
    } catch (error) {
      if (retryCount >= maxRetries || !isRetryableChatgptWebStreamError(error)) throw error
      retryCount += 1
      await waitForRetry(retryCount, signal)
    }
  }

  return { ...accumulator.getResult(), offset, retryCount }
}
