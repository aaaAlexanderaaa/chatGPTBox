import Browser from 'webextension-polyfill'
import {
  deleteConversation,
  generateAnswersWithChatgptWebApi,
  sendMessageFeedback,
} from '../services/apis/chatgpt-web'
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
  CHATGPT_WEB_DEBUG_LOG_KEY,
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
import { openUrl } from '../utils/open-url'
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
import { isUsingModelName } from '../utils/model-name-convert.mjs'
import { generateAnswersWithDeepSeekApi } from '../services/apis/deepseek-api.mjs'

const CHATGPT_WEB_DEBUG_LOG_LIMIT = 80

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

function setPortProxy(port, proxyTabId) {
  const proxyOnMessage = (msg) => {
    port.postMessage(msg)
  }
  const portOnMessage = (msg) => {
    if (port.proxy) port.proxy.postMessage(msg)
  }
  const proxyOnDisconnect = () => {
    attachProxy()
  }
  const attachProxy = () => {
    if (port.proxy) {
      port.proxy.onMessage.removeListener(proxyOnMessage)
      port.proxy.onDisconnect.removeListener(proxyOnDisconnect)
    }
    port.proxy = Browser.tabs.connect(proxyTabId)
    port.proxy.onMessage.addListener(proxyOnMessage)
    port.proxy.onDisconnect.addListener(proxyOnDisconnect)
  }
  const portOnDisconnect = () => {
    if (port.proxy) {
      port.proxy.onMessage.removeListener(proxyOnMessage)
      port.proxy.onDisconnect.removeListener(proxyOnDisconnect)
    }
    port.onMessage.removeListener(portOnMessage)
    port.onDisconnect.removeListener(portOnDisconnect)
  }
  attachProxy()
  port.onMessage.addListener(portOnMessage)
  port.onDisconnect.addListener(portOnDisconnect)
}

function isLikelyChatgptTabUrl(url) {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'chatgpt.com' || parsed.hostname.endsWith('.chatgpt.com')
  } catch {
    return false
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
        session.apiMode.customUrl.trim() ||
          config.customModelApiUrl.trim() ||
          'http://localhost:8000/v1/chat/completions',
        session.apiMode.apiKey.trim() || config.customApiKey,
        session.apiMode.customName,
      )
  } else if (isUsingChatgptWebModel(session)) {
    // Agent context is disabled for ChatGPT Web requests; keep user selections intact
    // and only drop page snapshot payload for this request path.
    session.pageContext = null
    void appendChatgptWebDebugLog(config, 'agent-context-disabled-web', {
      reason: 'chatgpt_web_model',
    })

    let tabId
    let proxyTab
    if (
      config.chatgptTabId &&
      config.customChatGptWebApiUrl === defaultConfig.customChatGptWebApiUrl
    ) {
      const tab = await Browser.tabs.get(config.chatgptTabId).catch(() => {})
      if (tab && isLikelyChatgptTabUrl(tab.url)) {
        tabId = tab.id
        proxyTab = tab
      } else if (config.chatgptTabId) {
        await setUserConfig({ chatgptTabId: 0 })
      }
    }
    const forceBackgroundInDebug = config.debugChatgptWebRequests === true
    if (tabId && !forceBackgroundInDebug) {
      void appendChatgptWebDebugLog(config, 'chatgpt-web-proxy-tab', {
        tabId,
        tabUrl: proxyTab?.url || null,
        route: executionRoute,
      })
      if (!port.proxy) setPortProxy(port, tabId)
      port.proxy?.postMessage({ session })
    } else {
      if (tabId && forceBackgroundInDebug) {
        void appendChatgptWebDebugLog(config, 'chatgpt-web-proxy-skipped-debug', {
          tabId,
          tabUrl: proxyTab?.url || null,
          route: executionRoute,
        })
      }
      void appendChatgptWebDebugLog(config, 'chatgpt-web-background', {
        route: executionRoute,
      })
      const accessToken = await getChatGptAccessToken()
      await generateAnswersWithChatgptWebApi(port, session.question, session, accessToken)
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

registerPortListener(async (session, port, config) => await executeApi(session, port, config))
syncScopedHeaderRewriteRules()
registerCommands()
refreshMenu()
