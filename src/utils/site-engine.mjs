// Per-site engine assignment (roadmap C3 / decision D-14).
//
// "On this site, behave like this" is a property of the site (integration),
// not of the engine: the engine is just one item inside the site's rules.
// These helpers are pure so the resolution logic is unit-testable and so
// both the content script (session init) and the settings UI (picker value)
// share one truth.

/**
 * Resolve which hostname-derived site key the current page belongs to.
 * Mirrors the matching precedence the content script has always used:
 * custom regex (exclusive when useSiteRegexOnly) → built-in adapter keys.
 *
 * @param {{ siteRegex?: string, useSiteRegexOnly?: boolean }} config
 * @param {string} hostname
 * @param {string[]} siteKeys - built-in adapter keys (Object.keys(siteConfig))
 * @returns {string|null} matched site key, or null off every known site
 */
export function matchSiteName(config, hostname, siteKeys) {
  if (!hostname || !Array.isArray(siteKeys)) return null
  if (config?.useSiteRegexOnly) {
    try {
      const matches = hostname.match(config.siteRegex)
      if (matches) return matches[0]
    } catch {
      // Invalid user regex syntax — no match
    }
    return null
  }
  if (config?.siteRegex) {
    try {
      const userMatches = hostname.match(config.siteRegex)
      if (userMatches) return userMatches[0]
    } catch {
      // Invalid user regex syntax — continue with built-in
    }
  }
  const escaped = siteKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) return null
  const builtInRegex = new RegExp(`(?:^|\\.)(${escaped.join('|')})(?:\\.|$)`)
  const builtInMatches = hostname.match(builtInRegex)
  if (builtInMatches) return builtInMatches[1]
  return null
}

/**
 * The engine a conversation started on `siteName` should use: the site's
 * explicit override when one is set, else the global default selection.
 * The returned shape matches how config itself carries a selection, so it
 * can be fed straight into initSession / model pickers.
 *
 * @param {{ modelName?: string, apiMode?: object|null, siteEngineOverrides?: Record<string, {modelName?: string, apiMode?: object|null}> }} config
 * @param {string|null} siteName
 * @returns {{ modelName?: string, apiMode?: object|null }}
 */
export function resolveEngineForSite(config, siteName) {
  const override = siteName ? config?.siteEngineOverrides?.[siteName] : null
  if (override && typeof override === 'object' && (override.modelName || override.apiMode)) {
    return { modelName: override.modelName, apiMode: override.apiMode ?? null }
  }
  return { modelName: config?.modelName, apiMode: config?.apiMode ?? null }
}
