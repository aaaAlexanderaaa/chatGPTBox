const CHATGPT_WEB_SESSION_SNAPSHOTS_KEY = 'chatgptWebSessionSnapshots'
const CHATGPT_WEB_API_THREADS_KEY = 'chatgptWebApiThreads'
const MAX_CHATGPT_WEB_SESSION_SNAPSHOTS = 200
const MAX_CHATGPT_WEB_API_THREADS = 100

async function getBrowserStorage() {
  const { default: Browser } = await import('webextension-polyfill')
  return Browser.storage.local
}

function normalizeLineEndings(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
}

export function normalizeChatgptWebBridgeContent(content) {
  if (typeof content === 'string') return normalizeLineEndings(content)

  if (Array.isArray(content)) {
    return normalizeLineEndings(
      content
        .map((part) => {
          if (typeof part === 'string') return part
          if (!part || typeof part !== 'object') return String(part ?? '')
          if (typeof part.text === 'string') return part.text
          if (typeof part.content === 'string') return part.content
          if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string')
            return part.text
          try {
            return JSON.stringify(part)
          } catch {
            return '[unserializable]'
          }
        })
        .join('\n'),
    )
  }

  if (!content || typeof content !== 'object') return String(content ?? '')

  if (typeof content.text === 'string') return normalizeLineEndings(content.text)
  if (typeof content.content === 'string') return normalizeLineEndings(content.content)

  try {
    return normalizeLineEndings(JSON.stringify(content))
  } catch {
    return '[unserializable]'
  }
}

export function normalizeChatgptWebBridgeMessages(messages = []) {
  if (!Array.isArray(messages)) return []
  return messages
    .map((message) => {
      if (!message || typeof message !== 'object') return null
      const role = typeof message.role === 'string' ? message.role : 'user'
      const content = normalizeChatgptWebBridgeContent(message.content)
      return { role, content }
    })
    .filter(Boolean)
}

function isNormalizedMessagePrefix(prefix = [], full = []) {
  if (!Array.isArray(prefix) || !Array.isArray(full) || prefix.length > full.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (
      prefix[index]?.role !== full[index]?.role ||
      prefix[index]?.content !== full[index]?.content
    ) {
      return false
    }
  }
  return true
}

function sortByUpdatedAtDescending(entries = []) {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left?.updatedAt || '') || 0
    const rightTime = Date.parse(right?.updatedAt || '') || 0
    return rightTime - leftTime
  })
}

export function findChatgptWebApiThreadContinuation(threads = [], { model, messages } = {}) {
  const normalizedMessages = normalizeChatgptWebBridgeMessages(messages)
  if (normalizedMessages.length === 0) return null
  if (normalizedMessages[normalizedMessages.length - 1]?.role !== 'user') return null

  let bestMatch = null

  for (const thread of sortByUpdatedAtDescending(threads)) {
    if (!thread || typeof thread !== 'object') continue
    if (typeof thread.conversationId !== 'string' || !thread.conversationId) continue
    if (typeof thread.parentMessageId !== 'string' || !thread.parentMessageId) continue
    if (typeof thread.model === 'string' && typeof model === 'string' && thread.model !== model) {
      continue
    }

    const transcript = normalizeChatgptWebBridgeMessages(thread.transcript)
    if (transcript.length === 0 || transcript.length >= normalizedMessages.length) continue
    if (!isNormalizedMessagePrefix(transcript, normalizedMessages)) continue

    const suffix = normalizedMessages.slice(transcript.length)
    if (suffix.length !== 1 || suffix[0]?.role !== 'user') continue

    if (
      !bestMatch ||
      transcript.length > bestMatch.transcript.length ||
      (transcript.length === bestMatch.transcript.length &&
        (Date.parse(thread.updatedAt || '') || 0) >
          (Date.parse(bestMatch.updatedAt || '') || 0))
    ) {
      bestMatch = {
        ...thread,
        transcript,
        nextUserMessage: suffix[0],
      }
    }
  }

  return bestMatch
}

function trimEntriesByCount(entries, limit) {
  return sortByUpdatedAtDescending(entries).slice(0, limit)
}

export async function saveChatgptWebSessionSnapshot(session, { source = 'unknown' } = {}) {
  if (!session || typeof session !== 'object') return null
  if (typeof session.sessionId !== 'string' || !session.sessionId) return null
  if (!session.conversationId && !session.parentMessageId && !session.wsRequestId) return null

  const snapshot = {
    sessionId: session.sessionId,
    conversationId: session.conversationId || null,
    parentMessageId: session.parentMessageId || null,
    messageId: session.messageId || null,
    wsRequestId: session.wsRequestId || null,
    modelName: session.modelName || null,
    question: typeof session.question === 'string' ? session.question : null,
    updatedAt: new Date().toISOString(),
    source,
  }

  const storage = await getBrowserStorage()
  const data = await storage.get({ [CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]: {} })
  const snapshots =
    data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] &&
    typeof data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] === 'object'
      ? { ...data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] }
      : {}

  snapshots[session.sessionId] = snapshot

  const trimmedEntries = trimEntriesByCount(Object.values(snapshots), MAX_CHATGPT_WEB_SESSION_SNAPSHOTS)
  const trimmedSnapshots = Object.fromEntries(
    trimmedEntries
      .filter((entry) => typeof entry?.sessionId === 'string' && entry.sessionId)
      .map((entry) => [entry.sessionId, entry]),
  )

  await storage.set({
    [CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]: trimmedSnapshots,
  })

  return snapshot
}

export async function restoreChatgptWebSessionSnapshot(session) {
  if (!session || typeof session !== 'object') return session
  if (typeof session.sessionId !== 'string' || !session.sessionId) return session

  const storage = await getBrowserStorage()
  const data = await storage.get({ [CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]: {} })
  const snapshots =
    data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] &&
    typeof data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] === 'object'
      ? data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]
      : {}
  const snapshot = snapshots[session.sessionId]
  if (!snapshot || typeof snapshot !== 'object') return session

  const merged = { ...session }
  if (!merged.conversationId && snapshot.conversationId) merged.conversationId = snapshot.conversationId
  if (!merged.parentMessageId && snapshot.parentMessageId)
    merged.parentMessageId = snapshot.parentMessageId
  if (!merged.messageId && snapshot.messageId) merged.messageId = snapshot.messageId
  if (!merged.wsRequestId && snapshot.wsRequestId) merged.wsRequestId = snapshot.wsRequestId
  return merged
}

export async function deleteChatgptWebSessionSnapshot(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return false

  const storage = await getBrowserStorage()
  const data = await storage.get({ [CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]: {} })
  const snapshots =
    data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] &&
    typeof data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] === 'object'
      ? { ...data[CHATGPT_WEB_SESSION_SNAPSHOTS_KEY] }
      : {}

  if (!Object.prototype.hasOwnProperty.call(snapshots, sessionId)) return false

  delete snapshots[sessionId]
  await storage.set({
    [CHATGPT_WEB_SESSION_SNAPSHOTS_KEY]: snapshots,
  })
  return true
}

export async function saveChatgptWebApiThread({ model, messages, answer, session } = {}) {
  if (!session || typeof session !== 'object') return null
  if (typeof session.conversationId !== 'string' || !session.conversationId) return null
  if (typeof session.parentMessageId !== 'string' || !session.parentMessageId) return null

  const transcript = normalizeChatgptWebBridgeMessages(messages)
  if (transcript.length === 0) return null

  const normalizedAnswer = normalizeChatgptWebBridgeContent(answer)
  if (!normalizedAnswer) return null

  const fullTranscript = [...transcript, { role: 'assistant', content: normalizedAnswer }]
  const dedupeKey = JSON.stringify({ model: model || null, transcript: fullTranscript })

  const storage = await getBrowserStorage()
  const data = await storage.get({ [CHATGPT_WEB_API_THREADS_KEY]: [] })
  const currentThreads = Array.isArray(data[CHATGPT_WEB_API_THREADS_KEY])
    ? data[CHATGPT_WEB_API_THREADS_KEY]
    : []

  const nextThread = {
    model: typeof model === 'string' ? model : null,
    conversationId: session.conversationId,
    parentMessageId: session.parentMessageId,
    sessionId: typeof session.sessionId === 'string' ? session.sessionId : null,
    transcript: fullTranscript,
    updatedAt: new Date().toISOString(),
  }

  const filteredThreads = currentThreads.filter((thread) => {
    if (!thread || typeof thread !== 'object') return false
    const threadKey = JSON.stringify({
      model: typeof thread.model === 'string' ? thread.model : null,
      transcript: normalizeChatgptWebBridgeMessages(thread.transcript),
    })
    return threadKey !== dedupeKey
  })

  const nextThreads = trimEntriesByCount([nextThread, ...filteredThreads], MAX_CHATGPT_WEB_API_THREADS)

  await storage.set({
    [CHATGPT_WEB_API_THREADS_KEY]: nextThreads,
  })

  return nextThread
}

export async function findStoredChatgptWebApiThreadContinuation({ model, messages } = {}) {
  const storage = await getBrowserStorage()
  const data = await storage.get({ [CHATGPT_WEB_API_THREADS_KEY]: [] })
  const threads = Array.isArray(data[CHATGPT_WEB_API_THREADS_KEY])
    ? data[CHATGPT_WEB_API_THREADS_KEY]
    : []
  return findChatgptWebApiThreadContinuation(threads, { model, messages })
}
