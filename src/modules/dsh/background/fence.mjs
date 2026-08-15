// DeepSeek Harness trust-fence header rewrite, absorbed from the
// feat/deepseek-harness-bridge branch (roadmap Phase A asset list).
//
// The harness's /api gateway runs a browser-trust fence (DNS-rebinding /
// cross-site defense, `isTrustedApiRequest` in the harness): a request with
// `sec-fetch-site: cross-site` is refused, and any `Origin` whose host:port
// differs from `Host` is refused — which describes every fetch an extension
// context makes (Origin: chrome-extension://…). An absent Origin passes (the
// Host fence already bound loopback), and only the literal cross-site fetch
// marker is refused.
//
// The module therefore installs a header rewrite narrowly scoped to the
// extension's own requests against the configured harness origin:
//   - MV3 (Chromium): one declarativeNetRequest dynamic rule.
//   - MV2 (Firefox): a blocking webRequest.onBeforeSendHeaders listener.
// Both only touch `Origin` (removed) and `Sec-Fetch-Site` (set to `none`) on
// `/api*` requests initiated by this extension — the harness's own web UI
// traffic is never modified, and neither side's code changes.
//
// Boundary note: config is injected by the caller (background-services.mjs)
// — this file never imports extension core code, only webextension-polyfill.

import Browser from 'webextension-polyfill'

export const DSH_HEADER_RULE_ID = 1003
const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin

export function normalizeDshEndpoint(raw) {
  const endpoint = String(raw || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/i.test(endpoint)) return null
  return endpoint
}

/**
 * The DNR rule that makes extension-initiated /api requests pass the fence.
 * Pure builder — unit-tested without a browser.
 */
export function buildDshHeaderRewriteRule(endpoint, extensionId) {
  const origin = normalizeDshEndpoint(endpoint)
  if (!origin) return null
  return {
    id: DSH_HEADER_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        // Absent Origin passes the fence; a chrome-extension:// origin never does.
        { operation: 'remove', header: 'origin' },
        // Only the literal cross-site marker is refused; `none` is fine.
        { operation: 'set', header: 'sec-fetch-site', value: 'none' },
      ],
    },
    condition: {
      urlFilter: `|${origin}/api`,
      resourceTypes: ['xmlhttprequest', 'websocket'],
      initiatorDomains: [extensionId],
    },
  }
}

/** Whether a webRequest details object is an extension-initiated /api call on `endpoint`. */
export function isDshFenceRewriteTarget(details, endpoint) {
  const origin = normalizeDshEndpoint(endpoint)
  if (!origin) return false
  const requestInitiator = details?.initiator || details?.originUrl || details?.documentUrl
  if (!requestInitiator) return false
  let initiatorOrigin
  let url
  try {
    initiatorOrigin = new URL(requestInitiator).origin
    url = new URL(details.url)
  } catch {
    return false
  }
  return initiatorOrigin === extensionOrigin && url.origin === origin && url.pathname.startsWith('/api')
}

function stripFenceHeaders(requestHeaders) {
  return (requestHeaders || []).filter(
    (header) => !['origin', 'sec-fetch-site'].includes((header?.name || '').toLowerCase()),
  )
}

let webRequestFallbackRegistered = false
let currentEndpointForFallback = ''

/** MV2/Firefox path: one blocking listener, filtered to the configured endpoint. */
function registerDshWebRequestFallback(endpoint) {
  currentEndpointForFallback = endpoint
  if (webRequestFallbackRegistered) return
  webRequestFallbackRegistered = true
  try {
    Browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (!isDshFenceRewriteTarget(details, currentEndpointForFallback)) return {}
        return { requestHeaders: stripFenceHeaders(details.requestHeaders) }
      },
      { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'websocket'] },
      ['blocking', 'requestHeaders'],
    )
  } catch (error) {
    console.log('DSH module: webRequest fallback unavailable', error)
  }
}

/**
 * Keep the rewrite in sync with the given endpoint (DNR when available).
 * Called with the injected config value; an empty endpoint removes the rule.
 */
export async function syncDshHeaderRules(endpoint) {
  const normalized = normalizeDshEndpoint(endpoint) || ''
  const updateDynamicRules = Browser.declarativeNetRequest?.updateDynamicRules
  if (updateDynamicRules) {
    const extensionId = Browser.runtime?.id
    const rule = extensionId ? buildDshHeaderRewriteRule(normalized, extensionId) : null
    try {
      await updateDynamicRules.call(Browser.declarativeNetRequest, {
        removeRuleIds: [DSH_HEADER_RULE_ID],
        addRules: rule ? [rule] : [],
      })
    } catch (error) {
      console.log('DSH module: DNR rule update failed', error)
    }
    return
  }
  registerDshWebRequestFallback(normalized)
}

/**
 * Connectivity diagnosis for the settings UI. Exercises the real path the
 * gateway uses (RPC + WebSocket, through the header rewrite) and reports
 * which step failed.
 */
export async function diagnoseDsh(endpoint) {
  const normalized = normalizeDshEndpoint(endpoint)
  if (!normalized) {
    return { ok: false, stage: 'endpoint', message: `invalid endpoint "${endpoint}"` }
  }

  const started = Date.now()
  const result = { ok: false, stage: 'rpc', endpoint: normalized, version: null, wsOk: false }
  try {
    const response = await fetch(`${normalized}/api/host.describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `diagnose-${started}`,
        method: 'host.describe',
        payload: {},
      }),
    })
    if (response.status === 403) {
      result.stage = 'fence'
      result.message = `HTTP 403 from the harness trust fence — the header rewrite is not taking effect on this browser`
      return result
    }
    if (!response.ok) {
      result.message = `HTTP ${response.status} from host.describe`
      return result
    }
    const body = await response.json().catch(() => null)
    if (body?.type !== 'server-response' || body.result?.ok !== true) {
      result.message = body?.result?.error
        ? `${body.result.error.code}: ${body.result.error.message}`
        : 'malformed response envelope'
      return result
    }
    result.version = body.result.value?.version ?? null
    result.stage = 'websocket'
  } catch (error) {
    result.message = `${error?.message || error} — is \`dsh web\` running at ${normalized}?`
    return result
  }

  // The mux downlink is a WebSocket upgrade on the same /api fence.
  result.wsOk = await new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        // ignore
      }
      resolve(value)
    }
    let socket
    try {
      socket = new WebSocket(`${normalized.replace(/^http/, 'ws')}/api/events.mux`)
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => done(false), 5000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      done(true)
    })
    socket.addEventListener('close', () => {
      clearTimeout(timer)
      done(false)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      done(false)
    })
  })
  if (!result.wsOk) {
    result.message = 'mux WebSocket upgrade failed — the harness may be an older build'
    return result
  }
  result.ok = true
  result.stage = 'done'
  result.latencyMs = Date.now() - started
  return result
}
