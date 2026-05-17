import Browser from 'webextension-polyfill'
import { deleteConversation, sendMessageFeedback } from '../services/apis/chatgpt-web'
import { generateAnswersWithBingWebApi } from '../services/apis/bing-web.mjs'
import {
  generateAnswersWithChatgptApi,
  generateAnswersWithGptCompletionApi,
} from '../services/apis/openai-api'
import { generateAnswersWithCustomApi } from '../services/apis/custom-api.mjs'
import { generateAnswersWithOllamaApi } from '../services/apis/ollama-api.mjs'
import { generateAnswersWithAzureOpenaiApi } from '../services/apis/azure-openai-api.mjs'
import { generateAnswersWithClaudeApi } from '../services/apis/claude-api.mjs'
import { generateAnswersWithChatGLMApi } from '../services/apis/chatglm-api.mjs'
import { generateAnswersWithWaylaidwandererApi } from '../services/apis/waylaidwanderer-api.mjs'
import { generateAnswersWithOpenRouterApi } from '../services/apis/openrouter-api.mjs'
import { generateAnswersWithAimlApi } from '../services/apis/aiml-api.mjs'
import {
  CHATGPT_WEB_DEFAULT_MODEL_KEY,
  CHATGPT_WEB_DEBUG_LOG_KEY,
  DEFAULT_CHATGPT_WEB_CONVERSATION_SYNC_INTERVAL_MINUTES,
  defaultConfig,
  getUserConfig,
  setUserConfig,
  isUsingChatgptWebModel,
  isUsingBingWebModel,
  isUsingGptCompletionApiModel,
  isUsingChatgptApiModel,
  isUsingCustomModel,
  isUsingOllamaApiModel,
  isUsingAzureOpenAiApiModel,
  isUsingClaudeApiModel,
  isUsingChatGLMApiModel,
  isUsingGithubThirdPartyApiModel,
  isUsingGeminiWebModel,
  isUsingClaudeWebModel,
  isUsingMoonshotApiModel,
  isUsingMoonshotWebModel,
  isUsingOpenRouterApiModel,
  isUsingAimlApiModel,
  isUsingDeepSeekApiModel,
} from '../config/index.mjs'
import '../_locales/i18n'
import { t } from 'i18next'
import { openUrl } from '../utils/open-url'
import { initSession } from '../services/init-session.mjs'
import { saveChatgptWebSessionSnapshot } from '../services/chatgpt-web-thread-state.mjs'
import {
  getBardCookies,
  getBingAccessToken,
  getChatGptAccessToken,
  getClaudeSessionKey,
  registerPortListener,
} from '../services/wrappers.mjs'
import { refreshMenu } from './menus.mjs'
import { registerCommands } from './commands.mjs'
import { generateAnswersWithBardWebApi } from '../services/apis/bard-web.mjs'
import { generateAnswersWithClaudeWebApi } from '../services/apis/claude-web.mjs'
import { generateAnswersWithMoonshotCompletionApi } from '../services/apis/moonshot-api.mjs'
import { generateAnswersWithMoonshotWebApi } from '../services/apis/moonshot-web.mjs'
import { getModelValue, isUsingModelName } from '../utils/model-name-convert.mjs'
import { generateAnswersWithDeepSeekApi } from '../services/apis/deepseek-api.mjs'
import {
  CHATGPT_PROXY_QUERY_PARAM,
  CHATGPT_PROXY_QUERY_VALUE,
  isDedicatedChatgptProxyTabUrl,
} from '../utils/chatgpt-proxy-tab.mjs'
import {
  invalidateConversation,
} from '../services/chatgpt-web-conversation-cache.mjs'
import {
  getChatgptWebConversation,
  listChatgptWebConversations,
  refreshChatgptWebConversation,
  syncChatgptWebConversationCache,
} from '../services/apis/chatgpt-web-conversation-api.mjs'

const CHATGPT_WEB_DEBUG_LOG_LIMIT = 80
const CHATGPT_WEB_CONVERSATION_SYNC_ALARM = 'chatgpt-web-conversation-sync'
const CHATGPT_WEB_CONVERSATION_CREATE_ACK_TIMEOUT_MS = 60_000
const pendingChatgptProxyRequests = new Map()
const activeChatgptWebSessionRequests = new Map()

function createMemoryPort(onPostMessage) {
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

async function getChatgptWebConversationWithFallback(payload = {}) {
  try {
    return await getChatgptWebConversation(payload)
  } catch (error) {
    if (!shouldFallbackToChatgptProxy(error)) throw error
    return await executeChatgptWebControlRequestViaProxy('chatgpt_web_get_conversation', payload)
  }
}

async function syncChatgptWebConversationCacheWithFallback(payload = {}) {
  try {
    return await syncChatgptWebConversationCache(payload)
  } catch (error) {
    if (!shouldFallbackToChatgptProxy(error)) throw error
    return await executeChatgptWebControlRequestViaProxy('chatgpt_web_sync_conversations', payload)
  }
}

async function ensureChatgptWebConversationSyncAlarm() {
  if (!Browser.alarms?.create) return
  const config = await getUserConfig().catch(() => defaultConfig)
  const periodInMinutes = Math.max(
    5,
    Number(config?.chatgptWebConversationSyncIntervalMinutes) ||
      DEFAULT_CHATGPT_WEB_CONVERSATION_SYNC_INTERVAL_MINUTES,
  )
  await Browser.alarms.create(CHATGPT_WEB_CONVERSATION_SYNC_ALARM, {
    periodInMinutes,
    delayInMinutes: 1,
  })
}

async function sendChatgptWebConversationMessageThroughProxy(payload = {}) {
  const conversationId =
    typeof payload.conversationId === 'string' ? payload.conversationId.trim() : ''
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (!conversationId) throw new Error('conversationId is required')
  if (!query) throw new Error('query is required')

  const messageId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  let conversation = await getChatgptWebConversationWithFallback({
    conversationId,
    forceRefresh: true,
  }).catch(() => null)
  if (!conversation) {
    conversation = await getChatgptWebConversationWithFallback({ conversationId })
  }
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

    void executeApi(session, port, config)
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

async function createChatgptWebConversation(payload = {}) {
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
    const port = createMemoryPort((message) => {
      if (message?.session && typeof message.session === 'object') {
        latestSession = { ...latestSession, ...message.session }
        if (!acknowledged && latestSession.conversationId) {
          acknowledged = true
          invalidateConversation(latestSession.conversationId)
          void saveChatgptWebSessionSnapshot(latestSession, {
            source: 'conversation_create_ack',
          }).catch(() => {})
          resolvePromise({
            conversationId: latestSession.conversationId,
            defaultModel: latestSession.chatgptWebModelSlugOverride || null,
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

    void executeApi(session, port, config)
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

function summarizeApiMode(apiMode) {
  if (!apiMode || typeof apiMode !== 'object') return null
  return {
    groupName: typeof apiMode.groupName === 'string' ? apiMode.groupName : '',
    itemName: typeof apiMode.itemName === 'string' ? apiMode.itemName : '',
    isCustom: apiMode.isCustom === true,
    customName: typeof apiMode.customName === 'string' ? apiMode.customName : '',
    displayName: typeof apiMode.displayName === 'string' ? apiMode.displayName : '',
  }
}

function detectExecutionRoute(session) {
  if (isUsingCustomModel(session)) return 'custom-api'
  if (isUsingChatgptWebModel(session)) return 'chatgpt-web'
  if (isUsingClaudeWebModel(session)) return 'claude-web'
  if (isUsingMoonshotWebModel(session)) return 'moonshot-web'
  if (isUsingBingWebModel(session)) return 'bing-web'
  if (isUsingGeminiWebModel(session)) return 'gemini-web'
  if (isUsingChatgptApiModel(session)) return 'chatgpt-api'
  if (isUsingClaudeApiModel(session)) return 'claude-api'
  if (isUsingMoonshotApiModel(session)) return 'moonshot-api'
  if (isUsingChatGLMApiModel(session)) return 'chatglm-api'
  if (isUsingDeepSeekApiModel(session)) return 'deepseek-api'
  if (isUsingOllamaApiModel(session)) return 'ollama-api'
  if (isUsingOpenRouterApiModel(session)) return 'openrouter-api'
  if (isUsingAimlApiModel(session)) return 'aiml-api'
  if (isUsingAzureOpenAiApiModel(session)) return 'azure-openai-api'
  if (isUsingGptCompletionApiModel(session)) return 'gpt-completion-api'
  if (isUsingGithubThirdPartyApiModel(session)) return 'waylaidwanderer-api'
  return 'unknown'
}

async function appendChatgptWebDebugLog(config, stage, payload = {}) {
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

async function discoverChatgptTab() {
  try {
    let tabs = await Browser.tabs.query({ url: 'https://chatgpt.com/*' }).catch(() => [])
    if (!tabs.length) {
      const all = await Browser.tabs.query({})
      tabs = all
    }
    tabs = tabs.filter((t) => isDedicatedChatgptProxyTabUrl(t.url))
    const candidate = tabs.find((t) => t.id && isDedicatedChatgptProxyTabUrl(t.url))
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
    // The `.catch` handles the "tab already gone" case (e.g. closed mid-check);
    // `onRemoved` would have handled it too, but resolving here avoids the full
    // timeout if Browser.tabs.get throws a "no tab with id" error.
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

async function ensureChatgptProxyTab() {
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

async function sendChatgptProxyRequest(tabId, session, uiPort) {
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    pendingChatgptProxyRequests.set(requestId, { uiPort, resolve, reject })

    const doSend = () =>
      Browser.tabs.sendMessage(tabId, {
        type: 'CHATGPT_PROXY_REQUEST',
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
      type: 'CHATGPT_PROXY_CONTROL_REQUEST',
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

async function ensureChatgptProxyTabForControlRequest() {
  const config = await getUserConfig()

  if (config.chatgptTabId) {
    const tab = await Browser.tabs.get(config.chatgptTabId).catch(() => null)
    if (tab && isDedicatedChatgptProxyTabUrl(tab.url)) return tab
    await setUserConfig({ chatgptTabId: 0 })
  }

  return await ensureChatgptProxyTab()
}

async function executeChatgptWebControlRequestViaProxy(action, payload) {
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

function shouldFallbackToChatgptProxy(error) {
  const message = error?.message || String(error || '')
  return /failed to fetch/i.test(message) || /networkerror/i.test(message)
}

async function listChatgptWebModels() {
  const accessToken = await getChatGptAccessToken()
  const { refreshChatGptWebModelList } = await import('../services/model-lists.mjs')
  return await refreshChatGptWebModelList({ accessToken })
}

function acquireChatgptWebSessionLock(session, port, config) {
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

async function executeApi(session, port, config) {
  console.debug('modelName', session.modelName)
  console.debug('apiMode', session.apiMode)
  const executionRoute = detectExecutionRoute(session)
  void appendChatgptWebDebugLog(config, 'router', {
    route: executionRoute,
    modelName: typeof session.modelName === 'string' ? session.modelName : null,
    apiMode: summarizeApiMode(session.apiMode),
  })
  if (isUsingCustomModel(session)) {
    if (!session.apiMode)
      await generateAnswersWithCustomApi(
        port,
        session.question,
        session,
        config.customModelApiUrl.trim() || 'http://localhost:8000/v1/chat/completions',
        config.customApiKey,
        config.customModelName,
      )
    else
      await generateAnswersWithCustomApi(
        port,
        session.question,
        session,
        session.apiMode.customUrl?.trim() ||
          config.customModelApiUrl.trim() ||
          'http://localhost:8000/v1/chat/completions',
        session.apiMode.apiKey?.trim() || config.customApiKey,
        session.apiMode.customName,
      )
  } else if (isUsingChatgptWebModel(session)) {
    const releaseChatgptWebSessionLock = acquireChatgptWebSessionLock(session, port, config)
    if (releaseChatgptWebSessionLock === null) return
    try {
      // Agent context is disabled for ChatGPT Web requests; keep user selections intact
      // and only drop page snapshot payload for this request path.
      session.pageContext = null
      void appendChatgptWebDebugLog(config, 'agent-context-disabled-web', {
        reason: 'chatgpt_web_model',
      })

      let tabId
      let proxyTab
      if (config.chatgptTabId) {
        const tab = await Browser.tabs.get(config.chatgptTabId).catch(() => {})
        if (tab && isDedicatedChatgptProxyTabUrl(tab.url)) {
          tabId = tab.id
          proxyTab = tab
        } else {
          await setUserConfig({ chatgptTabId: 0 })
        }
      }

      if (!tabId) {
        const ensured = await ensureChatgptProxyTab()
        if (ensured?.id) {
          tabId = ensured.id
          proxyTab = ensured
        }
      }

      if (tabId) {
        void appendChatgptWebDebugLog(config, 'chatgpt-web-proxy-forced', {
          tabId,
          tabUrl: proxyTab?.url || null,
          route: executionRoute,
          model: session.chatgptWebModelSlugOverride || getModelValue(session) || null,
          selectedModel: getModelValue(session) || null,
          endpointUrl: config.customChatGptWebApiUrl || defaultConfig.customChatGptWebApiUrl,
        })
        await sendChatgptProxyRequest(tabId, session, port)
        return
      }

      throw new Error(
        t('Please login at https://chatgpt.com first') +
          '\n\n' +
          t(
            'ChatGPT Web requests in this extension are sent through a dedicated background chatgpt.com proxy tab so they work reliably in Brave and similar browsers.',
          ),
      )
    } finally {
      releaseChatgptWebSessionLock()
    }
  } else if (isUsingClaudeWebModel(session)) {
    const sessionKey = await getClaudeSessionKey()
    await generateAnswersWithClaudeWebApi(port, session.question, session, sessionKey)
  } else if (isUsingMoonshotWebModel(session)) {
    await generateAnswersWithMoonshotWebApi(port, session.question, session, config)
  } else if (isUsingBingWebModel(session)) {
    const accessToken = await getBingAccessToken()
    if (isUsingModelName('bingFreeSydney', session))
      await generateAnswersWithBingWebApi(port, session.question, session, accessToken, true)
    else await generateAnswersWithBingWebApi(port, session.question, session, accessToken)
  } else if (isUsingGeminiWebModel(session)) {
    const cookies = await getBardCookies()
    await generateAnswersWithBardWebApi(port, session.question, session, cookies)
  } else if (isUsingChatgptApiModel(session)) {
    await generateAnswersWithChatgptApi(port, session.question, session, config.apiKey)
  } else if (isUsingClaudeApiModel(session)) {
    await generateAnswersWithClaudeApi(port, session.question, session)
  } else if (isUsingMoonshotApiModel(session)) {
    await generateAnswersWithMoonshotCompletionApi(
      port,
      session.question,
      session,
      config.moonshotApiKey,
    )
  } else if (isUsingChatGLMApiModel(session)) {
    await generateAnswersWithChatGLMApi(port, session.question, session)
  } else if (isUsingDeepSeekApiModel(session)) {
    await generateAnswersWithDeepSeekApi(port, session.question, session, config.deepSeekApiKey)
  } else if (isUsingOllamaApiModel(session)) {
    await generateAnswersWithOllamaApi(port, session.question, session)
  } else if (isUsingOpenRouterApiModel(session)) {
    await generateAnswersWithOpenRouterApi(port, session.question, session, config.openRouterApiKey)
  } else if (isUsingAimlApiModel(session)) {
    await generateAnswersWithAimlApi(port, session.question, session, config.aimlApiKey)
  } else if (isUsingAzureOpenAiApiModel(session)) {
    await generateAnswersWithAzureOpenaiApi(port, session.question, session)
  } else if (isUsingGptCompletionApiModel(session)) {
    await generateAnswersWithGptCompletionApi(port, session.question, session, config.apiKey)
  } else if (isUsingGithubThirdPartyApiModel(session)) {
    await generateAnswersWithWaylaidwandererApi(port, session.question, session)
  }
}

Browser.runtime.onInstalled.addListener(() => {
  void ensureChatgptWebConversationSyncAlarm()
  void syncChatgptWebConversationCacheWithFallback().catch(() => {})
})

Browser.runtime.onStartup?.addListener(() => {
  void ensureChatgptWebConversationSyncAlarm()
})

Browser.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== CHATGPT_WEB_CONVERSATION_SYNC_ALARM) return
  void syncChatgptWebConversationCacheWithFallback({ force: true }).catch(() => {})
})

Browser.storage?.local?.onChanged?.addListener((changes) => {
  if (!changes || !changes.chatgptWebConversationSyncIntervalMinutes) return
  void ensureChatgptWebConversationSyncAlarm()
})

void ensureChatgptWebConversationSyncAlarm()

Browser.runtime.onMessage.addListener(async (message, sender) => {
  switch (message.type) {
    case 'FEEDBACK': {
      const token = await getChatGptAccessToken()
      await sendMessageFeedback(token, message.data)
      break
    }
    case 'DELETE_CONVERSATION': {
      const token = await getChatGptAccessToken()
      await deleteConversation(token, message.data.conversationId)
      break
    }
    case 'NEW_URL': {
      await Browser.tabs.create({
        url: message.data.url,
        pinned: message.data.pinned,
      })
      if (message.data.jumpBack) {
        await setUserConfig({
          notificationJumpBackTabId: sender.tab.id,
        })
      }
      break
    }
    case 'SET_CHATGPT_TAB': {
      if (!isDedicatedChatgptProxyTabUrl(sender?.tab?.url)) break
      await setUserConfig({
        chatgptTabId: sender.tab.id,
      })
      break
    }
    case 'ACTIVATE_URL':
      await Browser.tabs.update(message.data.tabId, { active: true })
      break
    case 'OPEN_URL':
      openUrl(message.data.url)
      break
    case 'OPEN_CHAT_WINDOW': {
      const config = await getUserConfig()
      const url = Browser.runtime.getURL('IndependentPanel.html')
      const tabs = await Browser.tabs.query({ url: url, windowType: 'popup' })
      if (!config.alwaysCreateNewConversationWindow && tabs.length > 0)
        await Browser.windows.update(tabs[0].windowId, { focused: true })
      else
        await Browser.windows.create({
          url: url,
          type: 'popup',
          width: 500,
          height: 650,
        })
      break
    }
    case 'OPEN_API_SERVER': {
      const apiUrl = Browser.runtime.getURL('ApiServer.html')
      const existing = await Browser.tabs.query({ url: apiUrl })
      if (existing.length > 0) {
        await Browser.tabs.update(existing[0].id, { active: true })
      } else {
        await Browser.tabs.create({ url: apiUrl })
      }
      break
    }
    case 'API_BRIDGE_DIAGNOSE': {
      const diagConfig = await getUserConfig()
      let chatgptTabOk = false
      if (diagConfig.chatgptTabId) {
        const tab = await Browser.tabs.get(diagConfig.chatgptTabId).catch(() => null)
        chatgptTabOk = !!(tab && isDedicatedChatgptProxyTabUrl(tab.url))
      }
      let canFetchChatgpt = false
      try {
        const r = await fetch('https://chatgpt.com/api/auth/session', { method: 'HEAD' })
        canFetchChatgpt = r.status !== 0
      } catch {
        canFetchChatgpt = false
      }
      return {
        chatgptTabOk,
        canFetchChatgpt,
        hasAccessToken: !!diagConfig.accessToken,
      }
    }
    case 'OPEN_SIDE_PANEL': {
      // eslint-disable-next-line no-undef
      if (typeof chrome !== 'undefined' && chrome.sidePanel) {
        const tabId = message?.data?.tabId || sender?.tab?.id
        const windowId = message?.data?.windowId || sender?.tab?.windowId
        if (tabId && windowId) {
          try {
            // eslint-disable-next-line no-undef
            await chrome.sidePanel.setOptions({
              tabId,
              path: 'IndependentPanel.html',
              enabled: true,
            })
            // eslint-disable-next-line no-undef
            await chrome.sidePanel.open({ windowId, tabId })
          } catch (error) {
            console.debug('Failed to open side panel:', error)
          }
        }
      }
      break
    }
    case 'REFRESH_MENU':
      refreshMenu()
      break
    case 'PIN_TAB': {
      let tabId
      if (message.data.tabId) tabId = message.data.tabId
      else tabId = sender.tab.id

      await Browser.tabs.update(tabId, { pinned: true })
      if (message.data.saveAsChatgptConfig) {
        await setUserConfig({ chatgptTabId: tabId })
      }
      break
    }
    case 'FETCH': {
      // FETCH is an open proxy for the sender. Extension pages (popup, options,
      // IndependentPanel, ApiServer) are trusted. Content-script senders from
      // this extension are allowed only when the target's origin matches a
      // built-in entry or one of the user's own configured API endpoints — the
      // allowlist is derived from existing user config so adding an endpoint
      // in settings never requires a separate approval prompt.
      if (!isExtensionPageSender(sender)) {
        const sameExtension = !sender?.id || sender.id === Browser.runtime.id
        const targetOrigin = getFetchTargetOrigin(message?.data?.input)
        const allowed =
          sameExtension &&
          targetOrigin &&
          (await getFetchAllowedOrigins()).has(targetOrigin)
        if (!allowed) {
          return [
            null,
            { message: 'FETCH target not permitted for this sender', name: 'SecurityError' },
          ]
        }
      }

      if (message.data.input.includes('bing.com')) {
        const accessToken = await getBingAccessToken()
        await setUserConfig({ bingAccessToken: accessToken })
      }

      try {
        const response = await fetch(message.data.input, message.data.init)
        const text = await response.text()
        return [
          {
            body: text,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
          },
          null,
        ]
      } catch (error) {
        return [
          null,
          {
            message: error?.message || String(error),
            name: error?.name,
            stack: error?.stack,
          },
        ]
      }
    }
    case 'GET_COOKIE': {
      try {
        if (sender?.id && sender.id !== Browser.runtime.id) return null

        const url = message?.data?.url
        const name = message?.data?.name
        if (typeof url !== 'string' || typeof name !== 'string') return null

        const requestedUrl = new URL(url)
        if (requestedUrl.protocol !== 'https:') return null

        const senderTabUrl = sender?.tab?.url
        if (typeof senderTabUrl !== 'string') return null

        const senderOrigin = new URL(senderTabUrl).origin
        if (senderOrigin !== requestedUrl.origin) return null

        const allowedCookieNamesByOrigin = {
          'https://claude.ai': new Set(['sessionKey']),
        }
        const allowedCookieNames = allowedCookieNamesByOrigin[requestedUrl.origin]
        if (!allowedCookieNames?.has(name)) return null

        return (await Browser.cookies.get({ url: requestedUrl.origin + '/', name }))?.value
      } catch {
        return null
      }
    }
    case 'CHATGPT_WEB_LIST_CONVERSATIONS':
      try {
        return await listChatgptWebConversations(message.data || {})
      } catch (error) {
        if (!shouldFallbackToChatgptProxy(error)) throw error
        return await executeChatgptWebControlRequestViaProxy(
          'chatgpt_web_list_conversations',
          message.data || {},
        )
      }
    case 'CHATGPT_WEB_GET_CONVERSATION':
      try {
        return await getChatgptWebConversation(message.data || {})
      } catch (error) {
        if (!shouldFallbackToChatgptProxy(error)) throw error
        return await executeChatgptWebControlRequestViaProxy(
          'chatgpt_web_get_conversation',
          message.data || {},
        )
      }
    case 'CHATGPT_WEB_REFRESH_CONVERSATION':
      try {
        return await refreshChatgptWebConversation(message.data || {})
      } catch (error) {
        if (!shouldFallbackToChatgptProxy(error)) throw error
        return await executeChatgptWebControlRequestViaProxy(
          'chatgpt_web_refresh_conversation',
          message.data || {},
        )
      }
    case 'CHATGPT_WEB_SEND_CONVERSATION_MESSAGE':
      return await sendChatgptWebConversationMessageThroughProxy(message.data || {})
    case 'CHATGPT_WEB_CREATE_CONVERSATION':
      return await createChatgptWebConversation(message.data || {})
    case 'CHATGPT_WEB_SYNC_CONVERSATIONS':
      return await syncChatgptWebConversationCacheWithFallback({
        force: message?.data?.force === true,
        includeArchived: message?.data?.includeArchived === true,
      })
    case 'CHATGPT_WEB_LIST_MODELS':
      try {
        return await listChatgptWebModels()
      } catch (error) {
        if (!shouldFallbackToChatgptProxy(error)) throw error
        return await executeChatgptWebControlRequestViaProxy(
          'chatgpt_web_list_models',
          message.data || {},
        )
      }
  }
})

function addWebRequestListenerWithFallback(
  event,
  listener,
  filter,
  primaryExtraInfoSpec,
  fallbackExtraInfoSpec,
) {
  try {
    event.addListener(listener, filter, primaryExtraInfoSpec)
  } catch (error) {
    try {
      event.addListener(listener, filter, fallbackExtraInfoSpec)
    } catch (fallbackError) {
      console.log(fallbackError)
    }
  }
}

const DYNAMIC_HEADER_REWRITE_RULE_IDS = [1001, 1002, 1003]

function getScopedHeaderRewriteRules(initiatorDomain) {
  return [
    {
      id: 1001,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            operation: 'set',
            header: 'origin',
            value: 'https://www.bing.com',
          },
          {
            operation: 'set',
            header: 'referer',
            value: 'https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx',
          },
        ],
      },
      condition: {
        requestDomains: ['sydney.bing.com', 'www.bing.com'],
        resourceTypes: ['xmlhttprequest', 'websocket'],
        initiatorDomains: [initiatorDomain],
      },
    },
    {
      id: 1002,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            operation: 'set',
            header: 'origin',
            value: 'https://chatgpt.com',
          },
          {
            operation: 'set',
            header: 'referer',
            value: 'https://chatgpt.com',
          },
        ],
      },
      condition: {
        requestDomains: ['chatgpt.com'],
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: [initiatorDomain],
      },
    },
    {
      id: 1003,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            operation: 'set',
            header: 'origin',
            value: 'https://claude.ai',
          },
          {
            operation: 'set',
            header: 'referer',
            value: 'https://claude.ai',
          },
        ],
      },
      condition: {
        requestDomains: ['claude.ai'],
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: [initiatorDomain],
      },
    },
  ]
}

async function syncScopedHeaderRewriteRules() {
  const updateDynamicRules = Browser.declarativeNetRequest?.updateDynamicRules
  if (!updateDynamicRules) return

  const extensionId = Browser.runtime?.id
  if (!extensionId) return

  try {
    await updateDynamicRules.call(Browser.declarativeNetRequest, {
      removeRuleIds: DYNAMIC_HEADER_REWRITE_RULE_IDS,
      addRules: getScopedHeaderRewriteRules(extensionId),
    })
  } catch (error) {
    console.log(error)
  }
}

const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin

function isExtensionInitiatedRequest(details) {
  const requestInitiator = details.initiator || details.originUrl || details.documentUrl
  if (!requestInitiator) return false
  try {
    return new URL(requestInitiator).origin === extensionOrigin
  } catch {
    return false
  }
}

function isExtensionPageSender(sender) {
  if (!sender) return false
  if (sender.id && sender.id !== Browser.runtime.id) return false
  // Content scripts have sender.tab set to the host tab; extension pages do not have
  // a tab origin matching the extension. Also accept sender.url that lives on the
  // extension origin (popup/options/IndependentPanel/ApiServer pages).
  const url = sender.url
  if (!url) return false
  try {
    return new URL(url).origin === extensionOrigin
  } catch {
    return false
  }
}

// Built-in origins the extension may proxy for content-script senders. Limited
// to hosts whose client code lives inside the extension and is invoked from
// content-script-rendered UI (bing is the only one today).
const STATIC_FETCH_ORIGIN_ALLOWLIST = ['https://www.bing.com', 'https://bing.com']

// User-config fields that hold a single URL string. Anything the user has set
// here is considered "default allow" for FETCH — adding an endpoint in settings
// should never require a separate approval step.
const FETCH_ALLOWLIST_CONFIG_URL_KEYS = [
  'customModelApiUrl',
  'customChatGptWebApiUrl',
  'customOpenAiApiUrl',
  'customClaudeApiUrl',
  'githubThirdPartyUrl',
  'ollamaEndpoint',
  'chatgptArkoseReqUrl',
]

function addOriginFromUrlString(target, value) {
  if (typeof value !== 'string' || !value) return
  try {
    target.add(new URL(value).origin)
  } catch {
    /* skip malformed user input */
  }
}

async function getFetchAllowedOrigins() {
  const origins = new Set(STATIC_FETCH_ORIGIN_ALLOWLIST)
  let config
  try {
    config = await getUserConfig()
  } catch {
    return origins
  }
  for (const key of FETCH_ALLOWLIST_CONFIG_URL_KEYS) addOriginFromUrlString(origins, config[key])
  if (Array.isArray(config.customApiModes)) {
    for (const mode of config.customApiModes) addOriginFromUrlString(origins, mode?.customUrl)
  }
  if (Array.isArray(config.mcpServers)) {
    for (const server of config.mcpServers) addOriginFromUrlString(origins, server?.httpUrl)
  }
  return origins
}

function getFetchTargetOrigin(input) {
  const raw = typeof input === 'string' ? input : input?.url
  if (typeof raw !== 'string') return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

try {
  Browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (
        details.url.includes('/public_key') &&
        !details.url.includes(defaultConfig.chatgptArkoseReqParams)
      ) {
        let formData = new URLSearchParams()
        for (const k in details.requestBody.formData) {
          formData.append(k, details.requestBody.formData[k])
        }
        setUserConfig({
          chatgptArkoseReqUrl: details.url,
          chatgptArkoseReqForm:
            formData.toString() ||
            new TextDecoder('utf-8').decode(new Uint8Array(details.requestBody.raw[0].bytes)),
        }).then(() => {
          console.log('Arkose req url and form saved')
        })
      }
    },
    {
      urls: ['https://*.openai.com/*', 'https://*.chatgpt.com/*'],
      types: ['xmlhttprequest'],
    },
    ['requestBody'],
  )
} catch (error) {
  console.log(error)
}

addWebRequestListenerWithFallback(
  Browser.webRequest.onBeforeSendHeaders,
  (details) => {
    if (!isExtensionInitiatedRequest(details)) return
    const headers = details.requestHeaders
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].name === 'Origin') {
        headers[i].value = 'https://www.bing.com'
      } else if (headers[i].name === 'Referer') {
        headers[i].value = 'https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx'
      }
    }
    return { requestHeaders: headers }
  },
  {
    urls: ['wss://sydney.bing.com/*', 'https://www.bing.com/*'],
    types: ['xmlhttprequest', 'websocket'],
  },
  ['blocking', 'requestHeaders'],
  ['requestHeaders'],
)

addWebRequestListenerWithFallback(
  Browser.webRequest.onBeforeSendHeaders,
  (details) => {
    if (!isExtensionInitiatedRequest(details)) return
    const headers = details.requestHeaders
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].name === 'Origin') {
        headers[i].value = 'https://claude.ai'
      } else if (headers[i].name === 'Referer') {
        headers[i].value = 'https://claude.ai'
      }
    }
    return { requestHeaders: headers }
  },
  {
    urls: ['https://claude.ai/*'],
    types: ['xmlhttprequest'],
  },
  ['blocking', 'requestHeaders'],
  ['requestHeaders'],
)

try {
  // eslint-disable-next-line no-undef
  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    Browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
      if (!tab?.url) return
      try {
        // eslint-disable-next-line no-undef
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'IndependentPanel.html',
          enabled: true,
        })
      } catch {
        // sidePanel not supported for this tab type
      }
    })
  }
} catch (error) {
  console.log(error)
}

// Reverse proxy port handler: content scripts on chatgpt.com create ports back
// to the service worker when processing CHATGPT_PROXY_REQUEST messages.
Browser.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('chatgpt-proxy-response:')) return
  const requestId = port.name.replace('chatgpt-proxy-response:', '')
  const entry = pendingChatgptProxyRequests.get(requestId)
  if (!entry) {
    port.disconnect()
    return
  }
  pendingChatgptProxyRequests.delete(requestId)
  const { uiPort, resolve, reject } = entry
  let settled = false

  const settle = (callback, value) => {
    if (settled) return
    settled = true
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
})

// API bridge WebSocket proxy: routes the localhost connection through the
// service worker so that it works in browsers (e.g. Brave) that block outbound
// network requests from extension pages.
//
// MV3 service workers are terminated after ~30 s of inactivity. To prevent
// this we send an application-level ping on the WebSocket every 20 s
// (Chrome 116+ treats active WebSocket sends as "activity") and accept
// keepalive pings from the bridge page on the port.
const WS_KEEPALIVE_MS = 20_000

Browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'api-bridge-proxy') return

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
})

registerPortListener(async (session, port, config) => await executeApi(session, port, config))
syncScopedHeaderRewriteRules()
registerCommands()
refreshMenu()
