import Browser from 'webextension-polyfill'
import { Models } from '../config/models.mjs'
import { GrokProxyControlAction, RuntimeMessage } from '../protocol/messages.mjs'
import { createGrokChatWriter } from '../services/clients/grok-web/chat.mjs'
import {
  getGrokConversation,
  listGrokConversations,
  normalizeGrokConversationList,
  normalizeGrokConversationSnapshot,
} from '../services/clients/grok-web/conversations.mjs'

export function isGrokProxyMessage(message) {
  return (
    message?.type === RuntimeMessage.GrokProxyRequest ||
    message?.type === RuntimeMessage.GrokProxyControlRequest
  )
}

function pageFetchWithCredentials(fetchImpl) {
  return (url, init = {}) => fetchImpl(url, { ...init, credentials: 'include' })
}

/**
 * In-page chat write for GROK_PROXY_REQUEST.
 * Tests inject `fetch` and optional `post`; production uses page fetch + port.
 */
export async function handleGrokProxyRequest({ session, fetch: fetchImpl, post } = {}) {
  const baseFetch = fetchImpl || globalThis.fetch
  const fetch = pageFetchWithCredentials(baseFetch)
  const modelSlug = Models[session?.modelName]?.value ?? 'grok-chat-fast'
  const writer = createGrokChatWriter({ fetch })

  const result = await writer.send({
    question: session?.question,
    modelSlug,
    conversationId: session?.conversationId,
    previousResponseID: session?.previousResponseID,
    onDelta: (answer) => {
      if (typeof post === 'function') {
        post({ answer, done: false, session: null })
      }
    },
  })

  if (session && typeof session === 'object') {
    if (result.conversationId) session.conversationId = result.conversationId
    if (result.previousResponseID) session.previousResponseID = result.previousResponseID
  }

  if (typeof post === 'function') {
    post({ answer: result.answer, done: true, session })
  }

  return result
}

async function handleGrokProxyControlRequest(action, payload = {}, fetchImpl) {
  const baseFetch = fetchImpl || globalThis.fetch
  const fetch = pageFetchWithCredentials(baseFetch)

  switch (action) {
    case GrokProxyControlAction.ListConversations: {
      const raw = await listGrokConversations({
        fetch,
        pageSize: payload?.pageSize ?? 20,
      })
      return normalizeGrokConversationList(raw)
    }
    case GrokProxyControlAction.GetConversation:
    case GrokProxyControlAction.RefreshConversation: {
      const conversationId = payload?.conversationId
      if (!conversationId) throw new Error('conversationId is required')
      const raw = await getGrokConversation({ fetch, conversationId })
      return normalizeGrokConversationSnapshot(raw, conversationId)
    }
    default:
      throw new Error(`Unsupported Grok proxy control action: ${action}`)
  }
}

/**
 * Content-script entry for Grok proxy messages.
 * Chat requests open a `grok-proxy-response:` port back to the service worker.
 */
export async function handleGrokProxyMessage(message, { fetch: fetchImpl, connect } = {}) {
  if (message?.type === RuntimeMessage.GrokProxyRequest) {
    const { session, requestId } = message.data || {}
    const connectFn =
      connect || ((name) => Browser.runtime.connect({ name }))
    const port = connectFn(`grok-proxy-response:${requestId}`)
    try {
      await handleGrokProxyRequest({
        session,
        fetch: fetchImpl,
        post: (m) => {
          try {
            port.postMessage(m)
          } catch {
            /* ignore */
          }
        },
      })
    } catch (err) {
      try {
        port.postMessage({ error: err?.message || String(err) })
      } catch {
        /* ignore */
      }
    } finally {
      try {
        port.disconnect()
      } catch {
        /* ignore */
      }
    }
    return { handled: true }
  }

  if (message?.type === RuntimeMessage.GrokProxyControlRequest) {
    const data = await handleGrokProxyControlRequest(
      message.data?.action,
      message.data?.payload,
      fetchImpl,
    )
    return { handled: true, data }
  }

  return { handled: false, action: GrokProxyControlAction.ListConversations }
}
