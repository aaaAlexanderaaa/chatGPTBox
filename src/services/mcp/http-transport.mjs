import { createParser } from '../../utils/eventsource-parser.mjs'

export const DefaultMcpHttpOptions = {
  timeoutMs: 15000,
  // Backstop for the idle deadline below: a server that drips a byte just often
  // enough to keep rearming `timeoutMs` would otherwise hold a request open
  // forever. Generous, because a legitimate tool call can stream for minutes.
  maxTotalMs: 600000,
  maxRetries: 2,
  retryDelayMs: 350,
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 2500,
}

function createRequestId() {
  if (globalThis?.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function ensureUrl(url, { requireHttps = false } = {}) {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  if (!trimmed) throw new Error('MCP server URL is required')
  if (requireHttps && !trimmed.startsWith('https://')) {
    throw new Error('MCP server URL must use HTTPS (switch to developer mode for HTTP)')
  }
  return trimmed
}

function normalizeOptions(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 0
  const maxRetries = Number.isFinite(options.maxRetries)
    ? Number(options.maxRetries)
    : DefaultMcpHttpOptions.maxRetries
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? Number(options.retryDelayMs) : 0
  const retryBackoffMultiplier = Number.isFinite(options.retryBackoffMultiplier)
    ? Number(options.retryBackoffMultiplier)
    : DefaultMcpHttpOptions.retryBackoffMultiplier
  const maxRetryDelayMs = Number.isFinite(options.maxRetryDelayMs)
    ? Number(options.maxRetryDelayMs)
    : DefaultMcpHttpOptions.maxRetryDelayMs
  const maxTotalMs = Number.isFinite(options.maxTotalMs) ? Number(options.maxTotalMs) : 0
  const resolvedTimeoutMs = Math.max(1000, timeoutMs || DefaultMcpHttpOptions.timeoutMs)
  return {
    timeoutMs: resolvedTimeoutMs,
    // Never below the idle deadline, or the ceiling would pre-empt it.
    maxTotalMs: Math.max(
      resolvedTimeoutMs,
      maxTotalMs || DefaultMcpHttpOptions.maxTotalMs,
    ),
    maxRetries: Math.max(0, maxRetries),
    retryDelayMs: Math.max(50, retryDelayMs || DefaultMcpHttpOptions.retryDelayMs),
    retryBackoffMultiplier: Math.max(1, retryBackoffMultiplier),
    maxRetryDelayMs: Math.max(100, maxRetryDelayMs),
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildHeaders(server, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...options.headers,
  }
  const apiKey = typeof server?.apiKey === 'string' ? server.apiKey.trim() : ''
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

// Two deadlines. The primary one is idle-based: it stays armed while the response
// body is consumed, but every chunk that arrives rearms it, so a slow tool call
// that keeps producing output is not cut off the way a single overall deadline
// would cut it off. `maxTotalMs` is the backstop, since an idle deadline alone
// can be held open indefinitely by a trickle of bytes.
//
// A timeout that fires *after* the server started sending is not retryable: the
// call may already have taken effect on the server, so re-POSTing it could
// duplicate a side effect. A timeout with no bytes received behaves as before.
function createTimeoutController(timeoutMs, maxTotalMs, externalSignal) {
  const controller = new AbortController()
  let sawActivity = false
  let idleTimer = null

  const abortWithTimeout = (message) => {
    const error = new Error(message)
    error.name = 'McpTimeoutError'
    error.mcpRetryable = !sawActivity
    controller.abort(error)
  }

  const armIdle = () => {
    idleTimer = setTimeout(
      () => abortWithTimeout(`MCP HTTP timeout after ${timeoutMs}ms of inactivity`),
      timeoutMs,
    )
  }
  armIdle()

  const totalTimer = setTimeout(
    () => abortWithTimeout(`MCP HTTP timeout after ${maxTotalMs}ms total`),
    maxTotalMs,
  )

  const onAbort = () => {
    controller.abort(externalSignal?.reason || new Error('MCP HTTP request aborted'))
  }
  if (externalSignal) {
    if (externalSignal.aborted) onAbort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    signal: controller.signal,
    keepAlive: () => {
      if (controller.signal.aborted) return
      sawActivity = true
      clearTimeout(idleTimer)
      armIdle()
    },
    cleanup: () => {
      clearTimeout(idleTimer)
      clearTimeout(totalTimer)
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort)
    },
  }
}

function isRetryableStatus(statusCode) {
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode)
}

function isRetryableError(error) {
  if (!error) return false
  // Set by the timeout controller: false once the server has started responding,
  // because the call may already have taken effect.
  if (error.mcpRetryable === false) return false
  const name = String(error.name || '')
  const message = String(error.message || '')
  if (name === 'RetryableHttpError') return true
  return (
    message.includes('network') ||
    message.includes('Network') ||
    message.includes('ECONN') ||
    message.includes('timeout')
  )
}

function parseJsonSafely(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function parseEventStreamPayload(response, onEvent, onActivity) {
  const reader = response.body?.getReader()
  if (!reader) {
    const raw = await response.text()
    return { raw, events: [], parsedEvents: [] }
  }

  const parsedEvents = []
  const rawEvents = []
  const parser = createParser((event) => {
    if (event.type === 'event') {
      rawEvents.push(event.data)
      const parsed = parseJsonSafely(event.data)
      if (parsed) parsedEvents.push(parsed)
      if (typeof onEvent === 'function') onEvent(event.data, parsed)
    }
  })

  let result
  while (!(result = await reader.read()).done) {
    // Any byte counts as liveness, including SSE comment heartbeats that the
    // parser never surfaces as events.
    if (typeof onActivity === 'function') onActivity()
    parser.feed(result.value)
  }

  const payload =
    parsedEvents.find(
      (item) => item && typeof item === 'object' && ('result' in item || 'error' in item),
    ) ||
    parsedEvents[parsedEvents.length - 1] ||
    null

  return {
    payload,
    events: rawEvents,
    parsedEvents,
    raw: rawEvents.join('\n'),
  }
}

// A non-streaming body is read chunk by chunk for the same reason a stream is:
// the idle deadline covers the whole body now that it is awaited, so a large but
// healthy download must be able to rearm it.
async function readBodyText(response, onActivity) {
  if (typeof onActivity !== 'function' || !response.body?.getReader) return response.text()

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let result
  while (!(result = await reader.read()).done) {
    onActivity()
    text += decoder.decode(result.value, { stream: true })
  }
  return text + decoder.decode()
}

async function parseHttpResponse(response, onEvent, onActivity) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    // Matches response.json(): a malformed body throws rather than resolving.
    return JSON.parse(await readBodyText(response, onActivity))
  }
  if (contentType.includes('text/event-stream')) {
    const streamResult = await parseEventStreamPayload(response, onEvent, onActivity)
    return streamResult.payload || streamResult
  }
  const text = await readBodyText(response, onActivity)
  const parsed = parseJsonSafely(text)
  return parsed || { raw: text }
}

async function executeWithRetries(executor, options) {
  const normalized = normalizeOptions(options)
  let attempt = 0
  let delayMs = normalized.retryDelayMs
  let lastError

  while (attempt <= normalized.maxRetries) {
    try {
      return await executor(normalized, attempt)
    } catch (error) {
      lastError = error
      if (options?.signal?.aborted) throw error
      const canRetry = attempt < normalized.maxRetries && isRetryableError(error)
      if (!canRetry) throw error
      await sleep(delayMs)
      delayMs = Math.min(normalized.maxRetryDelayMs, delayMs * normalized.retryBackoffMultiplier)
      attempt += 1
    }
  }

  throw lastError || new Error('MCP HTTP execution failed')
}

function assertMethodName(method) {
  if (typeof method !== 'string' || !method.trim()) {
    throw new Error('MCP method is required')
  }
}

function buildRpcRequest(method, params) {
  assertMethodName(method)
  return {
    jsonrpc: '2.0',
    id: createRequestId(),
    method,
    params: params && typeof params === 'object' ? params : {},
  }
}

export async function sendMcpJsonRpc(server, method, params = {}, options = {}) {
  const url = ensureUrl(server?.httpUrl, { requireHttps: options.requireHttps })
  const rpc = buildRpcRequest(method, params)
  return executeWithRetries(async (normalizedOptions) => {
    const timeout = createTimeoutController(
      normalizedOptions.timeoutMs,
      normalizedOptions.maxTotalMs,
      options.signal,
    )
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(server, options),
        body: JSON.stringify(rpc),
        signal: timeout.signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const error = new Error(
          `MCP HTTP ${response.status}: ${response.statusText}${text ? `\n${text}` : ''}`,
        )
        if (isRetryableStatus(response.status)) error.name = 'RetryableHttpError'
        throw error
      }
      // Awaited so the timeout and abort listener stay armed while the body is
      // consumed — an event stream that stalls mid-response must still time out.
      // `keepAlive` rearms the idle deadline per chunk so a stream that is merely
      // slow, rather than stuck, runs to completion.
      return await parseHttpResponse(response, options.onEvent, timeout.keepAlive)
    } finally {
      timeout.cleanup()
    }
  }, options)
}

export async function streamMcpJsonRpc(server, method, params = {}, handlers = {}, options = {}) {
  const payload = await sendMcpJsonRpc(server, method, params, {
    ...options,
    onEvent: (rawEvent, parsedEvent) => {
      if (typeof handlers.onRawEvent === 'function') handlers.onRawEvent(rawEvent)
      if (parsedEvent && typeof handlers.onMessage === 'function') handlers.onMessage(parsedEvent)
    },
  })
  if (payload?.error && typeof handlers.onError === 'function') handlers.onError(payload.error)
  return payload
}

function assertNoRpcError(payload) {
  if (payload?.error) {
    throw new Error(payload.error.message || JSON.stringify(payload.error))
  }
}

export async function listMcpTools(server, options = {}) {
  const payload = await sendMcpJsonRpc(server, 'tools/list', {}, options)
  assertNoRpcError(payload)
  return payload?.result?.tools || []
}

export async function callMcpTool(server, name, argumentsObject = {}, options = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('MCP tool name is required')
  const payload = await sendMcpJsonRpc(
    server,
    'tools/call',
    { name, arguments: argumentsObject },
    options,
  )
  assertNoRpcError(payload)
  return payload?.result
}

export function createMcpHttpClient(server, defaults = {}) {
  return {
    send(method, params = {}, options = {}) {
      return sendMcpJsonRpc(server, method, params, { ...defaults, ...options })
    },
    stream(method, params = {}, handlers = {}, options = {}) {
      return streamMcpJsonRpc(server, method, params, handlers, { ...defaults, ...options })
    },
    listTools(options = {}) {
      return listMcpTools(server, { ...defaults, ...options })
    },
    callTool(name, argumentsObject = {}, options = {}) {
      return callMcpTool(server, name, argumentsObject, { ...defaults, ...options })
    },
  }
}
