// Web request / declarativeNetRequest rule management.
//
// Owns the scoped header-rewrite rules (Origin/Referer rewriting for Bing,
// ChatGPT, Claude requests initiated by the extension) and the webRequest
// listeners that catch the Arkose request form and do MV2-style blocking
// header rewrites as a fallback where DNR is unavailable.

import Browser from 'webextension-polyfill'
import { defaultConfig, setUserConfig } from '../config/storage.mjs'

const DYNAMIC_HEADER_REWRITE_RULE_IDS = [1001, 1002, 1003]
const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin

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

  // Bing Origin/Referer rewrite (MV2 blocking fallback; DNR rule 1001 covers MV3).
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

  // Claude Origin/Referer rewrite (MV2 blocking fallback; DNR rule 1003 covers MV3).
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

  syncScopedHeaderRewriteRules()
}
