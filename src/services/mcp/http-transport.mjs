import { createParser } from '../../utils/eventsource-parser.mjs'

export const DefaultMcpHttpOptions = {
  timeoutMs: 15000,
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
  return {
    timeoutMs: Math.max(1000, timeoutMs || DefaultMcpHttpOptions.timeoutMs),
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

function createTimeoutController(timeoutMs, externalSignal) {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`MCP HTTP timeout after ${timeoutMs}ms`))
  }, timeoutMs)
  const onAbort = () => {
    controller.abort(externalSignal?.reason || new Error('MCP HTTP request aborted'))
  }
  if (externalSignal) {
    if (externalSignal.aborted) onAbort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort)
    },
  }
}

function isRetryableStatus(statusCode) {
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode)
}

function isRetryableError(error) {
  if (!error) return false
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

async function parseEventStreamPayload(response, onEvent) {
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
    parser.feed(result.value)
  }

  const payload =
    parsedEvents.find((item) => item && typeof item === 'object' && ('result' in item || 'error' in item)) ||
    parsedEvents[parsedEvents.length - 1] ||
    null

  return {
    payload,
    events: rawEvents,
    parsedEvents,
    raw: rawEvents.join('\n'),
  }
}

async function parseHttpResponse(response, onEvent) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    return response.json()
  }
  if (contentType.includes('text/event-stream')) {
    const streamResult = await parseEventStreamPayload(response, onEvent)
    return streamResult.payload || streamResult
  }
  const text = await response.text()
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
    const timeout = createTimeoutController(normalizedOptions.timeoutMs, options.signal)
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
      return parseHttpResponse(response, options.onEvent)
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
