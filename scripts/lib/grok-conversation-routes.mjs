/**
 * Path matching for the Grok Web conversation bridge API.
 * Kept separate from ChatGPT `/chatgpt/conversations*` routing so ledger
 * keys and HTTP handlers cannot collide.
 */

/**
 * @param {string} pathname
 * @returns {{ kind: 'collection' } | { kind: 'item' | 'messages' | 'refresh', id: string } | null}
 */
export function matchGrokConversationRoute(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/grok/')) return null

  if (pathname === '/grok/conversations') return { kind: 'collection' }

  const itemMatch = pathname.match(/^\/grok\/conversations\/([^/]+)$/)
  if (itemMatch) return { kind: 'item', id: decodeURIComponent(itemMatch[1]) }

  const messagesMatch = pathname.match(/^\/grok\/conversations\/([^/]+)\/messages$/)
  if (messagesMatch) return { kind: 'messages', id: decodeURIComponent(messagesMatch[1]) }

  const refreshMatch = pathname.match(/^\/grok\/conversations\/([^/]+)\/refresh$/)
  if (refreshMatch) return { kind: 'refresh', id: decodeURIComponent(refreshMatch[1]) }

  return null
}

/**
 * Ledger route key for Grok conversation writes.
 * @param {'collection' | 'create' | 'messages'} kind
 * @param {string} [conversationId]
 */
export function grokWriteOperationPath(kind, conversationId) {
  if (kind === 'messages') {
    if (typeof conversationId === 'string' && conversationId) {
      return `/grok/conversations/${conversationId}/messages`
    }
    return '/grok/conversations/:id/messages'
  }
  return '/grok/conversations'
}
