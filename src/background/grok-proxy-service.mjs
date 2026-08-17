// Grok Web proxy service.
//
// Owns the dedicated grok.com proxy-tab lifecycle, the process-wide write
// lock, and the proxy request send/response port bridge.
// Mirrors chatgpt-proxy-service for the L2 text path; probe never calls
// ensureGrokProxyTab.

import Browser from 'webextension-polyfill'
import { GrokProxyControlAction, RuntimeMessage } from '../protocol/messages.mjs'
import { isGrokWebPrePostControlError } from '../services/clients/grok-web/pre-post-errors.mjs'
import {
  GROK_PROXY_QUERY_PARAM,
  GROK_PROXY_QUERY_VALUE,
  isDedicatedGrokProxyTabUrl,
} from '../utils/grok-proxy-tab.mjs'

const GROK_PROXY_URL = `https://grok.com/?${GROK_PROXY_QUERY_PARAM}=${GROK_PROXY_QUERY_VALUE}`
export const GROK_PROXY_CONNECT_TIMEOUT_MS = 60_000

// requestId -> { uiPort, resolve, reject }
const pendingGrokProxyRequests = new Map()

// One in-flight Grok write at a time (any session / Bridge control).
let activeGrokWebWrite = null

export function acquireGrokWebSessionLock(session, port) {
  const sessionId = typeof session?.sessionId === 'string' ? session.sessionId : ''

  if (activeGrokWebWrite) {
    try {
      port?.postMessage?.({ error: 'Grok Web request already in progress' })
    } catch {
      /* ignore */
    }
    return null
  }

  activeGrokWebWrite = {
    port,
    sessionId,
    startedAt: Date.now(),
  }

  return () => {
    if (activeGrokWebWrite?.port === port) {
      activeGrokWebWrite = null
    }
  }
}

async function discoverGrokProxyTab(tabsApi) {
  try {
    let tabs = await tabsApi.query({ url: 'https://grok.com/*' }).catch(() => [])
    if (!tabs.length) {
      const all = await tabsApi.query({}).catch(() => [])
      tabs = all || []
    }
    return tabs.find((tab) => tab?.id && isDedicatedGrokProxyTabUrl(tab.url)) || null
  } catch {
    return null
  }
}

/**
 * Ensure a dedicated grok.com proxy tab exists.
 * Injectable `{ tabs, createTab }` for tests — never open a real tab from unit tests.
 * Only call from provider `run` / Bridge write, never from probe.
 */
export async function ensureGrokProxyTab({ tabs, createTab } = {}) {
  const tabsApi = tabs || Browser.tabs
  const create = createTab || ((opts) => Browser.tabs.create(opts))

  const discovered = await discoverGrokProxyTab(tabsApi)
  if (discovered?.id) return discovered

  return await create({
    url: GROK_PROXY_URL,
    active: false,
  })
}

async function injectContentScript(tabId) {
  try {
    await Browser.scripting.insertCSS({ target: { tabId }, files: ['content-script.css'] })
  } catch {
    /* non-critical */
  }
  await Browser.scripting.executeScript({
    target: { tabId },
    files: ['shared.js', 'content-script.js'],
  })
}

function clearPendingGrokProxyRequest(requestId) {
  const entry = pendingGrokProxyRequests.get(requestId)
  if (entry?.timer) clearTimeout(entry.timer)
  pendingGrokProxyRequests.delete(requestId)
  return entry
}

export async function sendGrokProxyRequest(tabId, session, uiPort, deps = {}) {
  const requestId = crypto.randomUUID()
  const send = deps.sendMessage || ((id, message) => Browser.tabs.sendMessage(id, message))
  const timeoutMs = deps.connectTimeoutMs ?? GROK_PROXY_CONNECT_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const entry = pendingGrokProxyRequests.get(requestId)
      if (!entry || entry.connected) return
      clearPendingGrokProxyRequest(requestId)
      reject(
        new Error(
          'Grok proxy tab did not accept the request in time. It will not be submitted again automatically.',
        ),
      )
    }, timeoutMs)

    pendingGrokProxyRequests.set(requestId, { uiPort, resolve, reject, timer, connected: false })

    const doSend = () =>
      send(tabId, {
        type: RuntimeMessage.GrokProxyRequest,
        data: { requestId, session },
      })

    doSend().catch(async (firstErr) => {
      if (!pendingGrokProxyRequests.has(requestId)) return
      if (/receiving end does not exist/i.test(firstErr?.message)) {
        try {
          await injectContentScript(tabId)
          await new Promise((r) => setTimeout(r, 500))
          if (!pendingGrokProxyRequests.has(requestId)) return
          await doSend()
          return
        } catch {
          if (!pendingGrokProxyRequests.has(requestId)) return
          clearPendingGrokProxyRequest(requestId)
          reject(
            new Error(
              'Content script could not be loaded in the Grok tab. ' +
                'Please make sure ChatGPTBox has permission to access grok.com, ' +
                'then reload the tab and retry.',
            ),
          )
          return
        }
      }
      clearPendingGrokProxyRequest(requestId)
      reject(firstErr)
    })
  })
}

/**
 * Send a Grok proxy control action through an existing proxy tab.
 * Injectable `{ tabs, createTab, sendMessage }` for tests — never open a real tab from unit tests.
 */
export async function sendGrokProxyControlRequest(tabId, action, payload, { sendMessage } = {}) {
  const send = sendMessage || ((id, message) => Browser.tabs.sendMessage(id, message))

  const doSend = async () => {
    const response = await send(tabId, {
      type: RuntimeMessage.GrokProxyControlRequest,
      data: { action, payload },
    })
    if (!response?.ok) {
      throw new Error(response?.error || 'Grok proxy control request failed')
    }
    return response.data
  }

  try {
    return await doSend()
  } catch (firstErr) {
    if (/receiving end does not exist/i.test(firstErr?.message)) {
      try {
        await injectContentScript(tabId)
        await new Promise((r) => setTimeout(r, 500))
        return await doSend()
      } catch {
        throw new Error(
          'Content script could not be loaded in the Grok tab. ' +
            'Please make sure ChatGPTBox has permission to access grok.com, ' +
            'then reload the tab and retry.',
        )
      }
    }
    throw firstErr
  }
}

/**
 * Bridge conversation controls: ensure proxy tab, then dispatch control action.
 * Allowed for Bridge conversation API only — never from probe.
 * Injectable deps for tests.
 */
const GROK_WEB_WRITE_CONTROL_ACTIONS = new Set([
  GrokProxyControlAction.CreateConversation,
  GrokProxyControlAction.SendConversationMessage,
])

function notDispatchedControlError(error) {
  return { dispatched: false, error: error?.message || String(error) }
}

export async function executeGrokWebControlRequest(action, payload = {}, deps = {}) {
  const needsLock = GROK_WEB_WRITE_CONTROL_ACTIONS.has(action)
  let release = () => {}
  if (needsLock) {
    const lockPort = {
      postMessage() {},
    }
    release = acquireGrokWebSessionLock({ sessionId: `grok-web-control:${action}` }, lockPort)
    if (release === null) {
      return notDispatchedControlError(new Error('Grok Web request already in progress'))
    }
  }
  try {
    const tab = await ensureGrokProxyTab(deps)
    if (!tab?.id) {
      const error = new Error(
        'Grok proxy tab is unavailable. Open https://grok.com in this browser and sign in, then retry.',
      )
      if (needsLock) return notDispatchedControlError(error)
      throw error
    }
    return await sendGrokProxyControlRequest(tab.id, action, payload, deps)
  } catch (error) {
    if (needsLock && isGrokWebPrePostControlError(error)) {
      return notDispatchedControlError(error)
    }
    throw error
  } finally {
    release()
  }
}

export function handleGrokProxyResponsePort(port) {
  if (!port.name.startsWith('grok-proxy-response:')) return false
  const requestId = port.name.replace('grok-proxy-response:', '')
  const entry = pendingGrokProxyRequests.get(requestId)
  if (!entry) {
    port.disconnect()
    return true
  }
  if (entry.timer) clearTimeout(entry.timer)
  entry.connected = true
  pendingGrokProxyRequests.delete(requestId)
  const { uiPort, resolve, reject } = entry
  let settled = false

  const uiStopListener = (msg) => {
    if (settled || !msg?.stop) return
    try {
      port.postMessage({ stop: true })
    } catch {
      /* ignore */
    }
  }
  uiPort.onMessage?.addListener?.(uiStopListener)

  const settle = (callback, value) => {
    if (settled) return
    settled = true
    try {
      uiPort.onMessage?.removeListener?.(uiStopListener)
    } catch {
      /* ignore */
    }
    callback(value)
  }

  port.onMessage.addListener((msg) => {
    if (settled) return
    if (!uiPort._isClosed) {
      try {
        uiPort.postMessage(msg)
      } catch {
        /* ignore */
      }
    }
    if (msg?.done || msg?.error) {
      settle(resolve)
      try {
        port.disconnect()
      } catch {
        /* ignore */
      }
    }
  })
  port.onDisconnect.addListener(() => {
    if (uiPort._isClosed) {
      settle(resolve)
      return
    }
    settle(reject, new Error('Grok proxy tab disconnected before response completed'))
  })
  uiPort.onDisconnect?.addListener?.(() => {
    uiPort._isClosed = true
    try {
      port.postMessage({ stop: true })
    } catch {
      /* ignore */
    }
    try {
      port.disconnect()
    } catch {
      /* ignore */
    }
    settle(resolve)
  })
  return true
}
