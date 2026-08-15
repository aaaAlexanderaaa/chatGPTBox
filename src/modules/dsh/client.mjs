// HTTP + WebSocket transport for a locally running DeepSeek Harness (`dsh web`).
//
// Wire protocol (no OpenAI-compatible surface exists, so this speaks the
// harness's own /api RPC gateway):
//   - Unary RPC:  POST /api/<method> with a client-request envelope; the HTTP
//     response body echoes the rpcId inside a server-response envelope whose
//     result slot is either { ok: true, value } or { ok: false, error }.
//   - Responding:  POST /api/respond with a client-response envelope (echoing
//     the rpcId of an answerable server-request, e.g. approvals).
//   - Events:      WebSocket upgrade on /api/events.mux. The stream is
//     downlink-only (any client→server frame closes the socket) and
//     multiplexes ALL sessions — callers filter frames by sessionId. Each WS
//     message is one server-request envelope; payload is the mux frame.
//
// The module deliberately has no extension imports: fetch and WebSocket are
// injected (defaulting to the globals) so the transport can be exercised from
// Node against a live harness in smoke tests.

/** RPC-level failure (result.ok === false): code/message come from the harness. */
export class DshRpcError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details) {
    super(`[dsh ${code}] ${message}`)
    this.name = 'DshRpcError'
    this.code = code
    this.details = details
  }
}

/** Carrier-level failure (non-200, bad envelope, dead socket). */
export class DshTransportError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, body?: string }} [info]
   */
  constructor(message, info = {}) {
    super(message)
    this.name = 'DshTransportError'
    this.status = info.status
    this.body = info.body
  }
}

/** HTTP 403 from the harness /api trust fence (cross-site/Origin defense). */
export function isDshFenceError(error) {
  return error instanceof DshTransportError && error.status === 403
}

/**
 * @param {object} [options]
 * @param {string} options.baseUrl - harness origin, e.g. http://127.0.0.1:3080
 * @param {typeof fetch} [options.fetchImpl]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @param {() => string} [options.newRpcId]
 */
export function createDshClient({
  baseUrl,
  fetchImpl,
  WebSocketImpl,
  newRpcId = () =>
    (globalThis.crypto?.randomUUID?.() ??
      `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`),
} = {}) {
  const fetchFn = fetchImpl ?? globalThis.fetch?.bind(globalThis)
  const SocketImpl = WebSocketImpl ?? globalThis.WebSocket
  if (!fetchFn) throw new Error('DSH bridge: no fetch implementation available')
  if (!SocketImpl) throw new Error('DSH bridge: no WebSocket implementation available')

  const origin = String(baseUrl || '').replace(/\/+$/, '')

  /**
   * POST /api/<method> and unwrap the envelope.
   * @param {string} method
   * @param {object} payload
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function rpc(method, payload, { signal } = {}) {
    const rpcId = newRpcId()
    let response
    try {
      response = await fetchFn(`${origin}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new DshTransportError(
        `DSH bridge: cannot reach the harness at ${origin} (${error?.message || error})`,
      )
    }
    if (!response.ok) {
      let body = ''
      try {
        body = await response.text()
      } catch {
        // status alone is enough for the error below
      }
      throw new DshTransportError(`DSH bridge: ${method} failed with HTTP ${response.status}`, {
        status: response.status,
        body,
      })
    }
    const data = await response.json().catch(() => null)
    if (data?.type !== 'server-response' || data.rpcId !== rpcId) {
      throw new DshTransportError(`DSH bridge: malformed response envelope from ${method}`)
    }
    const result = data.result
    if (!result || typeof result !== 'object') {
      throw new DshTransportError(`DSH bridge: response envelope from ${method} has no result`)
    }
    if (result.ok === false) {
      throw new DshRpcError(
        result.error?.code ?? 'unknown',
        result.error?.message ?? 'unknown harness error',
        result.error?.details,
      )
    }
    return result.value
  }

  /**
   * Answer an answerable server-request (approval/question) by echoing its
   * rpcId. Unlike /api/<method>, the method rides only in the path — the
   * envelope type distinguishes it from a client-request.
   */
  async function respondToServerRequest(rpcId, result, { signal } = {}) {
    let response
    try {
      response = await fetchFn(`${origin}/api/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-response', rpcId, result }),
        signal,
      })
    } catch (error) {
      throw new DshTransportError(
        `DSH bridge: /api/respond transport failure (${error?.message || error})`,
      )
    }
    if (!response.ok) {
      throw new DshTransportError(`DSH bridge: /api/respond failed with HTTP ${response.status}`, {
        status: response.status,
      })
    }
    // Receipt: { accepted: true } | { accepted: false, reason }. A late answer
    // is not an error worth failing the turn over.
    return response.json().catch(() => null)
  }

  /**
   * Open the mux downlink and resolve once the socket is open.
   *
   * @param {object} handlers
   * @param {(frame: object, envelope: { rpcId: string, method: string }) => void} handlers.onFrame
   * @param {() => void} [handlers.onClose]
   * @param {(error: Error) => void} [handlers.onError]
   * @param {AbortSignal} [handlers.signal]
   * @returns {Promise<{ close: () => void }>}
   */
  function openMux({ onFrame, onClose, onError, signal } = {}) {
    const url = `${origin.replace(/^http/, 'ws')}/api/events.mux`
    return new Promise((resolve, reject) => {
      let settled = false
      let socket
      try {
        socket = new SocketImpl(url)
      } catch (error) {
        reject(new DshTransportError(`DSH bridge: cannot open mux socket (${error})`))
        return
      }
      const handleOpen = () => {
        if (settled) return
        settled = true
        resolve({
          close: () => {
            try {
              socket.close()
            } catch {
              // already closed
            }
          },
        })
      }
      const handleMessage = (event) => {
        try {
          const envelope = JSON.parse(typeof event.data === 'string' ? event.data : '')
          if (envelope?.type !== 'server-request') return
          onFrame?.(envelope.payload, envelope)
        } catch (error) {
          console.debug('DSH bridge: dropping malformed mux frame', error)
        }
      }
      const handleFailure = (event) => {
        const error = new DshTransportError(
          `DSH bridge: mux socket closed before turn end${
            event?.reason ? ` (${event.reason})` : ''
          }`,
        )
        if (!settled) {
          settled = true
          reject(error)
          return
        }
        onError?.(error)
        onClose?.()
      }
      socket.addEventListener('open', handleOpen)
      socket.addEventListener('message', handleMessage)
      socket.addEventListener('close', handleFailure, { once: true })
      socket.addEventListener('error', () => handleFailure(), { once: true })
      signal?.addEventListener(
        'abort',
        () => {
          try {
            socket.close()
          } catch {
            // best effort
          }
        },
        { once: true },
      )
    })
  }

  return { rpc, respond: respondToServerRequest, openMux, baseUrl: origin }
}
