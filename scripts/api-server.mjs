import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = parseInt(process.env.CHATGPT_GATEWAY_PORT || '18080', 10)

const AVAILABLE_MODELS = [
  { id: 'gpt-5-2', name: 'GPT-5.2' },
  { id: 'gpt-5-2-instant', name: 'GPT-5.2 Instant' },
  { id: 'gpt-5-2-thinking', name: 'GPT-5.2 Thinking' },
  { id: 'gpt-5-2-pro', name: 'GPT-5.2 Pro' },
  { id: 'gpt-5-1', name: 'GPT-5.1' },
  { id: 'gpt-5-1-thinking', name: 'GPT-5.1 Thinking' },
  { id: 'gpt-5-1-instant', name: 'GPT-5.1 Instant' },
  { id: 'gpt-5-1-pro', name: 'GPT-5.1 Pro' },
]

let bridgeWs = null
const pendingRequests = new Map()

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
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

async function handleChatCompletions(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }))
    return
  }

  const model = body.model || 'gpt-5-2'
  const messages = body.messages || []
  const stream = body.stream === true
  const completionId = makeCompletionId()

  if (!bridgeWs || bridgeWs.readyState !== 1) {
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
        safeWrite(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`)
        safeWrite('data: [DONE]\n\n')
        safeEnd()
        log(`Request ${completionId}: error - ${err.message}`)
      },
    })

    bridgeWs.send(JSON.stringify({ type: 'request', id: requestId, model, messages, stream }))
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

        bridgeWs.send(JSON.stringify({ type: 'request', id: requestId, model, messages, stream }))
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
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { message: err.message, type: 'server_error' },
        }),
      )
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
      bridge_connected: bridgeWs !== null && bridgeWs.readyState === 1,
      pending_requests: pendingRequests.size,
    }),
  )
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    handleModels(res)
  } else if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    handleChatCompletions(req, res).catch((err) => {
      log(`Unhandled error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Internal server error' } }))
      }
    })
  } else if (url.pathname === '/status' && req.method === 'GET') {
    handleStatus(res)
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { message: `Not found: ${url.pathname}`, type: 'invalid_request_error' },
      }),
    )
  }
})

const wss = new WebSocketServer({ server, path: '/bridge' })

wss.on('connection', (ws) => {
  log('Extension bridge connected')
  bridgeWs = ws

  ws.on('close', () => {
    log('Extension bridge disconnected')
    bridgeWs = null
    for (const [, req] of pendingRequests) {
      req.reject(new Error('Extension bridge disconnected'))
    }
    pendingRequests.clear()
  })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
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
      pending.reject(new Error(msg.error || 'Unknown error from extension'))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  log(`ChatGPT Web API Gateway listening on http://127.0.0.1:${PORT}`)
  log(`Endpoints:`)
  log(`  POST http://127.0.0.1:${PORT}/v1/chat/completions  (OpenAI-compatible)`)
  log(`  GET  http://127.0.0.1:${PORT}/v1/models`)
  log(`  GET  http://127.0.0.1:${PORT}/status`)
  log(``)
  log(`Next: Open the extension's API Server page in Chrome to connect the bridge.`)
})
