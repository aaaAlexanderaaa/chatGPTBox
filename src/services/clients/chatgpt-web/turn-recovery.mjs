import { getChatgptWebTurnStatus, recordChatgptWebTurnStatus } from './turn-status.mjs'

// The live stream owns normal completion. A separate, bounded conversation GET
// repairs a lost completion event without replaying the original prompt.
export function createChatgptWebTurnRecovery({
  readConversation,
  onCompleted,
  getStatus = getChatgptWebTurnStatus,
  recordStatus = recordChatgptWebTurnStatus,
  intervalMs = 60_000,
  timeoutMs = 15_000,
  now = Date.now,
}) {
  const checks = new Map()
  return async ({ conversationId, messageId } = {}) => {
    if (!conversationId || !messageId) return null
    const ids = { conversationId, messageId }
    const record = await getStatus(ids)

    const key = `${conversationId}:${messageId}`
    const previous = checks.get(key)
    if (previous && now() - previous.startedAt < intervalMs) return previous.promise
    for (const [oldKey, check] of checks) {
      if (now() - check.startedAt >= intervalMs) checks.delete(oldKey)
    }

    let timer
    const promise = (async () => {
      try {
        const conversation = await Promise.race([
          readConversation({
            conversationId,
            userMessageId: messageId,
            forceRefresh: true,
            latestOnly: true,
            requestTimeoutMs: Math.max(1000, timeoutMs - 5000),
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error('Timed out checking the existing ChatGPT turn')
              error.code = 'CHATGPT_WEB_TURN_RECOVERY_TIMEOUT'
              reject(error)
            }, timeoutMs)
          }),
        ])
        // Forced reads may fall back to an older cache on a network error.
        // Neither that cache nor a different turn proves this request finished.
        if (
          conversation?.conversationId !== conversationId ||
          conversation.queryMessage?.messageId !== messageId ||
          conversation.cache?.source !== 'network' ||
          conversation.cache?.stale === true ||
          conversation.pending !== false ||
          conversation.message?.pending !== false ||
          conversation.message?.isFinal !== true ||
          !conversation.message.text?.trim()
        ) {
          return (await getStatus(ids)) || record
        }
        const completed = recordStatus({
          ...record,
          ...ids,
          status: 'completed',
          verifiedComplete: true,
          text: conversation.message.text,
          query: conversation.query,
          thoughtDurationSec: conversation.thoughtDurationSec,
        })
        if (completed?.status === 'completed') {
          void Promise.resolve()
            .then(() => onCompleted?.(ids))
            .catch(() => {})
        }
        return completed
      } finally {
        clearTimeout(timer)
      }
    })()
    checks.set(key, { startedAt: now(), promise })
    return promise
  }
}
