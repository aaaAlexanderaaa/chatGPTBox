// Downlink content script, dependency-free core (D-22).
//
// Runs ON the harness origin (registered dynamically for exactly that
// origin by the background bridge) and opens the mux/host event sockets as
// PAGE-origin WebSocket handshakes — the only shape the harness trust fence
// accepts (see downlink-protocol.mjs for why). Purely reactive: the
// background owns reconnect policy; this side opens what it is told,
// relays server-request envelopes verbatim, and reports closures.
//
// Everything browser-shaped (messaging, WebSocket) is injected so the whole
// script is unit-testable from Node.

import { DownlinkBgMessage, DownlinkCsMessage } from '../downlink-protocol.mjs'

const IDLE_REAP_MS = 60_000
const IDLE_REAP_CHECK_MS = 20_000

/**
 * @param {object} options
 * @param {() => string} options.getEndpoint - this page's origin
 * @param {(message: object) => void} options.send - to the background
 * @param {(handler: (message: object) => void) => void} options.addListener - from the background
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @param {{ setInterval: Function, clearInterval: Function, now?: () => number }} [options.timers]
 * @returns {{ stop: () => void }} test/lifecycle seam
 */
export function createDownlinkScript({
  getEndpoint,
  send,
  addListener,
  WebSocketImpl,
  timers,
}) {
  const SocketImpl = WebSocketImpl ?? globalThis.WebSocket
  const setIntervalFn = timers?.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const clearIntervalFn = timers?.clearInterval ?? ((id) => clearInterval(id))
  const now = timers?.now ?? (() => Date.now())
  /** @type {Map<string, { socket: object, reported: boolean }>} sid → live socket */
  const streams = new Map()

  // The background pings every heartbeat tick while any session is live.
  // Sockets orphaned by a service-worker death (no close command, no pings)
  // are reaped here instead of leaking until the page unloads.
  let lastContactAt = now()
  const reaper = setIntervalFn(() => {
    if (now() - lastContactAt <= IDLE_REAP_MS) return
    for (const sid of [...streams.keys()]) closeSilently(sid)
  }, IDLE_REAP_CHECK_MS)

  function safeSend(message) {
    try {
      send(message)
    } catch {
      // background is restarting; the open that follows re-establishes state
    }
  }

  function closeSilently(sid) {
    const entry = streams.get(sid)
    if (!entry) return
    streams.delete(sid)
    try {
      entry.socket.close()
    } catch {
      // already closed
    }
  }

  function openStream({ endpoint, sid, stream, path }) {
    // A script left over from a previous endpoint must never open sockets
    // against the page it happens to sit on.
    if (endpoint !== getEndpoint()) return
    lastContactAt = now()
    closeSilently(sid)
    let socket
    try {
      socket = new SocketImpl(`${endpoint.replace(/^http/, 'ws')}${path}`)
    } catch {
      safeSend({ type: DownlinkCsMessage.Closed, sid, stream, code: 1006, reason: '' })
      return
    }
    const entry = { socket, reported: false }
    streams.set(sid, entry)
    const reportClosed = (event) => {
      if (!streams.has(sid) || entry.reported) return
      entry.reported = true
      streams.delete(sid)
      safeSend({
        type: DownlinkCsMessage.Closed,
        sid,
        stream,
        code: typeof event?.code === 'number' ? event.code : 1006,
        reason: typeof event?.reason === 'string' ? event.reason : '',
      })
    }
    socket.addEventListener('open', () => {
      safeSend({ type: DownlinkCsMessage.Opened, sid, stream })
    })
    socket.addEventListener('message', (event) => {
      let envelope = null
      try {
        envelope = JSON.parse(typeof event.data === 'string' ? event.data : '')
      } catch {
        return // keep the drop-malformed policy of client.mjs openDownlink
      }
      if (envelope?.type !== 'server-request') return
      safeSend({ type: DownlinkCsMessage.Frame, sid, stream, envelope })
    })
    socket.addEventListener('close', reportClosed)
    socket.addEventListener('error', () => reportClosed({ code: 1006, reason: '' }))
  }

  addListener((message) => {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case DownlinkBgMessage.Ping:
        lastContactAt = now()
        // A live worker lists the sids it still owns. After an MV3 restart
        // that list is empty, so sockets orphaned by the previous worker
        // are reaped here instead of surviving on the refreshed lastContactAt.
        // An omitted `sids` is left alone (older caller / first paint).
        if (Array.isArray(message.sids)) {
          const keep = new Set(message.sids)
          for (const sid of [...streams.keys()]) {
            if (!keep.has(sid)) closeSilently(sid)
          }
        }
        safeSend({
          type: DownlinkCsMessage.Pong,
          endpoint: getEndpoint(),
          sids: [...streams.keys()],
        })
        break
      case DownlinkBgMessage.Open:
        openStream(message)
        break
      case DownlinkBgMessage.Close:
        closeSilently(message.sid)
        break
      default:
        break
    }
  })

  return {
    stop() {
      clearIntervalFn(reaper)
      for (const sid of [...streams.keys()]) closeSilently(sid)
    },
  }
}
