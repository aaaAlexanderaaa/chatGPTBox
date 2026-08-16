// Grok Web proxy service.
//
// Owns the dedicated grok.com proxy-tab lifecycle, the per-session request
// serialization lock, and the proxy request send/response port bridge.
// Mirrors chatgpt-proxy-service for the L2 text path; probe never calls
// ensureGrokProxyTab.

import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../protocol/messages.mjs'
import {
  GROK_PROXY_QUERY_PARAM,
  GROK_PROXY_QUERY_VALUE,
  isDedicatedGrokProxyTabUrl,
} from '../utils/grok-proxy-tab.mjs'

const GROK_PROXY_URL = `https://grok.com/?${GROK_PROXY_QUERY_PARAM}=${GROK_PROXY_QUERY_VALUE}`

// requestId -> { uiPort, resolve, reject }
const pendingGrokProxyRequests = new Map()

// sessionId -> { port, startedAt }
const activeGrokWebSessionRequests = new Map()

export function acquireGrokWebSessionLock(session, port) {
  const sessionId = typeof session?.sessionId === 'string' ? session.sessionId : ''
  if (!sessionId) return () => {}

  if (activeGrokWebSessionRequests.has(sessionId)) {
    try {
      port.postMessage({ error: 'Grok Web request already in progress' })
    } catch {
      /* ignore */
    }
    return null
  }

  activeGrokWebSessionRequests.set(sessionId, {
    port,
    startedAt: Date.now(),
  })

  return () => {
    const current = activeGrokWebSessionRequests.get(sessionId)
    if (current?.port === port) {
      activeGrokWebSessionRequests.delete(sessionId)
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

export async function sendGrokProxyRequest(tabId, session, uiPort) {
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    pendingGrokProxyRequests.set(requestId, { uiPort, resolve, reject })

    const doSend = () =>
      Browser.tabs.sendMessage(tabId, {
        type: RuntimeMessage.GrokProxyRequest,
        data: { requestId, session },
      })

    doSend().catch(async (firstErr) => {
      if (/receiving end does not exist/i.test(firstErr?.message)) {
        try {
          await injectContentScript(tabId)
          await new Promise((r) => setTimeout(r, 500))
          await doSend()
          return
        } catch (retryErr) {
          pendingGrokProxyRequests.delete(requestId)
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
      pendingGrokProxyRequests.delete(requestId)
      reject(firstErr)
    })
  })
}

export function handleGrokProxyResponsePort(port) {
  if (!port.name.startsWith('grok-proxy-response:')) return false
  const requestId = port.name.replace('grok-proxy-response:', '')
  const entry = pendingGrokProxyRequests.get(requestId)
  if (!entry) {
    port.disconnect()
    return true
  }
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
    settle(resolve)
    try {
      port.disconnect()
    } catch {
      /* ignore */
    }
  })
  return true
}
