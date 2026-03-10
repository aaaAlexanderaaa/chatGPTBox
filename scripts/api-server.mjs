import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'

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

const PORT = parseInt(cliArg('port', process.env.CHATGPT_GATEWAY_PORT || '18080'), 10)
const HOST = cliArg('host', process.env.CHATGPT_GATEWAY_HOST || '127.0.0.1')

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`ChatGPT Web API Gateway

Usage:
  node scripts/api-server.mjs [options]
  npm run api-server -- [options]

Options:
  --port <number>   Port to listen on  (env: CHATGPT_GATEWAY_PORT, default: 18080)
  --host <address>  Address to bind to (env: CHATGPT_GATEWAY_HOST, default: 127.0.0.1)
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

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const AVAILABLE_MODELS = [
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
]

// ---------------------------------------------------------------------------
// Bridge state (WebSocket + HTTP polling)
// ---------------------------------------------------------------------------

let bridgeWs = null
const pendingRequests = new Map()

let httpBridgeActive = false
let httpBridgeLastSeen = 0
const HTTP_BRIDGE_STALE_MS = 35_000
const httpBridgeQueue = []
const httpBridgePollWaiters = []

const stats = { startedAt: Date.now(), totalRequests: 0, totalErrors: 0 }

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

  const model = body.model || 'gpt-5-4-thinking'
  const messages = body.messages
  const stream = body.stream === true
  const completionId = makeCompletionId()

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

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const initialChunk = makeStreamChunk(
      completionId,
      model,
      { role: 'assistant', content: '' },
      null,
    )
    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`)

    let previousAnswer = ''

    const requestId = crypto.randomUUID()
    const state = { resolved: false }

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

    function cleanup() {
      state.resolved = true
      clearTimeout(timeout)
      pendingRequests.delete(requestId)
    }

    res.on('close', () => {
      if (!state.resolved) {
        cleanup()
        log(`Request ${completionId}: client disconnected`)
      }
    })

    const timeout = setTimeout(() => {
      if (!state.resolved) {
        cleanup()
        stats.totalErrors++
        safeWrite(`data: ${JSON.stringify(makeStreamChunk(completionId, model, {}, 'error'))}\n\n`)
        safeWrite('data: [DONE]\n\n')
        safeEnd()
      }
    }, 120000)

    pendingRequests.set(requestId, {
      onChunk(answer) {
        if (state.resolved) return
        const delta = answer.slice(previousAnswer.length)
        previousAnswer = answer
        if (delta) {
          const chunk = makeStreamChunk(completionId, model, { content: delta }, null)
          safeWrite(`data: ${JSON.stringify(chunk)}\n\n`)
        }
      },
      resolve() {
        if (state.resolved) return
        cleanup()
        safeWrite(`data: ${JSON.stringify(makeStreamChunk(completionId, model, {}, 'stop'))}\n\n`)
        safeWrite('data: [DONE]\n\n')
        safeEnd()
        log(`Request ${completionId}: completed (streamed)`)
      },
      reject(err) {
        if (state.resolved) return
        cleanup()
        stats.totalErrors++
        safeWrite(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`)
        safeWrite('data: [DONE]\n\n')
        safeEnd()
        log(`Request ${completionId}: error - ${err.message}`)
      },
    })

    sendToBridge({ type: 'request', id: requestId, model, messages, stream })
  } else {
    try {
      const requestId = crypto.randomUUID()
      const result = await new Promise((resolve, reject) => {
        const state = { answer: '', settled: false }

        function settle() {
          state.settled = true
          clearTimeout(timeout)
          pendingRequests.delete(requestId)
        }

        const timeout = setTimeout(() => {
          if (!state.settled) {
            settle()
            reject(new Error('Request timed out after 120 seconds'))
          }
        }, 120000)

        res.on('close', () => {
          if (!state.settled) {
            settle()
            reject(new Error('Client disconnected'))
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

        sendToBridge({ type: 'request', id: requestId, model, messages, stream })
      })

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

function handleModels(res) {
  const data = AVAILABLE_MODELS.map((m) => ({
    id: m.id,
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

// ---------------------------------------------------------------------------
// HTTP polling bridge endpoints
// ---------------------------------------------------------------------------

function handleBridgePoll(req, res) {
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

async function handleBridgeRespond(req, res) {
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

function handleBridgeDisconnect(res) {
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`)

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    handleModels(res)
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
  } else if (url.pathname === '/bridge/poll' && req.method === 'GET') {
    handleBridgePoll(req, res)
  } else if (url.pathname === '/bridge/respond' && req.method === 'POST') {
    handleBridgeRespond(req, res).catch((err) => {
      logError(`Bridge respond error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/bridge/disconnect' && req.method === 'POST') {
    handleBridgeDisconnect(res)
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

const wss = new WebSocketServer({ server, path: '/bridge' })

wss.on('error', () => {
  // Handled by server 'error' listener
})

wss.on('connection', (ws) => {
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
  log(``)
  log(`Bridge transports:`)
  log(`  WebSocket  ws://${HOST}:${PORT}/bridge`)
  log(`  HTTP poll  GET /bridge/poll + POST /bridge/respond`)
  log(``)
  log(`Next: Open the extension's API Server page to connect the bridge.`)
})
