// `new URL(...).hostname` keeps the brackets on an IPv6 literal, so both spellings
// are listed.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * The `api-bridge-proxy` port opens a WebSocket with extension privileges, so —
 * like the FETCH proxy — the only target it will dial is the local gateway's
 * bridge endpoint. Anything else, including a non-loopback host or a different
 * path on the gateway, is refused.
 *
 * @param {unknown} rawUrl
 * @returns {boolean}
 */
export function isApiBridgeUrlAllowed(rawUrl) {
  if (typeof rawUrl !== 'string') return false
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'ws:') return false
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return false
  return url.pathname === '/bridge'
}
