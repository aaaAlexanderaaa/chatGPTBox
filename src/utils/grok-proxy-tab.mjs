export const GROK_PROXY_QUERY_PARAM = 'chatgptbox_proxy'
export const GROK_PROXY_QUERY_VALUE = '1'

export function isGrokProxyPageHost(hostname) {
  return hostname === 'grok.com' || (typeof hostname === 'string' && hostname.endsWith('.grok.com'))
}

export function isLikelyGrokTabUrl(url) {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url)
    return isGrokProxyPageHost(parsed.hostname)
  } catch {
    return false
  }
}

export function isDedicatedGrokProxyTabUrl(url) {
  if (!isLikelyGrokTabUrl(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/login' || parsed.pathname === '/sign-in') return false
    return parsed.searchParams.get(GROK_PROXY_QUERY_PARAM) === GROK_PROXY_QUERY_VALUE
  } catch {
    return false
  }
}
