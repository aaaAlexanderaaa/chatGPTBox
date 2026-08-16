// Background side of the downlink bridge (D-22).
//
// The two event streams (mux + host) cannot be opened from an extension
// context: the harness trust fence refuses every non-same-origin Origin, and
// WebSocket handshakes from extension pages always carry
// `Origin: chrome-extension://…` (declarativeNetRequest cannot touch
// handshake headers — remove or set, verified against Chrome for Testing
// 151). The streams therefore ride sockets opened by the downlink content
// script on the harness origin — usually the user's own `dsh web` tab, else
// a quiet carrier tab this bridge owns at `${origin}/favicon.svg`.
//
// Shape: openMux/openHost mirror client.mjs's contract (resolve {close} on
// open, reject before open, onError/onClose after), so the gateway treats
// the bridge as a drop-in replacement for the client's socket layer. Each
// open is an independent session (sid) multiplexed over the one carrier
// page — a diagnose probe never steals the gateway's stream handlers.
//
// Discovery is stateless on purpose: the background Pings, the script
// answers Pong with its origin. After an MV3 service-worker restart the
// still-running script is re-discovered with the same dance, and sockets
// orphaned by the lost worker are reaped script-side once pings stop.
//
// Boundary note: imports webextension-polyfill and module files only.

import Browser from 'webextension-polyfill'
import { DownlinkBgMessage, DownlinkCsMessage, downlinkPath } from '../downlink-protocol.mjs'
import { normalizeDshEndpoint } from './fence.mjs'

const DOWNLINK_CS_FILE = 'dsh-downlink.js'
const DOWNLINK_CS_REG_ID = 'dsh-downlink'
const OPEN_TIMEOUT_MS = 10_000
const HEARTBEAT_MS = 15_000
const PONG_TIMEOUT_MS = 5_000

function newSid() {
  return (
    globalThis.crypto?.randomUUID?.()?.slice(0, 8) ??
    `dl-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
  )
}

// --- dynamic content-script registration (scoped to the endpoint) -----------

let mv2ContentScriptRegistration = null

/** Inject the downlink script into a tab that predates the registration
 *  (e.g. the user's own harness tab, open before the module was enabled). */
function injectDownlinkScript(tabId) {
  if (Browser.scripting?.executeScript) {
    return Browser.scripting.executeScript({ target: { tabId }, files: [DOWNLINK_CS_FILE] })
  }
  if (Browser.tabs?.executeScript) {
    return Browser.tabs.executeScript(tabId, { file: DOWNLINK_CS_FILE })
  }
  return Promise.reject(new Error('no script injection API available'))
}

/**
 * Keep the downlink content script registered for exactly the configured
 * origin (an empty endpoint unregisters). MV3 uses the scripting API,
 * Firefox MV2 uses contentScripts.register.
 * @param {string} endpoint
 */
export async function syncDownlinkContentScript(endpoint) {
  const origin = normalizeDshEndpoint(endpoint) || ''
  const matches = origin ? [`${origin}/*`] : []
  if (Browser.scripting?.registerContentScripts) {
    try {
      await Browser.scripting.unregisterContentScripts({ ids: [DOWNLINK_CS_REG_ID] }).catch(
        () => {
          // nothing registered under this id yet
        },
      )
      if (matches.length) {
        await Browser.scripting.registerContentScripts([
          {
            id: DOWNLINK_CS_REG_ID,
            js: [DOWNLINK_CS_FILE],
            matches,
            runAt: 'document_idle',
            persistAcrossSessions: true,
          },
        ])
      }
    } catch (error) {
      console.log('DSH module: downlink content-script registration failed', error)
    }
    return
  }
  try {
    await mv2ContentScriptRegistration?.unregister?.()
  } catch {
    // already unregistered
  }
  mv2ContentScriptRegistration = null
  if (matches.length && Browser.contentScripts?.register) {
    try {
      mv2ContentScriptRegistration = await Browser.contentScripts.register({
        matches,
        js: [{ file: DOWNLINK_CS_FILE }],
        runAt: 'document_idle',
      })
    } catch (error) {
      console.log('DSH module: downlink content-script registration failed', error)
    }
  }
}

// --- the bridge --------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} options.endpoint - harness origin (http://127.0.0.1:3080)
 * @param {{ setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }} [options.timers]
 * @param {(...args: unknown[]) => void} [options.log]
 * @param {number} [options.openTimeoutMs]
 */
export function createDownlinkBridge({ endpoint, timers, log, openTimeoutMs = OPEN_TIMEOUT_MS }) {
  const origin = normalizeDshEndpoint(endpoint)
  if (!origin) throw new Error('DSH downlink bridge: endpoint must be a loopback http(s) origin')
  const t = {
    setTimeout: timers?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimeout: timers?.clearTimeout ?? ((id) => clearTimeout(id)),
    setInterval: timers?.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
    clearInterval: timers?.clearInterval ?? ((id) => clearInterval(id)),
  }
  const note = log ?? ((...args) => console.log('DSH downlink:', ...args))
  const faviconUrl = `${origin}/favicon.svg`

  let stopped = false
  /** @type {number | null} */
  let carrierTabId = null
  /** tabs this bridge created (stop() closes only these, never user tabs).
   *  Also claimed for a leftover `${origin}/favicon.svg` after an MV3
   *  worker restart — that tab was ours, the new handle just forgot. */
  const ownedTabIds = new Set()
  let carrierReady = false
  /** single-flight ensureCarrier */
  let ensuring = null
  let heartbeatTimer = null
  /** @type {(() => void) | null} resolved by a carrier-matching Pong */
  let pongWaiter = null
  /** sid list from the last matching Pong; null if the script omitted it */
  let lastPongSids = null
  /** @type {Map<string, object>} sid → session */
  const sessions = new Map()

  /**
   * @typedef {object} DlSession
   * @property {string} stream
   * @property {number} tabId
   * @property {{ onFrame: Function, onClose?: Function, onError?: Function }} handlers
   * @property {boolean} opened
   * @property {Function} resolve
   * @property {Function} reject
   */

  // --- carrier tab -----------------------------------------------------------

  function tabMessage(tabId, message) {
    return Browser.tabs.sendMessage(tabId, message)
  }

  function closeOwnedTabs() {
    for (const id of [...ownedTabIds]) {
      ownedTabIds.delete(id)
      void Browser.tabs?.remove?.(id).catch(() => {
        // tab already gone
      })
    }
  }

  function claimOwnedCarrier(tab) {
    if (typeof tab?.id === 'number' && tab.url === faviconUrl) {
      ownedTabIds.add(tab.id)
    }
  }

  async function ensureCarrier() {
    if (stopped) throw new Error('DSH downlink bridge is stopped')
    if (carrierTabId != null && carrierReady) return carrierTabId
    if (!ensuring) {
      ensuring = doEnsureCarrier().finally(() => {
        ensuring = null
      })
    }
    return ensuring
  }

  async function probeTab(tabId, { skipIfUnscriptable = false } = {}) {
    carrierTabId = tabId
    carrierReady = false
    // The generic http(s) content script is already a sendMessage receiver
    // on this origin, so a failed "no receiving end" is the wrong inject
    // signal. Always try to put dsh-downlink.js in the tab first.
    const injected = await injectDownlinkScript(tabId).then(
      () => true,
      () => false,
    )
    if (stopped || carrierTabId !== tabId) return false
    // Error pages fail inject immediately. Waiting a full ping timeout
    // for each of them would eat the open budget and skip the favicon
    // fallback. A tab we just created may still be loading — keep waiting.
    if (!injected && skipIfUnscriptable) return false
    return pingCarrier(tabId, PONG_TIMEOUT_MS)
  }

  async function createFaviconCarrier() {
    try {
      const tab = await Browser.tabs.create({ url: faviconUrl, active: false })
      if (typeof tab?.id === 'number') {
        ownedTabIds.add(tab.id)
        // Chrome discards background tabs; a discarded carrier drops the
        // sockets and the quiet favicon page is the first to go.
        await Browser.tabs?.update?.(tab.id, { autoDiscardable: false }).catch(() => {
          // Firefox MV2 has no autoDiscardable
        })
      }
      return tab
    } catch (error) {
      throw new Error(`cannot open a harness carrier tab (${error?.message || error})`)
    }
  }

  async function doEnsureCarrier() {
    const deadline = Date.now() + openTimeoutMs
    let candidates = []
    try {
      const tabs = await Browser.tabs.query({ url: `${origin}/*` })
      candidates = tabs.filter(
        (candidate) => typeof candidate?.id === 'number' && candidate.discarded !== true,
      )
    } catch (error) {
      note('cannot query tabs for the harness origin', error?.message || error)
    }

    // Error pages match the origin but can never host the script. Skip
    // them immediately (skipIfUnscriptable) and stop probing once a full
    // ping timeout would leave no budget for the favicon fallback.
    for (const candidate of candidates) {
      claimOwnedCarrier(candidate)
      if (stopped || Date.now() + PONG_TIMEOUT_MS >= deadline) break
      if (await probeTab(candidate.id, { skipIfUnscriptable: true })) {
        carrierReady = true
        return candidate.id
      }
    }

    let tab = null
    if (!stopped && Date.now() < deadline) {
      tab = await createFaviconCarrier()
    }
    if (typeof tab?.id !== 'number') {
      carrierTabId = null
      throw new Error('the harness carrier page did not answer')
    }
    if (await probeTab(tab.id)) {
      carrierReady = true
      return tab.id
    }
    while (Date.now() < deadline && !stopped && carrierTabId === tab.id) {
      if (await pingCarrier(tab.id, PONG_TIMEOUT_MS)) {
        carrierReady = true
        return tab.id
      }
    }
    if (carrierTabId === tab.id) {
      carrierTabId = null
      closeOwnedTabs()
    }
    throw new Error('the harness carrier page did not answer')
  }

  /**
   * One ping→pong round trip. Missing Pong (timeout or no receiving end)
   * injects the downlink script — a generic content script already makes
   * sendMessage succeed, so rejection is not a reliable "script absent" signal.
   * @returns {Promise<boolean>} true when the script answered for this origin
   */
  function pingCarrier(tabId, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        t.clearTimeout(timer)
        if (pongWaiter === finish) pongWaiter = null
        resolve(value)
      }
      const finish = () => done(true)
      pongWaiter = finish
      const timer = t.setTimeout(() => {
        void injectDownlinkScript(tabId).catch(() => {})
        done(false)
      }, timeoutMs)
      lastPongSids = null
      tabMessage(tabId, { type: DownlinkBgMessage.Ping, sids: [...sessions.keys()] }).catch(() => {
        void injectDownlinkScript(tabId).catch(() => {
          // page not scriptable (yet); the next round trip retries
        })
      })
    })
  }

  function sendClose(tabId, sid) {
    void tabMessage(tabId, { type: DownlinkBgMessage.Close, sid }).catch(() => {
      // carrier gone; the script reaps its socket when pings stop
    })
  }

  function takeSession(sid) {
    const session = sessions.get(sid)
    if (!session) return null
    sessions.delete(sid)
    if (session.openTimer != null) {
      t.clearTimeout(session.openTimer)
      session.openTimer = null
    }
    return session
  }

  function loseSession(sid, error) {
    const session = takeSession(sid)
    if (!session) return
    sendClose(session.tabId, sid)
    if (!session.opened) {
      session.reject(error)
    } else {
      session.handlers.onError?.(error)
      session.handlers.onClose?.()
    }
    syncHeartbeat()
  }

  function carrierLost(tabId) {
    if (carrierTabId !== tabId) return
    carrierTabId = null
    carrierReady = false
    for (const [sid, session] of [...sessions.entries()]) {
      if (session.tabId !== tabId) continue
      loseSession(
        sid,
        new Error(
          session.opened
            ? 'the downlink carrier tab went away'
            : 'the downlink carrier tab went away before the stream opened',
        ),
      )
    }
    syncHeartbeat()
  }

  // --- sessions ---------------------------------------------------------------

  function closeSession(sid) {
    const session = takeSession(sid)
    if (session) sendClose(session.tabId, sid)
    syncHeartbeat()
  }

  /**
   * @param {'mux'|'host'} stream
   * @param {object} handlers - client.mjs openMux/openHost handler shape
   * @param {number} [timeoutMs]
   * @returns {Promise<{ close: () => void }>}
   */
  function openStream(stream, handlers, timeoutMs = openTimeoutMs) {
    return (async () => {
      if (stopped) throw new Error('DSH downlink bridge is stopped')
      const tabId = await ensureCarrier()
      if (stopped) throw new Error('DSH downlink bridge is stopped')
      const sid = newSid()
      /** @type {DlSession} */
      let session
      const opened = new Promise((resolve, reject) => {
        session = { stream, tabId, handlers, opened: false, openTimer: null, resolve, reject }
      })
      sessions.set(sid, session)
      session.openTimer = t.setTimeout(() => {
        loseSession(sid, new Error(`downlink "${stream}" did not open within ${timeoutMs}ms`))
      }, timeoutMs)
      try {
        await tabMessage(tabId, {
          type: DownlinkBgMessage.Open,
          endpoint: origin,
          sid,
          stream,
          path: downlinkPath(stream),
        })
      } catch (error) {
        takeSession(sid)
        syncHeartbeat()
        throw new Error(`cannot reach the harness carrier page (${error?.message || error})`)
      }
      syncHeartbeat()
      await opened
      return {
        close: () => closeSession(sid),
      }
    })()
  }

  // --- heartbeat ----------------------------------------------------------------

  function syncHeartbeat() {
    const want = !stopped && sessions.size > 0
    if (want && heartbeatTimer == null) {
      heartbeatTimer = t.setInterval(() => void heartbeatTick(), HEARTBEAT_MS)
    } else if (!want && heartbeatTimer != null) {
      t.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function loseSessionsMissingFromPong() {
    if (!Array.isArray(lastPongSids)) return
    const reported = new Set(lastPongSids)
    for (const [sid, session] of [...sessions.entries()]) {
      if (reported.has(sid)) continue
      loseSession(
        sid,
        new Error(
          session.opened
            ? 'the downlink carrier tab went away'
            : 'the downlink carrier tab went away before the stream opened',
        ),
      )
    }
  }

  async function heartbeatTick() {
    if (stopped || carrierTabId == null || ensuring) return
    const tabId = carrierTabId
    const alive = await pingCarrier(tabId, PONG_TIMEOUT_MS)
    if (stopped || carrierTabId !== tabId) return
    if (!alive) {
      carrierLost(tabId)
      return
    }
    // Same-origin reload: the new script answers Ping but has no sockets
    // for our sids (onUpdated is the fast path; this is the fallback).
    loseSessionsMissingFromPong()
  }

  // --- content-script messages ----------------------------------------------------

  function sessionFromCarrier(message, sender) {
    const session = sessions.get(message.sid)
    if (!session || sender?.tab?.id !== session.tabId) return null
    return session
  }

  function onRuntimeMessage(message, sender) {
    if (stopped || !message || typeof message !== 'object') return undefined
    switch (message.type) {
      case DownlinkCsMessage.Pong:
        if (message.endpoint === origin && sender?.tab?.id === carrierTabId && pongWaiter) {
          lastPongSids = Array.isArray(message.sids) ? message.sids : null
          pongWaiter()
        }
        break
      case DownlinkCsMessage.Opened: {
        const session = sessionFromCarrier(message, sender)
        if (session && !session.opened) {
          if (session.openTimer != null) {
            t.clearTimeout(session.openTimer)
            session.openTimer = null
          }
          session.opened = true
          session.resolve({ close: () => closeSession(message.sid) })
        }
        break
      }
      case DownlinkCsMessage.Frame: {
        const session = sessionFromCarrier(message, sender)
        if (session) session.handlers.onFrame?.(message.envelope?.payload, message.envelope)
        break
      }
      case DownlinkCsMessage.Closed: {
        const session = sessionFromCarrier(message, sender)
        if (!session) break
        takeSession(message.sid)
        if (!session.opened) {
          session.reject(
            new Error(
              `downlink "${session.stream}" closed before opening (code ${message.code ?? '??'}${message.reason ? `: ${message.reason}` : ''})`,
            ),
          )
        } else {
          session.handlers.onError?.(
            new Error(`downlink "${session.stream}" closed (code ${message.code ?? '??'})`),
          )
          session.handlers.onClose?.()
        }
        syncHeartbeat()
        break
      }
      default:
        break
    }
    return undefined
  }

  function onTabRemoved(tabId) {
    ownedTabIds.delete(tabId)
    carrierLost(tabId)
  }

  // Same-origin refresh / navigation keeps the tab id and the new document
  // will answer Ping, so heartbeat alone cannot see the sockets die.
  // status:loading after we already had a Pong is that signal. Ignore
  // loading while we are still discovering the tab (initial document_idle).
  function onTabUpdated(tabId, changeInfo) {
    if (tabId !== carrierTabId || !carrierReady) return
    if (changeInfo.status === 'loading') {
      carrierLost(tabId)
      return
    }
    if (typeof changeInfo.url === 'string') {
      try {
        if (new URL(changeInfo.url).origin !== origin) carrierLost(tabId)
      } catch {
        carrierLost(tabId)
      }
    }
  }

  Browser.runtime.onMessage.addListener(onRuntimeMessage)
  Browser.tabs?.onRemoved?.addListener(onTabRemoved)
  Browser.tabs?.onUpdated?.addListener(onTabUpdated)

  // --- lifecycle --------------------------------------------------------------------

  function stop() {
    if (stopped) return
    stopped = true
    try {
      Browser.runtime.onMessage.removeListener(onRuntimeMessage)
    } catch {
      // listener API gone during shutdown
    }
    try {
      Browser.tabs?.onRemoved?.removeListener?.(onTabRemoved)
    } catch {
      // same
    }
    try {
      Browser.tabs?.onUpdated?.removeListener?.(onTabUpdated)
    } catch {
      // same
    }
    if (heartbeatTimer != null) {
      t.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    for (const [sid, session] of [...sessions.entries()]) {
      takeSession(sid)
      sendClose(session.tabId, sid)
      if (!session.opened) {
        session.reject(new Error('DSH downlink bridge stopped'))
      }
    }
    closeOwnedTabs()
    carrierTabId = null
    carrierReady = false
  }

  /**
   * Diagnose hook: one throwaway mux round trip through the exact path the
   * gateway uses (carrier page + content script + fence-passing handshake).
   * @param {number} [timeoutMs]
   * @returns {Promise<{ ok: boolean, detail: string }>}
   */
  async function probe(timeoutMs = 5_000) {
    let socket = null
    try {
      socket = await openStream('mux', { onFrame: () => {} }, timeoutMs)
      return { ok: true, detail: '' }
    } catch (error) {
      return { ok: false, detail: error?.message || String(error) }
    } finally {
      try {
        socket?.close()
      } catch {
        // already closed
      }
    }
  }

  return {
    endpoint: origin,
    openMux: (handlers) => openStream('mux', handlers),
    openHost: (handlers) => openStream('host', handlers),
    probe,
    stop,
  }
}

// --- module-level singleton (one bridge per live endpoint) ---------------------

/** @type {{ endpoint: string, handle: ReturnType<typeof createDownlinkBridge> } | null} */
let bridgeSingleton = null

/**
 * The bridge for the given endpoint, creating it on first use. An endpoint
 * change stops the previous bridge (closing its carrier tab if we own it).
 * Returns null for a non-loopback endpoint.
 * @param {string} endpoint
 */
export function getDownlinkBridge(endpoint) {
  const origin = normalizeDshEndpoint(endpoint) || ''
  if (bridgeSingleton?.endpoint === origin) return bridgeSingleton.handle
  bridgeSingleton?.handle.stop()
  bridgeSingleton = null
  if (!origin) return null
  const handle = createDownlinkBridge({ endpoint: origin })
  bridgeSingleton = { endpoint: origin, handle }
  return handle
}

/** Stop the live bridge, if any (module off / worker shutdown). */
export function stopDownlinkBridge() {
  bridgeSingleton?.handle.stop()
  bridgeSingleton = null
}
