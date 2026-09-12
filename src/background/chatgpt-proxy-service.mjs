// ChatGPT Web proxy service.
//
// Owns the dedicated chatgpt.com proxy-tab lifecycle, the per-session request
// serialization lock, the debug log, and the proxy request/control send paths.
// These were previously inline in background/index.mjs and reached from the
// chatgpt-web provider through reverse `ctx` callbacks; they are now plain
// exports so the provider depends on this module directly (forward dependency)
// instead of being injected from the background entry point.
//
// This module holds the ONLY references to the pending-request and active-
// session Maps. The background entry point wires its onConnect proxy-response
// handler through `handleProxyResponsePort` so that the request table stays in
// one place.

import Browser from 'webextension-polyfill'
import { t } from 'i18next'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY, CHATGPT_WEB_DEBUG_LOG_KEY } from '../config/limits.mjs'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import { initSession } from '../services/init-session.mjs'
import { saveChatgptWebSessionSnapshot } from '../services/clients/chatgpt-web/thread-state.mjs'
import { getChatGptAccessToken } from '../services/wrappers.mjs'
import { getModelValue } from '../utils/model-name-convert.mjs'
import {
  CHATGPT_PROXY_QUERY_PARAM,
  CHATGPT_PROXY_QUERY_VALUE,
  isDedicatedChatgptProxyTabUrl,
} from '../utils/chatgpt-proxy-tab.mjs'
import {
  getChatgptWebConversation,
  listChatgptWebConversations,
  refreshChatgptWebConversation,
  stopChatgptWebConversationCacheSync,
  unlockChatgptWebConversationSync,
} from '../services/clients/chatgpt-web/conversation-api.mjs'
import {
  invalidateConversation,
  rememberChatgptWebCreatedConversationIndexEntry,
  upsertChatgptWebCreatedConversationIndexEntry,
} from '../services/clients/chatgpt-web/conversation-cache.mjs'
import { ChatgptProxyControlAction, RuntimeMessage } from '../protocol/messages.mjs'

const CHATGPT_WEB_DEBUG_LOG_LIMIT = 80
const CHATGPT_WEB_CONVERSATION_CREATE_ACK_TIMEOUT_MS = 60_000

// requestId -> { uiPort, resolve, reject }. Owned here so the onConnect
// proxy-response handler and sendChatgptProxyRequest share one table.
const pendingChatgptProxyRequests = new Map()

// sessionId -> { port, question, startedAt }. Owned here so the lock is
// acquired/released through a single map regardless of caller.
const activeChatgptWebSessionRequests = new Map()

// --- executeApi wiring -----------------------------------------------------
// sendChatgptWebConversationMessageThroughProxy / createChatgptWebConversation
// need to drive the provider runtime, which still lives in the background entry
// point (it owns the registry + ctx). To avoid a circular import
// (index.mjs <-> proxy-service) we accept a setter invoked once at startup.
let executeApiRef = async () => {
  throw new Error('executeApi not registered; background entry did not call registerExecuteApi')
}

export function registerExecuteApi(fn) {
  executeApiRef = fn
}

// --- in-memory port --------------------------------------------------------
// A minimal runtime.Port stand-in used by the conversation create/send flows
// so they can call executeApi (which speaks port.postMessage) without a real
// UI port. The onConnect handler forwards real proxy-tab ports separately.
export function createMemoryPort(onPostMessage) {
  const disconnectListeners = new Set()
  const messageListeners = new Set()

  return {
    _isClosed: false,
    postMessage(message) {
      onPostMessage(message)
    },
    disconnect() {
      if (this._isClosed) return
      this._isClosed = true
      disconnectListeners.forEach((listener) => {
        try {
          listener()
        } catch {
          /* ignore */
        }
      })
    },
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener)
      },
      removeListener(listener) {
        messageListeners.delete(listener)
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener)
      },
      removeListener(listener) {
        disconnectListeners.delete(listener)
      },
    },
  }
}

// --- debug log -------------------------------------------------------------

export async function appendChatgptWebDebugLog(config, stage, payload = {}) {
  if (config?.debugChatgptWebRequests !== true) return
  const entry = {
    at: new Date().toISOString(),
    stage,
    payload,
  }
  console.debug('[chatgpt-web-debug]', entry)
  try {
    const data = await Browser.storage.local.get({ [CHATGPT_WEB_DEBUG_LOG_KEY]: [] })
    const current = Array.isArray(data[CHATGPT_WEB_DEBUG_LOG_KEY])
      ? data[CHATGPT_WEB_DEBUG_LOG_KEY]
      : []
    const next = [...current, entry].slice(-CHATGPT_WEB_DEBUG_LOG_LIMIT)
    await Browser.storage.local.set({ [CHATGPT_WEB_DEBUG_LOG_KEY]: next })
  } catch (error) {
    console.debug('Failed to persist chatgpt web debug log', error)
  }
}

// --- session lock ----------------------------------------------------------

export function acquireChatgptWebSessionLock(session, port, config) {
  const sessionId = typeof session?.sessionId === 'string' ? session.sessionId : ''
  if (!sessionId) return () => {}

  const existing = activeChatgptWebSessionRequests.get(sessionId)
  if (existing) {
    void appendChatgptWebDebugLog(config, 'chatgpt-web-duplicate-blocked', {
      sessionId,
      model: getModelValue(session) || null,
      samePort: existing.port === port,
      sameQuestion: existing.question === session?.question,
      activeForMs: Date.now() - existing.startedAt,
    })
    if (existing.port === port && existing.question === session?.question) {
      return null
    }
    throw new Error('A ChatGPT Web request is already in progress for this session.')
  }

  activeChatgptWebSessionRequests.set(sessionId, {
    port,
    question: session?.question || null,
    startedAt: Date.now(),
  })

  return () => {
    const current = activeChatgptWebSessionRequests.get(sessionId)
    if (current?.port === port) {
      activeChatgptWebSessionRequests.delete(sessionId)
    }
  }
}

export function hasActiveChatgptWebSessionRequests() {
  return activeChatgptWebSessionRequests.size > 0
}

// --- proxy tab discovery / lifecycle --------------------------------------

async function discoverChatgptTab() {
  try {
    let tabs = await Browser.tabs.query({ url: 'https://chatgpt.com/*' }).catch(() => [])
    if (!tabs.length) {
      const all = await Browser.tabs.query({})
      tabs = all
    }
    tabs = tabs.filter((tab) => isDedicatedChatgptProxyTabUrl(tab.url))
    const candidate = tabs.find((tab) => tab.id && isDedicatedChatgptProxyTabUrl(tab.url))
    return candidate || null
  } catch {
    return null
  }
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null

    const finish = async () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      Browser.tabs.onUpdated.removeListener(onUpdated)
      Browser.tabs.onRemoved.removeListener(onRemoved)
      const latestTab = await Browser.tabs.get(tabId).catch(() => null)
      resolve(latestTab)
    }

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return
      if (info.status === 'complete') void finish()
    }

    const onRemoved = (removedTabId) => {
      if (removedTabId !== tabId) return
      void finish()
    }

    timer = setTimeout(() => {
      void finish()
    }, timeoutMs)

    Browser.tabs.onUpdated.addListener(onUpdated)
    Browser.tabs.onRemoved.addListener(onRemoved)

    // Resolve immediately if the tab was already complete before listeners attached.
    Browser.tabs
      .get(tabId)
      .then((currentTab) => {
        if (currentTab?.status === 'complete') void finish()
      })
      .catch(() => {
        void finish()
      })
  })
}

export async function ensureChatgptProxyTab() {
  const discovered = await discoverChatgptTab()
  if (discovered?.id) {
    await setUserConfig({ chatgptTabId: discovered.id })
    return discovered
  }

  const createdTab = await Browser.tabs.create({
    url: `https://chatgpt.com/?${CHATGPT_PROXY_QUERY_PARAM}=${CHATGPT_PROXY_QUERY_VALUE}`,
    active: false,
  })
  const readyTab = await waitForTabComplete(createdTab.id)
  if (readyTab?.id && isDedicatedChatgptProxyTabUrl(readyTab.url)) {
    await setUserConfig({ chatgptTabId: readyTab.id })
    return readyTab
  }
  return readyTab || createdTab || null
}

async function ensureChatgptProxyTabForControlRequest() {
  const config = await getUserConfig()

  if (config.chatgptTabId) {
    const tab = await Browser.tabs.get(config.chatgptTabId).catch(() => null)
    if (tab && isDedicatedChatgptProxyTabUrl(tab.url)) return tab
    await setUserConfig({ chatgptTabId: 0 })
  }

  return await ensureChatgptProxyTab()
}

// --- content-script injection ---------------------------------------------

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

// --- proxy request / control send -----------------------------------------

export async function sendChatgptProxyRequest(tabId, session, uiPort) {
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    pendingChatgptProxyRequests.set(requestId, { uiPort, resolve, reject })

    const doSend = () =>
      Browser.tabs.sendMessage(tabId, {
        type: RuntimeMessage.ChatgptProxyRequest,
        data: { session, requestId },
      })

    doSend().catch(async (firstErr) => {
      if (/receiving end does not exist/i.test(firstErr?.message)) {
        console.debug('[background] Content script not found, injecting into tab', tabId)
        try {
          await injectContentScript(tabId)
          await new Promise((r) => setTimeout(r, 500))
          await doSend()
          return
        } catch (retryErr) {
          console.debug('[background] Retry after injection failed:', retryErr?.message)
          pendingChatgptProxyRequests.delete(requestId)
          reject(
            new Error(
              'Content script could not be loaded in the ChatGPT tab. ' +
                'Please make sure ChatGPTBox has permission to access chatgpt.com ' +
                '(check the extensions icon or extension settings), then reload the tab and retry.',
            ),
          )
          return
        }
      }
      pendingChatgptProxyRequests.delete(requestId)
      reject(firstErr)
    })
  })
}

async function sendChatgptProxyControlRequest(tabId, action, payload) {
  const doSend = async () => {
    const response = await Browser.tabs.sendMessage(tabId, {
      type: RuntimeMessage.ChatgptProxyControlRequest,
      data: { action, payload },
    })
    if (!response?.ok) {
      throw new Error(response?.error || 'ChatGPT proxy control request failed')
    }
    return response.data
  }

  try {
    return await doSend()
  } catch (firstErr) {
    if (/receiving end does not exist/i.test(firstErr?.message)) {
      console.debug(
        '[background] Content script not found for control request, injecting into tab',
        tabId,
      )
      try {
        await injectContentScript(tabId)
        await new Promise((r) => setTimeout(r, 500))
        return await doSend()
      } catch (retryErr) {
        throw new Error(
          'Content script could not be loaded in the ChatGPT tab. ' +
            'Please make sure ChatGPTBox has permission to access chatgpt.com ' +
            '(check the extensions icon or extension settings), then reload the tab and retry.',
        )
      }
    }
    throw firstErr
  }
}

export async function executeChatgptWebControlRequestViaProxy(action, payload) {
  const tab = await ensureChatgptProxyTabForControlRequest()
  if (!tab?.id) {
    throw new Error(
      t('Please login at https://chatgpt.com first') +
        '\n\n' +
        t(
          'ChatGPT Web requests in this extension are sent through a dedicated background chatgpt.com proxy tab so they work reliably in Brave and similar browsers.',
        ),
    )
  }

  return await sendChatgptProxyControlRequest(tab.id, action, payload)
}

// --- fallback wrappers (direct call -> proxy fallback) --------------------

export function shouldFallbackToChatgptProxy(error) {
  const message = error?.message || String(error || '')
  return /failed to fetch/i.test(message) || /networkerror/i.test(message)
}

export async function getChatgptWebConversationWithFallback(payload = {}) {
  try {
    return await getChatgptWebConversation(payload)
  } catch (error) {
    if (!shouldFallbackToChatgptProxy(error)) throw error
    return await executeChatgptWebControlRequestViaProxy(
      ChatgptProxyControlAction.GetConversation,
      payload,
    )
  }
}

export async function syncChatgptWebConversationCacheWithFallback(payload = {}) {
  return await executeChatgptWebControlRequestViaProxy(
    ChatgptProxyControlAction.SyncConversations,
    payload,
  )
}

export async function stopChatgptWebConversationCacheSyncWithFallback() {
  return await stopChatgptWebConversationCacheSync()
}

export async function unlockChatgptWebConversationSyncWithFallback() {
  return await unlockChatgptWebConversationSync()
}

// --- list/get/refresh with proxy fallback (used by message router) --------

export async function listChatgptWebConversationsWithFallback(payload = {}) {
  if (payload?.forceSync === true) {
    await syncChatgptWebConversationCacheWithFallback({
      includeArchived: payload?.isArchived === true || payload?.isArchived === 'true',
      mode: 'full',
      automatic: false,
      reason: 'list_force_sync',
    })
    return await listChatgptWebConversations({ ...payload, forceSync: false })
  }
  try {
    return await listChatgptWebConversations(payload)
  } catch (error) {
    if (!shouldFallbackToChatgptProxy(error)) throw error
    return await executeChatgptWebControlRequestViaProxy(
      ChatgptProxyControlAction.ListConversations,
      payload,
    )
  }
}

export async function refreshChatgptWebConversationWithFallback(payload = {}) {
  try {
    return await refreshChatgptWebConversation(payload)
  } catch (error) {
    if (!shouldFallbackToChatgptProxy(error)) throw error
    return await executeChatgptWebControlRequestViaProxy(
      ChatgptProxyControlAction.RefreshConversation,
      payload,
    )
  }
}

export async function listChatgptWebModelsWithFallback() {
  const accessToken = await getChatGptAccessToken()
  try {
    const { refreshChatGptWebModelList } = await import('../services/model-lists.mjs')
    return await refreshChatGptWebModelList({ accessToken })
  } catch (error) {
    if (!shouldFallbackToChatgptProxy(error)) throw error
    return await executeChatgptWebControlRequestViaProxy(ChatgptProxyControlAction.ListModels, {})
  }
}

// --- conversation create / send (drive the provider runtime) --------------

export async function sendChatgptWebConversationMessageThroughProxy(payload = {}) {
  const conversationId =
    typeof payload.conversationId === 'string' ? payload.conversationId.trim() : ''
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (!conversationId) throw new Error('conversationId is required')
  if (!query) throw new Error('query is required')

  const messageId =
    typeof payload.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId.trim()
      : crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const conversation = await getChatgptWebConversationWithFallback({ conversationId })
  if (!conversation?.currentNode) {
    throw new Error('Conversation current node is required before sending a follow-up')
  }

  const config = await getUserConfig()
  const session = initSession({
    question: query,
    modelName: CHATGPT_WEB_DEFAULT_MODEL_KEY,
    autoClean: false,
    chatgptWebHistoryDisabledOverride: false,
    chatgptWebIncrementalOutput: false,
  })
  session.conversationId = conversationId
  session.messageId = messageId
  session.parentMessageId = conversation.currentNode
  session.chatgptWebModelSlugOverride = model || conversation.defaultModel || undefined

  return await new Promise((resolveOriginal, rejectOriginal) => {
    let latestSession = session
    let acknowledged = false
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn(value)
    }
    const resolvePromise = (value) => finish(resolveOriginal, value)
    const rejectPromise = (value) => finish(rejectOriginal, value)
    const port = createMemoryPort((message) => {
      if (message?.session && typeof message.session === 'object') {
        latestSession = { ...latestSession, ...message.session }
        if (!acknowledged) {
          acknowledged = true
          invalidateConversation(conversationId)
          void saveChatgptWebSessionSnapshot(latestSession, {
            source: 'conversation_reply_ack',
          }).catch(() => {})
          resolvePromise({
            conversationId,
            messageId,
            createdAt,
            pending: true,
            query,
          })
        }
      }

      if (message?.error) {
        if (!acknowledged) {
          port.disconnect()
          rejectPromise(new Error(message.error))
          return
        }
        console.debug('[background] Async conversation reply error:', message.error)
      }

      if (message?.done === true || message?.error) {
        void saveChatgptWebSessionSnapshot(latestSession, {
          source: 'conversation_reply_complete',
        }).catch(() => {})
        port.disconnect()
      }
    })

    const timeout = setTimeout(() => {
      if (acknowledged) return
      port.disconnect()
      rejectPromise(new Error('Timed out waiting for conversation reply acknowledgement'))
    }, CHATGPT_WEB_CONVERSATION_CREATE_ACK_TIMEOUT_MS)

    void executeApiRef(session, port, config)
      .then(() => {
        clearTimeout(timeout)
        if (!acknowledged) {
          rejectPromise(new Error('Conversation finished before acknowledgement'))
        }
      })
      .catch((error) => {
        clearTimeout(timeout)
        if (!acknowledged) {
          port.disconnect()
          rejectPromise(error)
          return
        }
        console.debug('[background] Async conversation reply failed after ack:', error?.message)
      })
  })
}

export async function createChatgptWebConversation(payload = {}) {
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (!query) throw new Error('query is required')

  const config = await getUserConfig()
  const session = initSession({
    question: query,
    modelName: CHATGPT_WEB_DEFAULT_MODEL_KEY,
    autoClean: false,
    chatgptWebHistoryDisabledOverride: false,
    chatgptWebIncrementalOutput: false,
  })
  session.messageId =
    typeof payload.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId.trim()
      : crypto.randomUUID()
  session.chatgptWebModelSlugOverride = model || undefined

  return await new Promise((resolveOriginal, rejectOriginal) => {
    let latestSession = session
    let acknowledged = false
    let settled = false
    const createdAt = new Date().toISOString()
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn(value)
    }
    const resolvePromise = (value) => finish(resolveOriginal, value)
    const rejectPromise = (value) => finish(rejectOriginal, value)
    const port = createMemoryPort(async (message) => {
      if (message?.session && typeof message.session === 'object') {
        latestSession = { ...latestSession, ...message.session }
        if (!acknowledged && latestSession.conversationId) {
          acknowledged = true
          invalidateConversation(latestSession.conversationId)
          try {
            await rememberChatgptWebCreatedConversationIndexEntry(latestSession.conversationId, {
              createdAt,
            })
          } catch {
            // Create still returns the streamed id if the in-memory stub cannot be recorded.
          }
          resolvePromise({
            conversationId: latestSession.conversationId,
            // The id of the user message that opened the thread, so a later GET
            // can anchor to it the same way follow-up sends do.
            messageId: latestSession.messageId || session.messageId,
            defaultModel: latestSession.chatgptWebModelSlugOverride || null,
            createdAt,
            pending: true,
            query,
          })
          void upsertChatgptWebCreatedConversationIndexEntry(latestSession.conversationId, {
            createdAt,
          }).catch(() => {})
          void saveChatgptWebSessionSnapshot(latestSession, {
            source: 'conversation_create_ack',
          }).catch(() => {})
        }
      }

      if (message?.error) {
        if (!acknowledged) {
          port.disconnect()
          rejectPromise(new Error(message.error))
          return
        }
        console.debug('[background] Async conversation create error:', message.error)
      }

      if (message?.done === true || message?.error) {
        void saveChatgptWebSessionSnapshot(latestSession, {
          source: 'conversation_create_complete',
        }).catch(() => {})
        port.disconnect()
      }
    })

    const timeout = setTimeout(() => {
      if (acknowledged) return
      port.disconnect()
      rejectPromise(new Error('Timed out waiting for conversation creation acknowledgement'))
    }, CHATGPT_WEB_CONVERSATION_CREATE_ACK_TIMEOUT_MS)

    void executeApiRef(session, port, config)
      .then(() => {
        clearTimeout(timeout)
        if (!acknowledged) {
          rejectPromise(new Error('Conversation finished before an id was reported'))
        }
      })
      .catch((error) => {
        clearTimeout(timeout)
        if (!acknowledged) {
          port.disconnect()
          rejectPromise(error)
          return
        }
        console.debug('[background] Async conversation create failed after ack:', error?.message)
      })
  })
}

// --- onConnect proxy-response port (forwarded from background entry) -------
// Content scripts on chatgpt.com open a port back to the service worker while
// processing CHATGPT_PROXY_REQUEST messages. The background entry calls this
// from its onConnect listener; the pending-request table lives here so both
// sendChatgptProxyRequest and this handler reference the same Map.
export function handleProxyResponsePort(port) {
  if (!port.name.startsWith('chatgpt-proxy-response:')) return false
  const requestId = port.name.replace('chatgpt-proxy-response:', '')
  const entry = pendingChatgptProxyRequests.get(requestId)
  if (!entry) {
    port.disconnect()
    return true
  }
  pendingChatgptProxyRequests.delete(requestId)
  const { uiPort, resolve, reject } = entry
  let settled = false

  // The abort controller for this request lives in the ChatGPT tab, on this
  // port. Relay the UI's stop request so the proxy route is cancellable.
  const uiStopListener = (msg) => {
    if (settled || !msg?.stop) return
    try {
      port.postMessage({ stop: true })
    } catch (e) {
      console.debug('[background] Failed to forward stop to proxy tab:', e?.message)
    }
  }
  uiPort.onMessage.addListener(uiStopListener)

  const settle = (callback, value) => {
    if (settled) return
    settled = true
    try {
      uiPort.onMessage.removeListener(uiStopListener)
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
      } catch (e) {
        console.debug('[background] Failed to forward proxy response:', e?.message)
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
    settle(reject, new Error('ChatGPT proxy tab disconnected before response completed'))
  })
  uiPort.onDisconnect.addListener(() => {
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

// Re-exported for diagnostics: summarizeApiMode lives in the background entry
// but appendChatgptWebDebugLog is the chatgpt-web-specific log sink used by
// both the proxy service and the provider router.
