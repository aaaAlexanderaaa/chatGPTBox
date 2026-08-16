import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { needsChatgptWebThinkingEffort } from '../src/services/clients/chatgpt-web/thinking.mjs'
import {
  isBridgeRequestAuthorized as checkBridgeAuth,
  loadOrCreateBridgeToken,
} from './lib/bridge-auth.mjs'
import {
  fingerprintOperation,
  normalizeIdempotencyKey,
  OperationLedger,
} from './lib/operation-ledger.mjs'

// ---------------------------------------------------------------------------
// Configuration: CLI args > env vars > defaults
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)

function cliArg(name, fallback) {
  const prefix = `--${name}=`
  for (const a of argv) {
    if (a === `--${name}` && argv[argv.indexOf(a) + 1]) return argv[argv.indexOf(a) + 1]
    if (a.startsWith(prefix)) return a.slice(prefix.length)
  }
  return fallback
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const PORT = parseInt(cliArg('port', process.env.CHATGPT_GATEWAY_PORT || '18080'), 10)
const HOST = cliArg('host', process.env.CHATGPT_GATEWAY_HOST || '127.0.0.1')
const DEFAULT_REQUEST_TIMEOUT_SECONDS = parsePositiveInt(
  cliArg('timeout-seconds', process.env.CHATGPT_GATEWAY_TIMEOUT_SECONDS || '180'),
  180,
  30,
  3600,
)
const DEFAULT_THINKING_REQUEST_TIMEOUT_SECONDS = parsePositiveInt(
  cliArg(
    'thinking-timeout-seconds',
    process.env.CHATGPT_GATEWAY_THINKING_TIMEOUT_SECONDS || '2700',
  ),
  2700,
  30,
  7200,
)

const BRIDGE_TOKEN_FILE = path.join(os.homedir(), '.chatgptbox', 'gateway-bridge-token')
const OPERATION_LEDGER_FILE = path.join(os.homedir(), '.chatgptbox', 'gateway-operations.json')
const operationLedger = new OperationLedger({ file: OPERATION_LEDGER_FILE })

function rejectUnauthorizedBridge(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      error: {
        message:
          'Bridge authentication required. Paste the gateway bridge token into the extension ApiServer page.',
        type: 'invalid_request_error',
      },
    }),
  )
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`ChatGPT Web API Gateway

Usage:
  node scripts/api-server.mjs [options]
  npm run api-server -- [options]

Options:
  --port <number>   Port to listen on  (env: CHATGPT_GATEWAY_PORT, default: 18080)
  --host <address>  Address to bind to (env: CHATGPT_GATEWAY_HOST, default: 127.0.0.1)
  --timeout-seconds <number>
                    Timeout for regular requests
                    (env: CHATGPT_GATEWAY_TIMEOUT_SECONDS, default: 180)
  --thinking-timeout-seconds <number>
                    Timeout for thinking requests
                    (env: CHATGPT_GATEWAY_THINKING_TIMEOUT_SECONDS, default: 2700)
  --bridge-token <token>
                    Shared secret the extension bridge must present
                    (env: CHATGPT_GATEWAY_BRIDGE_TOKEN; generated and stored in
                    ~/.chatgptbox/gateway-bridge-token when unset)
  -h, --help        Show this help message

Examples:
  node scripts/api-server.mjs --port 9090
  CHATGPT_GATEWAY_PORT=9090 npm run api-server
`)
  process.exit(0)
}

if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Error: Invalid port "${cliArg('port', process.env.CHATGPT_GATEWAY_PORT)}".`)
  console.error('Port must be a number between 1 and 65535.')
  process.exit(1)
}

// Resolved after the early exits above: generating a token is a filesystem side
// effect, and `--help` must not have side effects.
const {
  token: BRIDGE_TOKEN,
  generated: BRIDGE_TOKEN_GENERATED,
  fromFile: BRIDGE_TOKEN_FROM_FILE,
} = loadOrCreateBridgeToken({
  tokenFile: BRIDGE_TOKEN_FILE,
  configuredToken: cliArg('bridge-token', process.env.CHATGPT_GATEWAY_BRIDGE_TOKEN),
})

function isBridgeRequestAuthorized(req, url) {
  return checkBridgeAuth(req, url, BRIDGE_TOKEN)
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const AVAILABLE_MODELS = [
  { id: 'gpt-5-6-thinking', name: 'GPT-5.6 Thinking' },
  { id: 'gpt-5-5-thinking', name: 'GPT-5.5 Thinking' },
  { id: 'gpt-5-5-pro', name: 'GPT-5.5 Pro' },
  { id: 'gpt-5-4-thinking', name: 'GPT-5.4 Thinking' },
  { id: 'gpt-5-4', name: 'GPT-5.4' },
  { id: 'gpt-5-4-instant', name: 'GPT-5.4 Instant' },
  { id: 'gpt-5-4-pro', name: 'GPT-5.4 Pro' },
  { id: 'gpt-5-3-thinking', name: 'GPT-5.3 Thinking' },
  { id: 'gpt-5-3', name: 'GPT-5.3' },
  { id: 'gpt-5-3-instant', name: 'GPT-5.3 Instant' },
  { id: 'gpt-5-2-thinking', name: 'GPT-5.2 Thinking' },
  { id: 'gpt-5-2', name: 'GPT-5.2' },
  { id: 'gpt-5-2-instant', name: 'GPT-5.2 Instant' },
  { id: 'gpt-5-2-pro', name: 'GPT-5.2 Pro' },
  { id: 'gpt-5-1-thinking', name: 'GPT-5.1 Thinking' },
  { id: 'gpt-5-1', name: 'GPT-5.1' },
  { id: 'gpt-5-1-instant', name: 'GPT-5.1 Instant' },
  { id: 'gpt-5-1-pro', name: 'GPT-5.1 Pro' },
  { id: 'grok-chat-fast', name: 'Grok (Web, Fast)' },
  { id: 'grok-chat-auto', name: 'Grok (Web, Auto)' },
  { id: 'grok-chat-expert', name: 'Grok (Web, Expert)' },
  { id: 'grok-chat-heavy', name: 'Grok (Web, Heavy)' },
]

const DEFAULT_MODEL = 'gpt-5-6-thinking'
const DEFAULT_THINKING_EFFORT = 'max'
const SUPPORTED_THINKING_EFFORTS = new Set(['standard', 'extended', 'max'])

// ---------------------------------------------------------------------------
// Bridge state (WebSocket + HTTP polling)
// ---------------------------------------------------------------------------

let bridgeWs = null
const pendingRequests = new Map()
const pendingControlRequests = new Map()
const bridgeRuntimeConfig = {
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000,
  thinkingRequestTimeoutMs: DEFAULT_THINKING_REQUEST_TIMEOUT_SECONDS * 1000,
}

let httpBridgeActive = false
let httpBridgeLastSeen = 0
const HTTP_BRIDGE_STALE_MS = 35_000
const httpBridgeQueue = []
const httpBridgePollWaiters = []

const stats = { startedAt: Date.now(), totalRequests: 0, totalErrors: 0 }
const STREAM_HEARTBEAT_MS = 15_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function logError(msg) {
  console.error(`[${new Date().toISOString()}] ERROR: ${msg}`)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

async function readBodyObject(req) {
  let rawBody = ''
  try {
    rawBody = await readBody(req)
  } catch {
    rawBody = ''
  }

  if (!rawBody) return {}

  try {
    const parsed = JSON.parse(rawBody)
    return parsed && typeof parsed === 'object' ? parsed : { raw: rawBody }
  } catch {
    /* fall through */
  }

  try {
    const params = new URLSearchParams(rawBody)
    const entries = [...params.entries()]
    if (entries.length > 0) {
      return Object.fromEntries(entries)
    }
  } catch {
    /* fall through */
  }

  return { raw: rawBody }
}

function makeCompletionId() {
  return 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
}

function makeStreamChunk(id, model, delta, finishReason) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  }
}

function getIdempotencyKey(req, body = {}) {
  return normalizeIdempotencyKey(
    req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      body.idempotency_key ||
      body.idempotencyKey,
  )
}

function beginWriteOperation(req, route, body, { requireIdempotencyKey = false } = {}) {
  const key = getIdempotencyKey(req, body)
  if (requireIdempotencyKey && !key) {
    return {
      kind: 'missing',
      error: {
        error: {
          message: 'Idempotency-Key is required for ChatGPT conversation write operations.',
          type: 'invalid_request_error',
          code: 'idempotency_key_required',
          retryable: false,
        },
      },
    }
  }
  const fingerprintBody = { ...body }
  delete fingerprintBody.idempotency_key
  delete fingerprintBody.idempotencyKey
  return operationLedger.begin({
    key,
    fingerprint: fingerprintOperation(route, fingerprintBody),
  })
}

function makeAmbiguousDispatchError(record, message) {
  return {
    error: {
      message:
        message ||
        'The write may have been accepted by ChatGPT Web. It will not be submitted again automatically.',
      type: 'server_error',
      code: 'ambiguous_dispatch',
      retryable: false,
      operation_id: record?.operationId || null,
    },
  }
}

function markOperationAmbiguous(record, error) {
  if (record?.state === 'completed') return
  try {
    operationLedger.ambiguous(record, error)
  } catch (ledgerError) {
    logError(ledgerError.message)
  }
}

function respondForExistingOperation(
  res,
  beginResult,
  { stream = false, completionId, model } = {},
) {
  if (beginResult.kind === 'new') return false
  const { record } = beginResult
  res.setHeader('X-Operation-Id', record.operationId)
  if (beginResult.kind === 'conflict') {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message: 'The Idempotency-Key was already used with a different request.',
          type: 'invalid_request_error',
          code: 'idempotency_key_conflict',
          retryable: false,
          operation_id: record.operationId,
        },
      }),
    )
    return true
  }
  if (record.state !== 'completed') {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(makeAmbiguousDispatchError(record, record.error)))
    return true
  }
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Idempotent-Replay': 'true',
    })
    const initial = makeStreamChunk(completionId, model, { role: 'assistant', content: '' }, null)
    const content = makeStreamChunk(
      completionId,
      model,
      { content: typeof record.result === 'string' ? record.result : '' },
      null,
    )
    res.write(`data: ${JSON.stringify(initial)}\n\n`)
    if (content.choices[0].delta.content) res.write(`data: ${JSON.stringify(content)}\n\n`)
    res.write(`data: ${JSON.stringify(makeStreamChunk(completionId, model, {}, 'stop'))}\n\n`)
    res.end('data: [DONE]\n\n')
    return true
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Idempotent-Replay': 'true',
  })
  if (typeof record.result === 'string') {
    res.end(
      JSON.stringify({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: record.result },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    )
  } else {
    res.end(JSON.stringify(record.result))
  }
  return true
}

function respondForControlWriteOperation(res, beginResult) {
  if (beginResult.kind === 'new') return false
  if (beginResult.kind === 'missing') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(beginResult.error))
    return true
  }
  return respondForExistingOperation(res, beginResult)
}

function getRequestTimeoutMs(model) {
  return needsChatgptWebThinkingEffort(model)
    ? bridgeRuntimeConfig.thinkingRequestTimeoutMs
    : bridgeRuntimeConfig.requestTimeoutMs
}

function applyBridgeRuntimeConfig(msg = {}) {
  const requestTimeoutSeconds = parsePositiveInt(
    msg.requestTimeoutSeconds,
    DEFAULT_REQUEST_TIMEOUT_SECONDS,
    30,
    3600,
  )
  const thinkingRequestTimeoutSeconds = parsePositiveInt(
    msg.thinkingRequestTimeoutSeconds,
    DEFAULT_THINKING_REQUEST_TIMEOUT_SECONDS,
    30,
    7200,
  )
  const nextRequestTimeoutMs = requestTimeoutSeconds * 1000
  const nextThinkingRequestTimeoutMs = thinkingRequestTimeoutSeconds * 1000
  const changed =
    bridgeRuntimeConfig.requestTimeoutMs !== nextRequestTimeoutMs ||
    bridgeRuntimeConfig.thinkingRequestTimeoutMs !== nextThinkingRequestTimeoutMs
  bridgeRuntimeConfig.requestTimeoutMs = nextRequestTimeoutMs
  bridgeRuntimeConfig.thinkingRequestTimeoutMs = nextThinkingRequestTimeoutMs
  if (changed) {
    log(
      `Bridge config updated: request_timeout=${requestTimeoutSeconds}s thinking_timeout=${thinkingRequestTimeoutSeconds}s`,
    )
  }
}

// ---------------------------------------------------------------------------
// Bridge abstraction
// ---------------------------------------------------------------------------

function isBridgeConnected() {
  if (bridgeWs && bridgeWs.readyState === 1) return true
  if (httpBridgeActive && Date.now() - httpBridgeLastSeen < HTTP_BRIDGE_STALE_MS) return true
  return false
}

function getBridgeType() {
  if (bridgeWs && bridgeWs.readyState === 1) return 'websocket'
  if (httpBridgeActive && Date.now() - httpBridgeLastSeen < HTTP_BRIDGE_STALE_MS) return 'http'
  return 'none'
}

function sendToBridge(message) {
  if (bridgeWs && bridgeWs.readyState === 1) {
    bridgeWs.send(JSON.stringify(message))
    return true
  }

  if (httpBridgeActive) {
    httpBridgeQueue.push(message)
    flushHttpBridgeQueue()
    return true
  }

  return false
}

function flushHttpBridgeQueue() {
  while (httpBridgeQueue.length > 0 && httpBridgePollWaiters.length > 0) {
    const msg = httpBridgeQueue.shift()
    const waiter = httpBridgePollWaiters.shift()
    clearTimeout(waiter.timeout)
    waiter.res.writeHead(200, { 'Content-Type': 'application/json' })
    waiter.res.end(JSON.stringify(msg))
  }
}

function rejectAllPending(reason) {
  for (const [, req] of pendingRequests) {
    req.reject(new Error(reason))
  }
  pendingRequests.clear()

  for (const [, req] of pendingControlRequests) {
    clearTimeout(req.timeout)
    req.reject(new Error(reason))
  }
  pendingControlRequests.clear()
}

// Periodically check HTTP bridge health
setInterval(() => {
  if (httpBridgeActive && Date.now() - httpBridgeLastSeen > HTTP_BRIDGE_STALE_MS) {
    httpBridgeActive = false
    log('HTTP bridge disconnected (poll timeout)')
    if (!isBridgeConnected()) {
      rejectAllPending('Extension bridge disconnected')
    }
  }
}, 5000)

// ---------------------------------------------------------------------------
// Handle incoming bridge messages (from either WebSocket or HTTP)
// ---------------------------------------------------------------------------

function handleBridgeMessage(msg) {
  if (msg.type === 'bridge_config') {
    applyBridgeRuntimeConfig(msg)
    return
  }

  if (msg.type === 'control_response' || msg.type === 'control_error') {
    const pendingControl = pendingControlRequests.get(msg.id)
    if (!pendingControl) return
    pendingControlRequests.delete(msg.id)
    clearTimeout(pendingControl.timeout)
    if (msg.type === 'control_response') {
      pendingControl.resolve(msg.data)
    } else {
      pendingControl.reject(new Error(msg.error || 'Unknown control error from extension'))
    }
    return
  }

  const pending = pendingRequests.get(msg.id)
  if (!pending) return

  if (msg.type === 'chunk') {
    pending.onChunk(msg.answer)
  } else if (msg.type === 'done') {
    pending.onChunk(msg.answer)
    pending.resolve(msg.answer)
  } else if (msg.type === 'error') {
    stats.totalErrors++
    pending.reject(new Error(msg.error || 'Unknown error from extension'))
  }
}

function sendControlRequestToBridge(
  action,
  payload,
  timeoutMs = bridgeRuntimeConfig.requestTimeoutMs,
) {
  if (!isBridgeConnected()) {
    return Promise.reject(new Error('Extension bridge not connected'))
  }

  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingControlRequests.delete(id)
      reject(new Error(`Control request timed out after ${Math.round(timeoutMs / 1000)} seconds`))
    }, timeoutMs)

    pendingControlRequests.set(id, { resolve, reject, timeout })

    try {
      const sent = sendToBridge({
        type: 'control_request',
        id,
        action,
        payload,
      })
      if (!sent) {
        clearTimeout(timeout)
        pendingControlRequests.delete(id)
        reject(new Error('Extension bridge not connected'))
      }
    } catch (error) {
      clearTimeout(timeout)
      pendingControlRequests.delete(id)
      reject(error)
    }
  })
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

async function handleChatCompletions(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }))
    return
  }

  const model = body.model || DEFAULT_MODEL
  const messages = body.messages
  const stream = body.stream === true
  const requestedThinkingEffort = body.thinking_effort || body.reasoning_effort
  const thinkingEffort =
    requestedThinkingEffort || (model === DEFAULT_MODEL ? DEFAULT_THINKING_EFFORT : '')
  const completionId = makeCompletionId()
  const requestTimeoutMs = getRequestTimeoutMs(model)

  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message: 'messages must be a non-empty array',
          type: 'invalid_request_error',
        },
      }),
    )
    return
  }

  if (thinkingEffort && !SUPPORTED_THINKING_EFFORTS.has(thinkingEffort)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message: 'reasoning_effort/thinking_effort must be one of: standard, extended, max',
          type: 'invalid_request_error',
        },
      }),
    )
    return
  }

  if (!isBridgeConnected()) {
    const bridgeType = getBridgeType()
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message:
            'Extension bridge not connected. Open the API Server page in the extension first.',
          type: 'server_error',
          details: {
            bridge_type: bridgeType,
            hint: 'Run chrome.tabs.create({url: chrome.runtime.getURL("ApiServer.html")}) from the service worker console, or enable the API Server in extension settings.',
          },
        },
      }),
    )
    return
  }

  stats.totalRequests++
  log(`Request ${completionId}: model=${model} messages=${messages.length} stream=${stream}`)

  // OpenAI-compatible requests must work without any gateway-specific headers.
  const operationBegin = beginWriteOperation(req, '/v1/chat/completions', body)
  if (respondForExistingOperation(res, operationBegin, { stream, completionId, model })) return
  const operation = operationBegin.record
  res.setHeader('X-Operation-Id', operation.operationId)

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()

    const initialChunk = makeStreamChunk(
      completionId,
      model,
      { role: 'assistant', content: '' },
      null,
    )
    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`)

    let previousAnswer = ''

    const requestId = crypto.randomUUID()
    const state = { resolved: false, clientDisconnected: false, nonMonotonic: false }

    function safeWrite(data) {
      if (res.destroyed || res.writableEnded) return false
      try {
        res.write(data)
        return true
      } catch {
        return false
      }
    }

    function safeEnd() {
      if (res.destroyed || res.writableEnded) return
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }

    const heartbeat = setInterval(() => {
      if (state.resolved) return
      safeWrite(': keep-alive\n\n')
    }, STREAM_HEARTBEAT_MS)

    function cleanup() {
      state.resolved = true
      clearTimeout(timeout)
      clearInterval(heartbeat)
      pendingRequests.delete(requestId)
    }

    res.on('close', () => {
      if (!state.resolved) {
        state.clientDisconnected = true
        clearInterval(heartbeat)
        markOperationAmbiguous(operation, new Error('Client disconnected before completion'))
        log(`Request ${completionId}: client disconnected; awaiting bridge completion`)
      }
    })

    const timeout = setTimeout(() => {
      if (!state.resolved) {
        cleanup()
        stats.totalErrors++
        markOperationAmbiguous(operation, new Error('Gateway request timed out'))
        safeWrite(
          `data: ${JSON.stringify(
            makeAmbiguousDispatchError(operation, 'Gateway request timed out after dispatch'),
          )}\n\n`,
        )
        safeEnd()
      }
    }, requestTimeoutMs)

    pendingRequests.set(requestId, {
      onChunk(answer) {
        if (state.resolved) return
        const nextAnswer = typeof answer === 'string' ? answer : ''
        if (!nextAnswer) return
        if (previousAnswer && !nextAnswer.startsWith(previousAnswer)) {
          state.nonMonotonic = true
          log(
            `Request ${completionId}: rejected non-monotonic stream snapshot prev=${previousAnswer.length} next=${nextAnswer.length}`,
          )
          return
        }
        const delta = nextAnswer.slice(previousAnswer.length)
        previousAnswer = nextAnswer
        if (delta) {
          const chunk = makeStreamChunk(completionId, model, { content: delta }, null)
          safeWrite(`data: ${JSON.stringify(chunk)}\n\n`)
        }
      },
      resolve(answer) {
        if (state.resolved) return
        if (state.nonMonotonic) {
          this.reject(new Error('ChatGPT returned a non-monotonic final stream snapshot'))
          return
        }
        try {
          operationLedger.complete(operation, typeof answer === 'string' ? answer : previousAnswer)
        } catch (error) {
          this.reject(error)
          return
        }
        cleanup()
        if (!state.clientDisconnected) {
          safeWrite(`data: ${JSON.stringify(makeStreamChunk(completionId, model, {}, 'stop'))}\n\n`)
          safeWrite('data: [DONE]\n\n')
          safeEnd()
        }
        log(`Request ${completionId}: completed (streamed)`)
      },
      reject(err) {
        if (state.resolved) return
        cleanup()
        stats.totalErrors++
        markOperationAmbiguous(operation, err)
        safeWrite(`data: ${JSON.stringify(makeAmbiguousDispatchError(operation, err.message))}\n\n`)
        safeEnd()
        log(`Request ${completionId}: error - ${err.message}`)
      },
    })

    sendToBridge({
      type: 'request',
      id: requestId,
      model,
      messages,
      stream,
      thinkingEffort,
      operationId: operation.operationId,
    })
  } else {
    try {
      const requestId = crypto.randomUUID()
      const result = await new Promise((resolve, reject) => {
        const state = { answer: '', settled: false, clientDisconnected: false }

        function settle() {
          state.settled = true
          clearTimeout(timeout)
          pendingRequests.delete(requestId)
        }

        const timeout = setTimeout(() => {
          if (!state.settled) {
            settle()
            markOperationAmbiguous(operation, new Error('Gateway request timed out'))
            reject(
              new Error(`Request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds`),
            )
          }
        }, requestTimeoutMs)

        res.on('close', () => {
          if (!state.settled) {
            state.clientDisconnected = true
            markOperationAmbiguous(operation, new Error('Client disconnected'))
            log(`Request ${completionId}: client disconnected; awaiting bridge completion`)
          }
        })

        pendingRequests.set(requestId, {
          onChunk(answer) {
            state.answer = answer
          },
          resolve() {
            if (state.settled) return
            settle()
            resolve(state.answer)
          },
          reject(err) {
            if (state.settled) return
            settle()
            reject(err)
          },
        })

        sendToBridge({
          type: 'request',
          id: requestId,
          model,
          messages,
          stream,
          thinkingEffort,
          operationId: operation.operationId,
        })
      })

      operationLedger.complete(operation, result)

      const response = {
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
      log(`Request ${completionId}: completed`)
    } catch (err) {
      stats.totalErrors++
      markOperationAmbiguous(operation, err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
      }
      if (!res.writableEnded) {
        res.end(
          JSON.stringify({
            error: { message: err.message, type: 'server_error' },
          }),
        )
      }
      log(`Request ${completionId}: error - ${err.message}`)
    }
  }
}

let cachedModels = null
let cachedModelsAt = 0
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000

async function handleModels(res) {
  let models = null

  if (cachedModels && Date.now() - cachedModelsAt < MODEL_CACHE_TTL_MS) {
    models = cachedModels
  }

  if (!models) {
    if (isBridgeConnected()) {
      try {
        const slugs = await sendControlRequestToBridge('chatgpt_web_list_models', {}, 10_000)
        if (Array.isArray(slugs) && slugs.length > 0) {
          models = slugs
        }
      } catch (err) {
        log(`Model list fetch failed, using fallback: ${err.message}`)
      }
    }

    if (!models) {
      models = AVAILABLE_MODELS.map((m) => m.id)
    }

    if (isBridgeConnected()) {
      try {
        const grokSlugs = await sendControlRequestToBridge('grok_web_list_models', {}, 10_000)
        if (Array.isArray(grokSlugs) && grokSlugs.length > 0) {
          const seen = new Set(models)
          for (const id of grokSlugs) {
            if (typeof id === 'string' && id && !seen.has(id)) {
              seen.add(id)
              models.push(id)
            }
          }
        }
      } catch (err) {
        log(`Grok model list fetch failed, keeping ChatGPT list: ${err.message}`)
      }
    }

    cachedModels = models
    cachedModelsAt = Date.now()
  }

  const data = models.map((id) => ({
    id,
    object: 'model',
    created: 1700000000,
    owned_by: 'chatgpt-web',
  }))
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ object: 'list', data }))
}

function handleStatus(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      status: 'ok',
      bridge_connected: isBridgeConnected(),
      bridge_type: getBridgeType(),
      pending_requests: pendingRequests.size,
    }),
  )
}

function handleHealth(res) {
  const connected = isBridgeConnected()
  const uptimeMs = Date.now() - stats.startedAt
  const uptimeStr = `${Math.floor(uptimeMs / 3600000)}h ${Math.floor(
    (uptimeMs % 3600000) / 60000,
  )}m ${Math.floor((uptimeMs % 60000) / 1000)}s`

  const health = {
    status: connected ? 'healthy' : 'degraded',
    server: {
      uptime: uptimeStr,
      port: PORT,
      host: HOST,
    },
    bridge: {
      connected,
      type: getBridgeType(),
    },
    stats: {
      total_requests: stats.totalRequests,
      total_errors: stats.totalErrors,
      pending_requests: pendingRequests.size,
    },
    diagnostics: {},
    timeouts: {
      request_seconds: Math.round(bridgeRuntimeConfig.requestTimeoutMs / 1000),
      thinking_request_seconds: Math.round(bridgeRuntimeConfig.thinkingRequestTimeoutMs / 1000),
    },
  }

  if (!connected) {
    health.diagnostics.message =
      'No extension bridge is connected. The API server cannot process requests without it.'
    health.diagnostics.steps = [
      'Ensure the ChatGPTBox extension is installed and enabled.',
      'Open the API Server bridge page in the extension.',
      'Check that you are logged in at https://chatgpt.com.',
      'If using Brave, the bridge page will use HTTP polling automatically.',
    ]
  }

  res.writeHead(connected ? 200 : 503, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(health, null, 2))
}

async function handleChatgptConversationList(url, res) {
  if (!isBridgeConnected()) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message:
            'Extension bridge not connected. Open the API Server page in the extension first.',
          type: 'server_error',
        },
      }),
    )
    return
  }

  try {
    if (url.searchParams.get('force_sync') === 'true') {
      await sendControlRequestToBridge('chatgpt_web_sync_conversations', {
        mode: 'full',
        automatic: false,
        reason: 'gateway_force_sync',
        includeArchived: url.searchParams.get('is_archived') === 'true',
      })
    }
    const result = await sendControlRequestToBridge('chatgpt_web_list_conversations', {
      offset: url.searchParams.get('offset') || 0,
      limit: url.searchParams.get('limit') || 28,
      order: url.searchParams.get('order') || 'updated',
      isArchived: url.searchParams.get('is_archived') || false,
      isStarred: url.searchParams.get('is_starred') || false,
    })
    if (result == null) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: {
            message:
              'ChatGPT conversation list returned null from the extension bridge. Restart the local API server, rebuild/reload the extension, and retry.',
            type: 'server_error',
          },
        }),
      )
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: error.message, type: 'server_error' } }))
  }
}

async function handleChatgptConversationCreate(req, res) {
  if (!isBridgeConnected()) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message:
            'Extension bridge not connected. Open the API Server page in the extension first.',
          type: 'server_error',
        },
      }),
    )
    return
  }

  const body = await readBodyObject(req)
  const operationBegin = beginWriteOperation(req, '/chatgpt/conversations', body, {
    requireIdempotencyKey: true,
  })
  if (respondForControlWriteOperation(res, operationBegin)) return
  const operation = operationBegin.record
  res.setHeader('X-Operation-Id', operation.operationId)

  try {
    const query =
      (typeof body.query === 'string' && body.query.trim()) ||
      (typeof body.message === 'string' && body.message.trim()) ||
      (typeof body.raw === 'string' && body.raw.trim()) ||
      ''
    const result = await sendControlRequestToBridge(
      'chatgpt_web_create_conversation',
      {
        query,
        model: body.model,
        operationId: operation.operationId,
      },
      Math.min(60_000, bridgeRuntimeConfig.requestTimeoutMs),
    )
    if (result == null || typeof result?.conversationId !== 'string' || !result.conversationId) {
      throw new Error('Conversation creation returned no conversation ID')
    }
    operationLedger.complete(operation, result)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    markOperationAmbiguous(operation, error)
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(makeAmbiguousDispatchError(operation, error.message)))
  }
}

async function handleChatgptConversationGet(conversationId, url, res) {
  if (!isBridgeConnected()) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message:
            'Extension bridge not connected. Open the API Server page in the extension first.',
          type: 'server_error',
        },
      }),
    )
    return
  }

  try {
    const result = await sendControlRequestToBridge('chatgpt_web_get_conversation', {
      conversationId,
      userMessageId: url.searchParams.get('user_message_id') || undefined,
      assistantMessageId: url.searchParams.get('assistant_message_id') || undefined,
      think: url.searchParams.get('think') === 'true',
      forceRefresh: url.searchParams.get('force_refresh') === 'true',
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: error.message, type: 'server_error' } }))
  }
}

async function handleChatgptConversationRefresh(req, res, conversationId) {
  if (!isBridgeConnected()) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message:
            'Extension bridge not connected. Open the API Server page in the extension first.',
          type: 'server_error',
        },
      }),
    )
    return
  }

  const body = await readBodyObject(req)

  try {
    const result = await sendControlRequestToBridge('chatgpt_web_refresh_conversation', {
      conversationId,
      userMessageId: body.userMessageId,
      assistantMessageId: body.assistantMessageId,
      offset: body.offset,
      preferResume: body.preferResume,
      resumeTimeoutMs: body.resumeTimeoutMs,
      conduitToken: body.conduitToken,
      think: body.think,
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: error.message, type: 'server_error' } }))
  }
}

async function handleChatgptConversationMessage(req, res, conversationId) {
  if (!isBridgeConnected()) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message:
            'Extension bridge not connected. Open the API Server page in the extension first.',
          type: 'server_error',
        },
      }),
    )
    return
  }

  const body = await readBodyObject(req)
  const route = `/chatgpt/conversations/${conversationId}/messages`
  const operationBegin = beginWriteOperation(req, route, body, {
    requireIdempotencyKey: true,
  })
  if (respondForControlWriteOperation(res, operationBegin)) return
  const operation = operationBegin.record
  res.setHeader('X-Operation-Id', operation.operationId)

  try {
    const query =
      (typeof body.query === 'string' && body.query.trim()) ||
      (typeof body.message === 'string' && body.message.trim()) ||
      (typeof body.raw === 'string' && body.raw.trim()) ||
      ''
    const result = await sendControlRequestToBridge(
      'chatgpt_web_send_conversation_message',
      {
        conversationId,
        query,
        model: body.model,
        think: body.think === true,
        operationId: operation.operationId,
      },
      Math.min(60_000, bridgeRuntimeConfig.requestTimeoutMs),
    )
    if (result == null) throw new Error('Conversation message returned no acknowledgement')
    operationLedger.complete(operation, result)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    markOperationAmbiguous(operation, error)
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(makeAmbiguousDispatchError(operation, error.message)))
  }
}

// ---------------------------------------------------------------------------
// HTTP polling bridge endpoints
// ---------------------------------------------------------------------------

function handleBridgePoll(req, res, url) {
  if (!isBridgeRequestAuthorized(req, url)) {
    rejectUnauthorizedBridge(res)
    return
  }

  if (bridgeWs && bridgeWs.readyState === 1) {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: 'A WebSocket bridge is already connected. Only one bridge can be active.',
      }),
    )
    return
  }

  if (!httpBridgeActive) {
    httpBridgeActive = true
    log('HTTP polling bridge connected')
  }
  httpBridgeLastSeen = Date.now()

  if (httpBridgeQueue.length > 0) {
    const msg = httpBridgeQueue.shift()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(msg))
    return
  }

  const timeout = setTimeout(() => {
    const idx = httpBridgePollWaiters.findIndex((w) => w.res === res)
    if (idx !== -1) httpBridgePollWaiters.splice(idx, 1)
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'heartbeat' }))
    }
  }, 25000)

  httpBridgePollWaiters.push({ res, timeout })

  res.on('close', () => {
    clearTimeout(timeout)
    const idx = httpBridgePollWaiters.findIndex((w) => w.res === res)
    if (idx !== -1) httpBridgePollWaiters.splice(idx, 1)
  })
}

async function handleBridgeRespond(req, res, url) {
  if (!isBridgeRequestAuthorized(req, url)) {
    rejectUnauthorizedBridge(res)
    return
  }

  let msg
  try {
    msg = JSON.parse(await readBody(req))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON' }))
    return
  }

  httpBridgeLastSeen = Date.now()
  handleBridgeMessage(msg)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

function handleBridgeDisconnect(req, res, url) {
  if (!isBridgeRequestAuthorized(req, url)) {
    rejectUnauthorizedBridge(res)
    return
  }

  if (httpBridgeActive) {
    httpBridgeActive = false
    log('HTTP polling bridge disconnected (explicit)')
    for (const waiter of httpBridgePollWaiters) {
      clearTimeout(waiter.timeout)
      if (!waiter.res.destroyed && !waiter.res.writableEnded) {
        waiter.res.writeHead(200, { 'Content-Type': 'application/json' })
        waiter.res.end(JSON.stringify({ type: 'shutdown' }))
      }
    }
    httpBridgePollWaiters.length = 0
    if (!isBridgeConnected()) {
      rejectAllPending('Extension bridge disconnected')
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  // X-Bridge-Token is listed because the docs offer it as a carrier; without it a
  // browser preflight blocks the header and only ?token= / Bearer work.
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Bridge-Token, Idempotency-Key, X-Idempotency-Key',
  )
  res.setHeader('Access-Control-Expose-Headers', 'X-Operation-Id, X-Idempotent-Replay')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const conversationGetMatch = url.pathname.match(/^\/chatgpt\/conversations\/([^/]+)$/)
  const conversationMessageMatch = url.pathname.match(
    /^\/chatgpt\/conversations\/([^/]+)\/messages$/,
  )
  const conversationRefreshMatch = url.pathname.match(
    /^\/chatgpt\/conversations\/([^/]+)\/refresh$/,
  )

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    handleModels(res).catch((err) => {
      logError(`Model list error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    handleChatCompletions(req, res).catch((err) => {
      logError(`Unhandled error: ${err.message}`)
      stats.totalErrors++
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/status' && req.method === 'GET') {
    handleStatus(res)
  } else if (url.pathname === '/health' && req.method === 'GET') {
    handleHealth(res)
  } else if (url.pathname === '/chatgpt/conversations' && req.method === 'POST') {
    handleChatgptConversationCreate(req, res).catch((err) => {
      logError(`Conversation create error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/chatgpt/conversations' && req.method === 'GET') {
    handleChatgptConversationList(url, res).catch((err) => {
      logError(`Conversation list error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (conversationGetMatch && req.method === 'GET') {
    handleChatgptConversationGet(decodeURIComponent(conversationGetMatch[1]), url, res).catch(
      (err) => {
        logError(`Conversation get error: ${err.message}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
        }
      },
    )
  } else if (conversationMessageMatch && req.method === 'POST') {
    handleChatgptConversationMessage(
      req,
      res,
      decodeURIComponent(conversationMessageMatch[1]),
    ).catch((err) => {
      logError(`Conversation message error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (conversationRefreshMatch && req.method === 'POST') {
    handleChatgptConversationRefresh(
      req,
      res,
      decodeURIComponent(conversationRefreshMatch[1]),
    ).catch((err) => {
      logError(`Conversation refresh error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/bridge/poll' && req.method === 'GET') {
    handleBridgePoll(req, res, url)
  } else if (url.pathname === '/bridge/respond' && req.method === 'POST') {
    handleBridgeRespond(req, res, url).catch((err) => {
      logError(`Bridge respond error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/bridge/disconnect' && req.method === 'POST') {
    handleBridgeDisconnect(req, res, url)
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { message: `Not found: ${url.pathname}`, type: 'invalid_request_error' },
      }),
    )
  }
})

// ---------------------------------------------------------------------------
// WebSocket bridge
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true })

wss.on('error', () => {
  // Handled by server 'error' listener
})

// Handled manually rather than with `{ server, path }` so an unauthenticated
// upgrade is refused before the socket is ever accepted.
server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`)
  } catch {
    socket.destroy()
    return
  }

  if (url.pathname !== '/bridge') {
    socket.destroy()
    return
  }

  if (!isBridgeRequestAuthorized(req, url)) {
    logError(
      `Rejected unauthenticated bridge upgrade from origin "${req.headers.origin || 'none'}"`,
    )
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

wss.on('connection', (ws) => {
  // Reaching here means the token check passed, so a replacement can only come
  // from another authenticated bridge — normally the same page reconnecting.
  if (bridgeWs && bridgeWs.readyState === 1) {
    log('Replacing existing WebSocket bridge connection')
    bridgeWs.close(1000, 'Replaced by new bridge')
  }

  if (httpBridgeActive) {
    httpBridgeActive = false
    log('WebSocket bridge connected; HTTP polling bridge deactivated')
    for (const waiter of httpBridgePollWaiters) {
      clearTimeout(waiter.timeout)
      if (!waiter.res.destroyed && !waiter.res.writableEnded) {
        waiter.res.writeHead(200, { 'Content-Type': 'application/json' })
        waiter.res.end(JSON.stringify({ type: 'shutdown' }))
      }
    }
    httpBridgePollWaiters.length = 0
  } else {
    log('Extension bridge connected (WebSocket)')
  }

  bridgeWs = ws

  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) ws.ping()
  }, 20000)

  ws.on('close', () => {
    clearInterval(pingInterval)
    log('Extension bridge disconnected (WebSocket)')
    bridgeWs = null
    if (!isBridgeConnected()) {
      rejectAllPending('Extension bridge disconnected')
    }
  })

  ws.on('error', (err) => {
    logError(`WebSocket bridge error: ${err.message}`)
  })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type === 'ping') {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }))
      return
    }
    handleBridgeMessage(msg)
  })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logError(`Port ${PORT} is already in use.`)
    logError(`Try a different port: node scripts/api-server.mjs --port <number>`)
    logError(`Or set CHATGPT_GATEWAY_PORT=<number> in your environment.`)
  } else if (err.code === 'EACCES') {
    logError(`Permission denied for port ${PORT}. Try a port above 1024.`)
  } else {
    logError(`Server error: ${err.message}`)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  log(`ChatGPT Web API Gateway listening on http://${HOST}:${PORT}`)
  log(``)
  log(`Endpoints:`)
  log(`  POST http://${HOST}:${PORT}/v1/chat/completions  (OpenAI-compatible)`)
  log(`  GET  http://${HOST}:${PORT}/v1/models`)
  log(`  GET  http://${HOST}:${PORT}/status`)
  log(`  GET  http://${HOST}:${PORT}/health`)
  log(`  POST http://${HOST}:${PORT}/chatgpt/conversations`)
  log(`  GET  http://${HOST}:${PORT}/chatgpt/conversations`)
  log(`  GET  http://${HOST}:${PORT}/chatgpt/conversations/:id`)
  log(`  POST http://${HOST}:${PORT}/chatgpt/conversations/:id/messages`)
  log(`  POST http://${HOST}:${PORT}/chatgpt/conversations/:id/refresh`)
  log(``)
  log(`Bridge transports:`)
  log(`  WebSocket  ws://${HOST}:${PORT}/bridge`)
  log(`  HTTP poll  GET /bridge/poll + POST /bridge/respond`)
  log(``)
  log(`Bridge token${BRIDGE_TOKEN_GENERATED ? ' (generated)' : ''}: ${BRIDGE_TOKEN}`)
  if (BRIDGE_TOKEN_FROM_FILE) log(`  Stored in ${BRIDGE_TOKEN_FILE}`)
  log(`  Paste it into the extension's API Server page to pair the bridge.`)
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    log(``)
    logError(
      `Warning: bound to ${HOST}, so this gateway is reachable from other machines. ` +
        `Only the bridge is authenticated — the completion endpoints are not.`,
    )
  }
  log(``)
  log(`Next: Open the extension's API Server page to connect the bridge.`)
})
