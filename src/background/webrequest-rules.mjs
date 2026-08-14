// Web request / declarativeNetRequest rule management.
//
// Owns the scoped header-rewrite rule (Origin/Referer rewriting for ChatGPT
// requests initiated by the extension) and the webRequest listeners that catch
// the Arkose request form and observe the ChatGPT account-id header.

import Browser from 'webextension-polyfill'
import { defaultConfig, getUserConfig, setUserConfig } from '../config/storage.mjs'

const DYNAMIC_HEADER_REWRITE_RULE_IDS = [1002]
const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin
let observedChatgptAccountId = ''

// Team/Enterprise workspace is selected by chatgpt.com on conversation
// requests. Models, sentinel, and accounts/check often omit the header even
// while the Team workspace is still active, so those must not clear it.
const CHATGPT_WEB_ACCOUNT_SCOPED_PATH =
  /\/backend-api\/(?:f\/)?conversations?(?:\/|$)/

export function isChatgptWebAccountScopedRequest(url) {
  if (typeof url !== 'string' || !url) return false
  try {
    return CHATGPT_WEB_ACCOUNT_SCOPED_PATH.test(new URL(url).pathname)
  } catch {
    return false
  }
}

function readChatgptAccountIdHeader(headers) {
  const accountHeader = (headers || []).find(
    (header) => header?.name?.toLowerCase() === 'chatgpt-account-id',
  )
  return typeof accountHeader?.value === 'string' ? accountHeader.value.trim() : ''
}

function observeChatgptAccountIdHeader(details) {
  if (isExtensionInitiatedRequest(details)) return
  if (!isChatgptWebAccountScopedRequest(details?.url)) return

  const accountId = readChatgptAccountIdHeader(details.requestHeaders)
  if (accountId === observedChatgptAccountId) return
  observedChatgptAccountId = accountId
  void setUserConfig({ chatgptAccountId: accountId })
}

function getScopedHeaderRewriteRules(initiatorDomain) {
  return [
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
  ]
}

export async function syncScopedHeaderRewriteRules() {
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

function isExtensionInitiatedRequest(details) {
  const requestInitiator = details.initiator || details.originUrl || details.documentUrl
  if (!requestInitiator) return false
  try {
    return new URL(requestInitiator).origin === extensionOrigin
  } catch {
    return false
  }
}

// Register all webRequest listeners and the Arkose body capture. Called once
// from the background entry at startup.
export function registerWebRequestRules() {
  // Arkose request capture: record the public-key request URL + form so the
  // ChatGPT API client can replay it.
  try {
    Browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (
          details.url.includes('/public_key') &&
          !details.url.includes(defaultConfig.chatgptArkoseReqParams)
        ) {
          // requestBody is absent for bodyless requests and for bodies the
          // browser could not parse; neither should take down the listener.
          const requestBody = details.requestBody
          if (!requestBody) return

          let formData = new URLSearchParams()
          for (const k in requestBody.formData) {
            formData.append(k, requestBody.formData[k])
          }
          const rawBytes = requestBody.raw?.[0]?.bytes
          const chatgptArkoseReqForm =
            formData.toString() ||
            (rawBytes ? new TextDecoder('utf-8').decode(new Uint8Array(rawBytes)) : '')
          if (!chatgptArkoseReqForm) return

          setUserConfig({
            chatgptArkoseReqUrl: details.url,
            chatgptArkoseReqForm,
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

  // Team/Enterprise requests are scoped by this header. Observe the account
  // chatgpt.com sends on conversation requests; do not guess from /accounts
  // and do not treat header-less models/sentinel calls as a personal account.
  void getUserConfig()
    .then((config) => {
      if (!observedChatgptAccountId && config?.chatgptAccountId) {
        observedChatgptAccountId = config.chatgptAccountId
      }
    })
    .catch(() => {})
  try {
    Browser.webRequest.onBeforeSendHeaders.addListener(
      observeChatgptAccountIdHeader,
      {
        urls: ['https://*.chatgpt.com/backend-api/*'],
        types: ['xmlhttprequest'],
      },
      ['requestHeaders', 'extraHeaders'],
    )
  } catch (error) {
    // Firefox may reject extraHeaders; requestHeaders is sufficient there.
    try {
      Browser.webRequest.onBeforeSendHeaders.addListener(
        observeChatgptAccountIdHeader,
        {
          urls: ['https://*.chatgpt.com/backend-api/*'],
          types: ['xmlhttprequest'],
        },
        ['requestHeaders'],
      )
    } catch (fallbackError) {
      console.log(fallbackError)
    }
  }

  syncScopedHeaderRewriteRules()
}
