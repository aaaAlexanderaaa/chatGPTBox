// API bridge WebSocket proxy.
//
// Routes the localhost WebSocket connection from the ApiServer extension page
// through the service worker so it works in browsers (e.g. Brave) that block
// outbound network requests from extension pages.
//
// MV3 service workers are terminated after ~30 s of inactivity. To prevent
// this we send an application-level ping on the WebSocket every 20 s
// (Chrome 116+ treats active WebSocket sends as "activity") and accept
// keepalive pings from the bridge page on the port.

const WS_KEEPALIVE_MS = 20_000
const BRIDGE_PORT_NAME = 'api-bridge-proxy'

// Handle an onConnect port. Returns true if this port belongs to the API
// bridge proxy (and the background entry should stop checking other handlers),
// false otherwise.
export function handleApiBridgeProxyPort(port) {
  if (port.name !== BRIDGE_PORT_NAME) return false

  let ws = null
  let keepaliveTimer = null
  let portClosed = false

  function safePost(msg) {
    if (portClosed) return
    try {
      port.postMessage(msg)
    } catch {
      portClosed = true
    }
  }

  function startKeepalive() {
    stopKeepalive()
    keepaliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, WS_KEEPALIVE_MS)
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
  }

  port.onMessage.addListener((msg) => {
    if (msg.action === 'keepalive') return

    if (msg.action === 'connect') {
      stopKeepalive()
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
      try {
        ws = new WebSocket(msg.url)
        ws.onopen = () => {
          safePost({ type: 'open' })
          startKeepalive()
        }
        ws.onclose = (e) => {
          stopKeepalive()
          ws = null
          safePost({ type: 'close', code: e.code, reason: e.reason })
        }
        ws.onerror = () => {
          safePost({ type: 'error', message: 'WebSocket connection failed' })
        }
        ws.onmessage = (e) => {
          safePost({ type: 'message', data: e.data })
        }
      } catch (err) {
        safePost({ type: 'error', message: err.message })
      }
    } else if (msg.action === 'send') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(msg.payload)
      }
    } else if (msg.action === 'close') {
      stopKeepalive()
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
    }
  })

  port.onDisconnect.addListener(() => {
    portClosed = true
    stopKeepalive()
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
  })

  return true
}
