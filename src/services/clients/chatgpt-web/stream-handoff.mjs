export function isChatgptWebStreamHandoff(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (payload.type !== 'stream_handoff' || !Array.isArray(payload.options)) return false
  return payload.options.every(
    (option) => option && typeof option === 'object' && typeof option.type === 'string',
  )
}

export function pickChatgptWebResumeSseOption(handoff) {
  if (!isChatgptWebStreamHandoff(handoff)) return null

  const match = handoff.options.find((option) => option.type === 'resume_sse_endpoint')
  const topicId = typeof match?.topic_id === 'string' ? match.topic_id.trim() : ''
  return match && topicId ? { type: match.type, topicId } : null
}

export function canResumeChatgptWebStreamHandoffViaSse(handoff) {
  return pickChatgptWebResumeSseOption(handoff) != null
}

export function extractChatgptWebResumeConversationToken(payload) {
  if (!payload || typeof payload !== 'object' || payload.type !== 'resume_conversation_token') {
    return null
  }

  const token = typeof payload.token === 'string' ? payload.token.trim() : ''
  const conversationId =
    typeof payload.conversation_id === 'string' ? payload.conversation_id.trim() : ''
  if (!token && !conversationId) return null

  return {
    token,
    conversationId,
    kind: typeof payload.kind === 'string' ? payload.kind : null,
  }
}

export function isChatgptWebStreamHandoffEndpoint(apiPath) {
  return typeof apiPath === 'string' && /\/f\/conversation\/?$/.test(apiPath)
}

export function shouldUseChatgptWebLegacyWebsocketDispatch({
  useWebsocket,
  isExtendedThinkingRequest,
  apiPath,
} = {}) {
  return Boolean(
    useWebsocket &&
      isExtendedThinkingRequest &&
      !isChatgptWebStreamHandoffEndpoint(apiPath),
  )
}

export function shouldPollChatgptWebConversationAfterStream({
  hasConversationId,
  handoff,
  resumeCompleted,
  modelNeedsPolling,
} = {}) {
  if (!hasConversationId) return false
  if (handoff) return resumeCompleted !== true
  return modelNeedsPolling === true
}
