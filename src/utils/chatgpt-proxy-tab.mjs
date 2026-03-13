export const CHATGPT_PROXY_QUERY_PARAM = 'chatgptbox_proxy'
export const CHATGPT_PROXY_QUERY_VALUE = '1'

export function isLikelyChatgptTabUrl(url) {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'chatgpt.com' || parsed.hostname.endsWith('.chatgpt.com')
  } catch {
    return false
  }
}

export function isDedicatedChatgptProxyTabUrl(url) {
  if (!isLikelyChatgptTabUrl(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/auth/login') return false
    return parsed.searchParams.get(CHATGPT_PROXY_QUERY_PARAM) === CHATGPT_PROXY_QUERY_VALUE
  } catch {
    return false
  }
}
