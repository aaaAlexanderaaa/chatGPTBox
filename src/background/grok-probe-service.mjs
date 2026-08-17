// Grok Web login probe (GET-only).
//
// Detects grok.com session cookies and, when an existing grok.com tab is
// available, hard-confirms via GET /api/auth/session + GET /rest/rate-limits
// inside that tab. Never opens a tab. Never POSTs.

import {
  buildGrokProbeConfig,
  parseGrokAuthSession,
  parseGrokRateLimits,
} from '../services/clients/grok-web/session.mjs'
import { isLikelyGrokTabUrl } from '../utils/grok-proxy-tab.mjs'

const GROK_COOKIE_URL = 'https://grok.com/'

function hasCookies(cookies) {
  return Array.isArray(cookies) && cookies.length > 0
}

function isGrokCookieChange(changeInfo) {
  const domain = changeInfo?.cookie?.domain
  if (typeof domain !== 'string' || !domain) return false
  const host = domain.startsWith('.') ? domain.slice(1) : domain
  return host === 'grok.com' || host.endsWith('.grok.com')
}

async function findExistingGrokTab(tabsApi) {
  if (!tabsApi?.query) return null
  try {
    let tabs = await tabsApi.query({ url: 'https://grok.com/*' }).catch(() => [])
    if (!tabs?.length) {
      const all = await tabsApi.query({}).catch(() => [])
      tabs = all || []
    }
    return (tabs || []).find((tab) => tab?.id && isLikelyGrokTabUrl(tab.url)) || null
  } catch {
    return null
  }
}

/**
 * Pure probe reducer. Uses Task 3 parsers — do not re-parse session/tier here.
 *
 * - no cookies → signed-out config
 * - cookies + session/rate-limit JSON → hard-confirm via parsers
 * - cookies but no session JSON → optimistic signed-in without inventing tier/models
 */
export function applyGrokProbeFromParts({ cookies, sessionJson, rateLimitJson } = {}) {
  if (!hasCookies(cookies)) {
    return buildGrokProbeConfig({ session: { signedIn: false }, tier: '' })
  }

  if (sessionJson === undefined) {
    return {
      grokWebSignedIn: true,
      grokWebAccountTier: '',
      grokWebAccountModels: [],
    }
  }

  const session = parseGrokAuthSession(sessionJson)
  if (!session.signedIn) {
    return buildGrokProbeConfig({ session, tier: '' })
  }

  const tier =
    rateLimitJson === undefined || rateLimitJson === null
      ? 'basic'
      : parseGrokRateLimits(rateLimitJson)

  return buildGrokProbeConfig({ session, tier })
}

/**
 * Register cookie/tab listeners and run an initial probe.
 * Hard-confirm GETs go only through `fetchOnTab(tabId)` — never open a tab.
 *
 * Accepts `{ cookiesApi, tabsApi, fetchImpl, fetchOnTab, setUserConfig, getUserConfig }`.
 * `fetchImpl` / `getUserConfig` are reserved for callers; hard-confirm uses `fetchOnTab` only.
 */
export function registerGrokProbe(deps = {}) {
  const { cookiesApi, tabsApi, fetchOnTab, setUserConfig } = deps
  if (!cookiesApi || !setUserConfig || typeof fetchOnTab !== 'function') return

  let probing = false

  async function runProbe() {
    if (probing) return
    probing = true
    try {
      const cookies = await cookiesApi.getAll({ url: GROK_COOKIE_URL }).catch(() => [])
      if (!hasCookies(cookies)) {
        await setUserConfig(applyGrokProbeFromParts({ cookies: [] }))
        return
      }

      const tab = await findExistingGrokTab(tabsApi)
      if (!tab?.id) {
        await setUserConfig(applyGrokProbeFromParts({ cookies }))
        return
      }

      let sessionJson
      let rateLimitJson
      try {
        const result = await fetchOnTab(tab.id)
        sessionJson = result?.sessionJson
        rateLimitJson = result?.rateLimitJson
      } catch {
        // Tab was not ready / inject failed. Cookies still exist — stay
        // optimistic instead of treating a missed GET as a confirmed logout.
      }

      if (sessionJson == null) {
        await setUserConfig(applyGrokProbeFromParts({ cookies }))
        return
      }

      await setUserConfig(applyGrokProbeFromParts({ cookies, sessionJson, rateLimitJson }))
    } finally {
      probing = false
    }
  }

  cookiesApi.onChanged?.addListener?.((changeInfo) => {
    if (!isGrokCookieChange(changeInfo)) return
    void runProbe()
  })

  tabsApi?.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    if (changeInfo?.status !== 'complete') return
    if (!isLikelyGrokTabUrl(tab?.url)) return
    void runProbe()
  })

  void runProbe()
}
