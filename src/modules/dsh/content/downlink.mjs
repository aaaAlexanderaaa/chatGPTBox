// Downlink content script entry (D-22) — binds the dependency-free core to
// the content-script globals. Built standalone as dsh-downlink.js (no
// dependOn): it is registered dynamically for the harness origin only and
// must run without any other bundle.

import Browser from 'webextension-polyfill'
import { createDownlinkScript } from './downlink-core.mjs'

// The page may receive this file twice (dynamic registration on load + a
// manual executeScript into an already-open tab). All copies share one
// isolated world, so this flag guarantees a single live instance — a second
// instance would duplicate every stream socket.
if (!globalThis.__DSH_DOWNLINK__) {
  globalThis.__DSH_DOWNLINK__ = true
  createDownlinkScript({
  getEndpoint: () => globalThis.location.origin,
  send: (message) => {
    void Browser.runtime.sendMessage(message).catch(() => {
      // background unreachable this instant; frames it misses are replayed
      // by the gateway's reconnect re-pull
    })
  },
  addListener: (handler) => {
    // Never return a value: this listener must not claim the response slot
    // shared with the background's own runtime message router.
    Browser.runtime.onMessage.addListener((message) => {
      handler(message)
      return undefined
    })
  },
  WebSocketImpl: globalThis.WebSocket,
  })
}
