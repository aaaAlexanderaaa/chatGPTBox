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
// Boundary of the rewrite (D-22): it covers the extension's HTTP requests
// (RPC, /api/respond), NOT WebSocket handshakes — Chromium's DNR cannot
// modify handshake headers at all (remove or set), so an extension-context
// socket always reaches the fence with its chrome-extension:// Origin and is
// refused. The two event downlinks therefore ride the content-script bridge
// (downlink-bridge.mjs); the `websocket` resource type stays listed only so
// the rule would cover handshakes on a future Chromium that lifts this.
//
// Boundary note: config is injected by the caller (background-services.mjs)
// — this file never imports extension core code, only webextension-polyfill.

import Browser from 'webextension-polyfill'

export const DSH_HEADER_RULE_ID = 1003
const extensionOrigin = new URL(Browser.runtime.getURL('/')).origin

function isLoopbackHostname(hostname) {
  const host = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  const ipv4 = host.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false
  return ipv4.slice(1).every((octet) => {
    const n = Number(octet)
    return n >= 0 && n <= 255
  })
}

export function normalizeDshEndpoint(raw) {
  const endpoint = String(raw || '').trim()
  if (!endpoint) return null
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!isLoopbackHostname(url.hostname)) return null
  // Origin only — a typed path would make the client hit /api/api/...
  return url.origin
}

/** Live gateway origin, or null when the module is off / the URL is not loopback. */
export function endpointForLiveGateway(enabled, rawEndpoint) {
  if (enabled !== true) return null
  return normalizeDshEndpoint(rawEndpoint)
}

/**
 * Why a UI port is held instead of attached to a live gateway.
 * `applied: false` is the MV3 cold-start window before applyDshModuleState.
 */
export function resolveGatewayHoldReason({ enabled, endpoint, applied = true } = {}) {
  if (applied !== true) return 'starting'
  if (enabled !== true) return 'disabled'
  if (!normalizeDshEndpoint(endpoint)) return 'invalid-endpoint'
  return null
}

export function helloForGatewayHold(reason) {
  if (reason === 'starting') {
    return { type: 'hello', status: 'connecting', endpoint: '', version: null, lastError: null }
  }
  if (reason === 'invalid-endpoint') {
    return {
      type: 'hello',
      status: 'offline',
      endpoint: '',
      version: null,
      lastError: 'DeepSeek Harness endpoint must be loopback (127.0.0.1, localhost, or ::1).',
    }
  }
  return {
    type: 'hello',
    status: 'disabled',
    endpoint: '',
    version: null,
    lastError: 'DeepSeek Harness module is off',
  }
}

/** Recreate the live gateway only when the origin actually moved. */
export function shouldRecreateDshGateway(previousEndpoint, nextEndpoint, hasGateway) {
  if (!hasGateway) return true
  if (previousEndpoint === undefined) return false
  return normalizeDshEndpoint(previousEndpoint) !== normalizeDshEndpoint(nextEndpoint)
}

/** MV2 listener filter: only the configured loopback origin, never all URLs. */
export function webRequestFallbackUrls(endpoint) {
  const origin = normalizeDshEndpoint(endpoint)
  return origin ? [`${origin}/*`] : []
}

/** Persist a typed endpoint on blur: valid origins only, already-normalized. */
export function resolveEndpointCommit(draft, current) {
  const normalized = normalizeDshEndpoint(draft)
  if (!normalized) return current
  if (normalized === normalizeDshEndpoint(current)) return current
  return normalized
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
  return (
    initiatorOrigin === extensionOrigin && url.origin === origin && url.pathname.startsWith('/api')
  )
}

/** MV2 equivalent of the DNR rewrite: drop Origin, set Sec-Fetch-Site to none. */
export function rewriteFenceHeaders(requestHeaders) {
  const kept = (requestHeaders || []).filter(
    (header) => !['origin', 'sec-fetch-site'].includes((header?.name || '').toLowerCase()),
  )
  return [...kept, { name: 'Sec-Fetch-Site', value: 'none' }]
}

let webRequestFallbackListener = null
let webRequestFallbackFilter = ''
let currentEndpointForFallback = ''

function unregisterDshWebRequestFallback() {
  if (!webRequestFallbackListener) return
  try {
    Browser.webRequest?.onBeforeSendHeaders?.removeListener?.(webRequestFallbackListener)
  } catch {
    // listener was never installed, or the API vanished on shutdown
  }
  webRequestFallbackListener = null
  webRequestFallbackFilter = ''
  currentEndpointForFallback = ''
}

/** MV2/Firefox path: one blocking listener, scoped to the configured origin. */
function registerDshWebRequestFallback(endpoint) {
  const origin = normalizeDshEndpoint(endpoint) || ''
  const urls = webRequestFallbackUrls(origin)
  if (!urls.length) {
    unregisterDshWebRequestFallback()
    return
  }
  if (webRequestFallbackListener && webRequestFallbackFilter === origin) {
    currentEndpointForFallback = origin
    return
  }
  unregisterDshWebRequestFallback()
  currentEndpointForFallback = origin
  const listener = (details) => {
    if (!isDshFenceRewriteTarget(details, currentEndpointForFallback)) return {}
    return { requestHeaders: rewriteFenceHeaders(details.requestHeaders) }
  }
  try {
    Browser.webRequest.onBeforeSendHeaders.addListener(
      listener,
      { urls, types: ['xmlhttprequest', 'websocket'] },
      ['blocking', 'requestHeaders'],
    )
    webRequestFallbackListener = listener
    webRequestFallbackFilter = origin
  } catch (error) {
    currentEndpointForFallback = ''
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
 * gateway uses and reports which step failed:
 *   - endpoint:  not a loopback http(s) origin;
 *   - fence:     HTTP 403 — the header rewrite is not taking effect;
 *   - rpc:       the harness answered, but not with a sane envelope;
 *   - websocket: the mux event stream did not open. In a browser this MUST
 *     go through the carrier-tab bridge (probeDownlink): a direct
 *     extension-context WebSocket can never pass the harness trust fence
 *     (D-22), so the injected probe is the only meaningful browser-side
 *     test. Without one (Node smoke tests) a direct socket is attempted.
 * @param {string} endpoint
 * @param {{ probeDownlink?: () => Promise<{ ok: boolean, detail: string }> }} [options]
 */
export async function diagnoseDsh(endpoint, { probeDownlink } = {}) {
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
  if (probeDownlink) {
    const probe = await probeDownlink()
    result.wsOk = probe.ok === true
    if (!result.wsOk) {
      result.message = `mux downlink bridge failed — ${probe.detail || 'unknown cause'}`
      return result
    }
    result.ok = true
    result.stage = 'done'
    result.latencyMs = Date.now() - started
    return result
  }
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
    result.message =
      'mux WebSocket upgrade failed — /api/events.mux did not upgrade (direct probe; browser runs go through the carrier-tab bridge)'
    return result
  }
  result.ok = true
  result.stage = 'done'
  result.latencyMs = Date.now() - started
  return result
}
