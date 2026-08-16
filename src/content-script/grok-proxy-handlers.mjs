import Browser from 'webextension-polyfill'
import { Models } from '../config/models.mjs'
import { pickDefaultGrokWebKey } from '../config/grok-web.mjs'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import { GrokProxyControlAction, RuntimeMessage } from '../protocol/messages.mjs'
import { createGrokChatWriter } from '../services/clients/grok-web/chat.mjs'
import {
  getGrokConversation,
  listGrokConversations,
  normalizeGrokConversationList,
  normalizeGrokConversationSnapshot,
} from '../services/clients/grok-web/conversations.mjs'
import {
  buildGrokProbeConfig,
  parseGrokAuthSession,
  parseGrokRateLimits,
} from '../services/clients/grok-web/session.mjs'
import { saveGrokWebSessionSnapshot } from '../services/clients/grok-web/thread-state.mjs'

const GROK_AUTH_SESSION_URL = 'https://grok.com/api/auth/session'
const GROK_RATE_LIMITS_URL = 'https://grok.com/rest/rate-limits'
const GROK_LOGIN_ERROR = 'Please login at https://grok.com first'

export function isGrokProxyMessage(message) {
  return (
    message?.type === RuntimeMessage.GrokProxyRequest ||
    message?.type === RuntimeMessage.GrokProxyControlRequest
  )
}

function pageFetchWithCredentials(fetchImpl) {
  return (url, init = {}) => fetchImpl(url, { ...init, credentials: 'include' })
}

function looksLikeGrokUnauthError(err) {
  const msg = err?.message || String(err)
  return /\b401\b/.test(msg) || /unauth/i.test(msg)
}

async function clearGrokSignedIn(setConfig) {
  await setConfig(buildGrokProbeConfig({ session: { signedIn: false }, tier: '' }))
}

/**
 * GET-confirm session (and optionally tier) before any chat POST.
 * Never POSTs. On failure clears signed-in and throws a login error.
 */
async function hardConfirmGrokSessionBeforeWrite({ fetch, setConfig }) {
  let sessionJson
  try {
    const response = await fetch(GROK_AUTH_SESSION_URL)
    if (!response.ok) throw new Error(`session ${response.status}`)
    sessionJson = await response.json()
  } catch {
    await clearGrokSignedIn(setConfig)
    throw new Error(GROK_LOGIN_ERROR)
  }

  const session = parseGrokAuthSession(sessionJson)
  if (!session.signedIn) {
    await clearGrokSignedIn(setConfig)
    throw new Error(GROK_LOGIN_ERROR)
  }

  let tier = 'basic'
  try {
    const rateResponse = await fetch(GROK_RATE_LIMITS_URL)
    if (rateResponse.ok) {
      tier = parseGrokRateLimits(await rateResponse.json())
    }
  } catch {
    /* keep basic; session is already confirmed */
  }

  await setConfig(buildGrokProbeConfig({ session, tier }))
}

function extractQuery(payload = {}) {
  return (
    (typeof payload.query === 'string' && payload.query.trim()) ||
    (typeof payload.message === 'string' && payload.message.trim()) ||
    (typeof payload.raw === 'string' && payload.raw.trim()) ||
    ''
  )
}

async function resolveGrokModelSlug(payload = {}) {
  if (typeof payload.model === 'string' && payload.model.trim()) {
    return payload.model.trim()
  }
  if (typeof payload.modelSlug === 'string' && payload.modelSlug.trim()) {
    return payload.modelSlug.trim()
  }
  const config = await getUserConfig()
  const key = pickDefaultGrokWebKey(config.grokWebAccountTier)
  return Models[key]?.value ?? 'grok-chat-fast'
}

/**
 * In-page chat write for GROK_PROXY_REQUEST.
 * Tests inject `fetch`, optional `post`, and optional `setUserConfig`.
 * Hard-confirms auth via GET before the single at-most-once POST.
 */
export async function handleGrokProxyRequest({
  session,
  fetch: fetchImpl,
  post,
  setUserConfig: setConfigImpl,
} = {}) {
  const baseFetch = fetchImpl || globalThis.fetch
  const fetch = pageFetchWithCredentials(baseFetch)
  const setConfig = setConfigImpl || setUserConfig

  await hardConfirmGrokSessionBeforeWrite({ fetch, setConfig })

  const modelSlug = Models[session?.modelName]?.value ?? 'grok-chat-fast'
  const writer = createGrokChatWriter({ fetch })

  let result
  try {
    result = await writer.send({
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
  } catch (err) {
    if (looksLikeGrokUnauthError(err)) {
      await clearGrokSignedIn(setConfig)
    }
    throw err
  }

  if (session && typeof session === 'object') {
    if (result.conversationId) session.conversationId = result.conversationId
    if (result.previousResponseID) session.previousResponseID = result.previousResponseID
  }

  if (typeof post === 'function') {
    post({ answer: result.answer, done: true, session })
  }

  // Persist extension-born continuation ids only (never on error / never grok.com import).
  if (session?.sessionId) {
    await saveGrokWebSessionSnapshot(session).catch(() => {})
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
    case GrokProxyControlAction.CreateConversation: {
      const query = extractQuery(payload)
      if (!query) throw new Error('query is required')
      const modelSlug = await resolveGrokModelSlug(payload)
      // At-most-once: a single createGrokChatWriter.send — never auto-replay.
      const writer = createGrokChatWriter({ fetch })
      const result = await writer.send({ question: query, modelSlug })
      return {
        conversationId: result.conversationId,
        previousResponseID: result.previousResponseID,
        answer: result.answer,
        query,
        defaultModel: modelSlug,
        pending: false,
      }
    }
    case GrokProxyControlAction.SendConversationMessage: {
      const conversationId = payload?.conversationId
      if (!conversationId) throw new Error('conversationId is required')
      const query = extractQuery(payload)
      if (!query) throw new Error('query is required')
      const modelSlug = await resolveGrokModelSlug(payload)
      // At-most-once: a single createGrokChatWriter.send — never auto-replay.
      const writer = createGrokChatWriter({ fetch })
      const result = await writer.send({
        question: query,
        modelSlug,
        conversationId,
        previousResponseID: payload?.previousResponseID,
      })
      return {
        conversationId: result.conversationId || conversationId,
        previousResponseID: result.previousResponseID,
        answer: result.answer,
        query,
        defaultModel: modelSlug,
        pending: false,
      }
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
