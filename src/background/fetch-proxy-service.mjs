// FETCH proxy service.
//
// The background service worker is the only context with the full host
// permissions, so content scripts route cross-origin fetches through the
// FETCH runtime message. This module owns the allowlist derivation and the
// sender-trust check, and exposes `handleFetchMessage` for the background
// message router to call.
//
// Extension pages (popup/options/IndependentPanel/ApiServer) are trusted
// unconditionally. Content-script senders are allowed only when the target's
// origin matches a built-in entry or one of the user's own configured API
// endpoints — adding an endpoint in settings never requires a separate
// approval prompt.

import Browser from 'webextension-polyfill'
import { getUserConfig } from '../config/storage.mjs'

const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin

// User-config fields that hold a single URL string. Anything the user has set
// here is considered "default allow" for FETCH — adding an endpoint in settings
// should never require a separate approval step.
const FETCH_ALLOWLIST_CONFIG_URL_KEYS = [
  'customModelApiUrl',
  'customChatGptWebApiUrl',
  'customOpenAiApiUrl',
  'customClaudeApiUrl',
  'ollamaEndpoint',
  'chatgptArkoseReqUrl',
]

export function isExtensionPageSender(sender) {
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

function addOriginFromUrlString(target, value) {
  if (typeof value !== 'string' || !value) return
  try {
    target.add(new URL(value).origin)
  } catch {
    /* skip malformed user input */
  }
}

export async function getFetchAllowedOrigins() {
  const origins = new Set()
  let config
  try {
    config = await getUserConfig()
  } catch {
    return origins
  }
  for (const key of FETCH_ALLOWLIST_CONFIG_URL_KEYS) addOriginFromUrlString(origins, config[key])
  if (Array.isArray(config.l1Providers)) {
    for (const provider of config.l1Providers) addOriginFromUrlString(origins, provider?.baseUrl)
  }
  if (Array.isArray(config.customApiModes)) {
    for (const mode of config.customApiModes) addOriginFromUrlString(origins, mode?.customUrl)
  }
  return origins
}

export function getFetchTargetOrigin(input) {
  const raw = typeof input === 'string' ? input : input?.url
  if (typeof raw !== 'string') return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

// Handle a FETCH message. Returns the [response, error] tuple shape expected
// by the message router. Returns `undefined` when the router should treat it
// as "not handled" (never happens for FETCH — it always returns a tuple).
export async function handleFetchMessage(message, sender) {
  if (!isExtensionPageSender(sender)) {
    const sameExtension = !sender?.id || sender.id === Browser.runtime.id
    const targetOrigin = getFetchTargetOrigin(message?.data?.input)
    const allowed =
      sameExtension && targetOrigin && (await getFetchAllowedOrigins()).has(targetOrigin)
    if (!allowed) {
      return [
        null,
        { message: 'FETCH target not permitted for this sender', name: 'SecurityError' },
      ]
    }
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
