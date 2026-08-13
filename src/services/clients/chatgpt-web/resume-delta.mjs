import {
  extractChatgptWebMessageText,
  isFinalChatgptWebMessageStatus,
  isPendingChatgptWebMessageStatus,
} from './conversation-state.mjs'

const FORBIDDEN_PATCH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const STREAM_RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 502, 504])
const DELTA_SHORT_KEYS = [
  ['channel', 'c'],
  ['path', 'p'],
  ['op', 'o'],
  ['value', 'v'],
]
const NUMERIC_PATH_SEGMENT = /^(?:0|[1-9]\d*)$/

// Nested HTTP resume (`kTt`): default MAX_RETRY_COUNT is 12.
export const CHATGPT_WEB_STREAM_MAX_RETRIES = 12
export const CHATGPT_WEB_STREAM_NO_DONE = 'CHATGPT_WEB_STREAM_NO_DONE'
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

export function isChatgptWebResumeDoneEvent(event) {
  return event?.type === 'event' && typeof event.data === 'string' && event.data.trim() === '[DONE]'
}

export function shouldCountChatgptWebResumeOffsetEvent(event) {
  if (!event || event.type !== 'event') return false
  if ((event.event || '') === 'ping') return false
  if (event.data == null || event.data === '') return false
  if (isChatgptWebResumeDoneEvent(event)) return false
  return true
}

export function isRetryableChatgptWebStreamError(error) {
  if (error?.code === CHATGPT_WEB_STREAM_NO_DONE) return true
  if (STREAM_RETRYABLE_HTTP_STATUSES.has(error?.status)) return true
  if (error?.name === 'AbortError') return false
  if (error instanceof TypeError || error?.name === 'NetworkError') return true
  return /fetch|network|socket|stream.*(?:closed|disconnect)|terminated|no done event received/i.test(
    error?.message || '',
  )
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
    case 'truncate':
      if (typeof container[key] === 'string') {
        container[key] = container[key].substring(0, value)
        return true
      }
      if (Array.isArray(container[key])) {
        container[key].length = Number(value) || 0
        return true
      }
      return false
    default:
      return false
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function carryForwardDelta(raw, previousLong) {
  const next = { ...raw }
  for (const [longName, shortName] of DELTA_SHORT_KEYS) {
    if (longName === 'value') continue
    if (!(shortName in raw)) next[shortName] = previousLong[longName]
  }
  return next
}

function expandDeltaKeys(raw) {
  const next = { ...raw }
  for (const [longName, shortName] of DELTA_SHORT_KEYS) {
    if (shortName in raw) {
      next[longName] = raw[shortName]
      delete next[shortName]
    }
  }
  if (next.op === 'patch' && Array.isArray(next.value)) {
    next.value = next.value.map(expandDeltaKeys)
  }
  return next
}

function parseDeltaPath(path) {
  const segments = ['__root']
  if (path == null || path === '') return segments
  let rest = String(path)
  if (rest.startsWith('/')) rest = rest.slice(1)
  for (const part of rest.split('/')) {
    if (FORBIDDEN_PATCH_SEGMENTS.has(part)) {
      throw new Error('Forbidden delta path segment')
    }
    segments.push(
      NUMERIC_PATH_SEGMENT.test(part) ? parseInt(part, 10) : decodeJsonPointerSegment(part),
    )
  }
  return segments
}

function applyDeltaOperation(root, operation) {
  const pathSegments = parseDeltaPath(operation.path ?? '')
  const key = pathSegments.pop()
  if (key === undefined) throw new Error('Unexpected empty delta path')

  let cursor = root
  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index]
    const nextSegment = pathSegments[index + 1] ?? key
    if (cursor[segment] === undefined) {
      cursor[segment] = typeof nextSegment === 'number' ? [] : {}
    }
    cursor = cursor[segment]
    if (!cursor || typeof cursor !== 'object') {
      throw new Error('Unexpected delta path container')
    }
  }

  switch (operation.op) {
    case 'patch': {
      if (!Array.isArray(operation.value)) throw new Error('Unknown json delta operation')
      for (const nested of operation.value) {
        const wrapper = { __root: cursor[key] }
        applyDeltaOperation(wrapper, nested)
        cursor[key] = wrapper.__root
      }
      return
    }
    case 'add':
      if (Array.isArray(cursor)) cursor.splice(key, 0, operation.value)
      else cursor[key] = operation.value
      return
    case 'remove':
      if (Array.isArray(cursor)) cursor.splice(key, 1)
      else delete cursor[key]
      return
    case 'replace':
      cursor[key] = operation.value
      return
    case 'append': {
      const current = cursor[key]
      if (typeof current === 'string') cursor[key] = `${current}${operation.value ?? ''}`
      else if (Array.isArray(current)) {
        cursor[key].push(...(Array.isArray(operation.value) ? operation.value : [operation.value]))
      } else if (isPlainObject(current) && isPlainObject(operation.value)) {
        Object.assign(current, operation.value)
      } else cursor[key] = operation.value
      return
    }
    case 'truncate':
      if (typeof cursor[key] === 'string') cursor[key] = cursor[key].substring(0, operation.value)
      else if (Array.isArray(cursor[key])) cursor[key].length = Number(operation.value) || 0
      return
    default:
      throw new Error('Unknown json delta operation')
  }
}

function createChatgptWebDeltaV1Decoder() {
  let previousDelta = { channel: 0, op: 'add', path: '', value: undefined }
  const previousValueByChannel = []

  return {
    applyDelta(raw) {
      if (!raw || typeof raw !== 'object') throw new Error('Unexpected delta non-object')
      const decoded = expandDeltaKeys(carryForwardDelta(raw, previousDelta))
      previousDelta = decoded
      const root = { __root: cloneJson(previousValueByChannel[decoded.channel]) }
      applyDeltaOperation(root, decoded)
      previousValueByChannel[decoded.channel] = root.__root
      return { channel: decoded.channel, value: root.__root }
    },
  }
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
  const decoder = createChatgptWebDeltaV1Decoder()
  let authoritativeDone = false
  let eventCount = 0
  let title = ''
  let inputMessage = null
  let handoff = null

  function markAuthoritativeDone() {
    authoritativeDone = true
  }

  function feedEvent(eventName, payload) {
    if (eventName === 'delta_encoding') {
      const encoding =
        typeof payload === 'string'
          ? payload
          : payload && typeof payload === 'object'
          ? payload.encoding || payload.v || payload.value
          : ''
      if (encoding && String(encoding).trim() && String(encoding).trim() !== 'v1') {
        throw new Error(`[delta] unknown delta encoding: ${encoding}`)
      }
      return false
    }

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

    const applied = decoder.applyDelta(payload)
    if (!applied?.value || typeof applied.value !== 'object') return false
    entries.set(applied.channel, applied.value)
    return true
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

function createMissingDoneError() {
  const error = new Error('No done event received')
  error.code = CHATGPT_WEB_STREAM_NO_DONE
  return error
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
    let streamAborted = false
    try {
      await fetchSSE(url, {
        method: 'POST',
        signal,
        credentials: 'include',
        headers: resumeHeaders,
        body: JSON.stringify({ ...resumeBody, offset }),
        onMessage() {},
        onStart() {},
        onEnd(info) {
          if (info?.aborted) streamAborted = true
        },
        onResponse() {},
        onError(error) {
          if (error?.name === 'AbortError') return
          throw error
        },
        onEvent(event) {
          if (event.type !== 'event') return
          if (isChatgptWebResumeDoneEvent(event)) {
            accumulator.markAuthoritativeDone()
            return
          }
          if (!shouldCountChatgptWebResumeOffsetEvent(event)) return
          offset += 1

          const eventName = event.event || ''
          if (eventName === 'delta_encoding') {
            accumulator.feedEvent('delta_encoding', event.data)
            return
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
      if (streamAborted || signal?.aborted) throw createAbortError()
      if (!accumulator.getResult().authoritativeDone) throw createMissingDoneError()
      finished = true
    } catch (error) {
      if (retryCount >= maxRetries || !isRetryableChatgptWebStreamError(error)) throw error
      retryCount += 1
      await waitForRetry(retryCount, signal)
    }
  }

  return { ...accumulator.getResult(), offset, retryCount }
}
