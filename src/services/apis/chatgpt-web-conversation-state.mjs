const PENDING_MESSAGE_STATUSES = new Set(['in_progress', 'pending', 'streaming', 'queued'])
const FINAL_MESSAGE_STATUSES = new Set([
  'finished_successfully',
  'finished',
  'completed',
  'complete',
])
const CHATGPT_WEB_CITATION_TOKEN_RE = /\uE200cite\uE202[^\uE201]*\uE201/g

function normalizeConversationTitle(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hasConversationAsyncStatusField(conversation) {
  if (!conversation || typeof conversation !== 'object') return false
  return (
    Object.prototype.hasOwnProperty.call(conversation, 'asyncStatus') ||
    Object.prototype.hasOwnProperty.call(conversation, 'async_status')
  )
}

function getMappingNode(mapping, nodeId) {
  if (!mapping || typeof mapping !== 'object' || !nodeId) return null
  const node = mapping[nodeId]
  return node && typeof node === 'object' ? node : null
}

function getMessageRole(node) {
  return node?.message?.author?.role || ''
}

function buildAncestorPath(mapping, startNodeId, maxDepth = 256) {
  const path = []
  const visited = new Set()
  let cursor = startNodeId

  while (cursor && !visited.has(cursor) && path.length < maxDepth) {
    visited.add(cursor)
    const node = getMappingNode(mapping, cursor)
    if (!node) break
    path.push(node)
    cursor = node.parent
  }

  return path
}

function collectAssistantDescendants(mapping, startNodeId, maxNodes = 256) {
  const queue = [startNodeId]
  const visited = new Set()
  const assistants = []

  while (queue.length > 0 && visited.size < maxNodes) {
    const nodeId = queue.shift()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = getMappingNode(mapping, nodeId)
    if (!node) continue

    if (getMessageRole(node) === 'assistant') assistants.push(node)

    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((childId) => {
      if (!visited.has(childId)) queue.push(childId)
    })
  }

  return assistants
}

function getNodeTimestamp(node) {
  const created = node?.message?.create_time
  return Number.isFinite(created) ? created : -Infinity
}

function flattenMessagePart(part) {
  if (typeof part === 'string') return part
  if (!part || typeof part !== 'object') return ''
  if (typeof part.text === 'string') return part.text
  if (typeof part.content === 'string') return part.content
  if (Array.isArray(part.parts)) {
    return part.parts.map((entry) => flattenMessagePart(entry)).join('')
  }
  if (Array.isArray(part.segments)) {
    return part.segments.map((entry) => flattenMessagePart(entry)).join('')
  }
  return ''
}

function cleanupChatgptWebReferenceArtifacts(text) {
  if (typeof text !== 'string' || !text) return ''
  return text.replace(CHATGPT_WEB_CITATION_TOKEN_RE, '')
}

function normalizeChatgptWebReferenceText(text, contentReferences = []) {
  let nextText = typeof text === 'string' ? text : ''
  if (!nextText) return ''

  const replacements = (Array.isArray(contentReferences) ? contentReferences : [])
    .map((reference) => {
      const matchedText =
        typeof reference?.matched_text === 'string' ? reference.matched_text : ''
      if (!matchedText || !matchedText.trim()) return null
      return {
        matchedText,
        replacement: typeof reference?.alt === 'string' ? reference.alt : '',
        start: Number.isInteger(reference?.start_idx) ? reference.start_idx : null,
        end: Number.isInteger(reference?.end_idx) ? reference.end_idx : null,
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftStart = Number.isInteger(left.start) ? left.start : -1
      const rightStart = Number.isInteger(right.start) ? right.start : -1
      return rightStart - leftStart
    })

  replacements.forEach(({ matchedText, replacement, start, end }) => {
    const canReplaceByRange =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= nextText.length &&
      nextText.slice(start, end) === matchedText

    if (canReplaceByRange) {
      nextText = `${nextText.slice(0, start)}${replacement}${nextText.slice(end)}`
      return
    }

    if (nextText.includes(matchedText)) {
      nextText = nextText.split(matchedText).join(replacement)
    }
  })

  return cleanupChatgptWebReferenceArtifacts(nextText)
}

function getNodeContentType(node) {
  return node?.message?.content?.content_type || ''
}

function getNodeText(node) {
  return extractChatgptWebMessageText(node?.message)
}

function isUserVisibleAssistantNode(node) {
  const message = node?.message
  if (!message || message.author?.role !== 'assistant') return false
  const contentType = getNodeContentType(node)
  if (contentType === 'thoughts') return false
  if (contentType === 'reasoning_recap') return false
  return true
}

function collectAssistantNodesOnCurrentPath(mapping, currentNodeId, userMessageId) {
  const path = buildAncestorPath(mapping, currentNodeId)
  if (path.length === 0) return []

  const assistants = []
  for (const node of path) {
    if (node.id === userMessageId) break
    if (getMessageRole(node) === 'assistant') assistants.push(node)
  }

  return assistants
}

function dedupeNodes(nodes = []) {
  const seen = new Set()
  return nodes.filter((node) => {
    const id = node?.id || node?.message?.id
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function scoreAssistantNode(node, { currentNodeId, assistantMessageId, pathNodeIds }) {
  const message = node?.message || {}
  const text = getNodeText(node)
  const status = typeof message.status === 'string' ? message.status : ''
  const contentType = getNodeContentType(node)
  const timestamp = getNodeTimestamp(node)
  let score = 0

  if (text) score += 10_000 + Math.min(text.length, 4000)
  if (node?.id === currentNodeId || message.id === currentNodeId) score += 2500
  if (assistantMessageId && (node?.id === assistantMessageId || message.id === assistantMessageId))
    score += 1500
  if (pathNodeIds.has(node?.id)) score += 500
  if (message.channel === 'final') score += 400
  if (message.channel === 'commentary') score += 200
  if (contentType === 'text') score += 300
  else if (contentType === 'multimodal_text') score += 250
  else if (contentType === 'code') score += 150
  if (message.end_turn === true) score += 120
  if (isFinalChatgptWebMessageStatus(status)) score += 100
  if (isPendingChatgptWebMessageStatus(status)) score += 50
  if (!isUserVisibleAssistantNode(node)) score -= 2_000
  if (Number.isFinite(timestamp)) score += Math.floor(timestamp)

  return score
}

export function flattenChatgptWebMessageText(content) {
  if (!content || typeof content !== 'object') return ''
  const parts = Array.isArray(content.parts) ? content.parts : []
  return parts.map((part) => flattenMessagePart(part)).join('')
}

export function extractChatgptWebMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  return normalizeChatgptWebReferenceText(
    flattenChatgptWebMessageText(message.content),
    message?.metadata?.content_references,
  )
}

export function isPendingChatgptWebConversation(
  conversation,
  { allowUntitledListItem = false } = {},
) {
  if (!conversation || typeof conversation !== 'object') return false
  if (conversation.asyncStatus !== undefined && conversation.asyncStatus !== null) return true
  if (conversation.async_status !== undefined && conversation.async_status !== null) return true
  if (allowUntitledListItem && normalizeConversationTitle(conversation.title) === 'new chat') {
    return true
  }
  return false
}

export function isPendingChatgptWebMessageStatus(status) {
  return PENDING_MESSAGE_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

export function isFinalChatgptWebMessageStatus(status) {
  return FINAL_MESSAGE_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

export function extractChatgptWebConversationResult(
  conversation,
  { userMessageId, assistantMessageId } = {},
) {
  const mapping = conversation?.mapping
  if (!mapping || typeof mapping !== 'object') return null

  const currentNodeId = conversation?.current_node || null
  const pathNodes = collectAssistantNodesOnCurrentPath(mapping, currentNodeId, userMessageId)
  const pathNodeIds = new Set(pathNodes.map((node) => node.id))
  const candidates = []

  if (assistantMessageId) {
    const assistantNode = getMappingNode(mapping, assistantMessageId)
    if (getMessageRole(assistantNode) === 'assistant') candidates.push(assistantNode)
  }

  if (currentNodeId) {
    const currentNode = getMappingNode(mapping, currentNodeId)
    if (getMessageRole(currentNode) === 'assistant') candidates.push(currentNode)
  }

  candidates.push(...pathNodes)
  if (userMessageId) candidates.push(...collectAssistantDescendants(mapping, userMessageId))

  const candidate = dedupeNodes(candidates).sort((left, right) => {
    const scoreDelta =
      scoreAssistantNode(right, { currentNodeId, assistantMessageId, pathNodeIds }) -
      scoreAssistantNode(left, { currentNodeId, assistantMessageId, pathNodeIds })
    if (scoreDelta !== 0) return scoreDelta
    return String(right?.id || '').localeCompare(String(left?.id || ''))
  })[0]

  if (!candidate || getMessageRole(candidate) !== 'assistant') return null

  const message = candidate.message || {}
  const text = extractChatgptWebMessageText(message)
  const status = typeof message.status === 'string' ? message.status : ''
  const pending = isPendingChatgptWebConversation(conversation)
  const hasAsyncStatusField = hasConversationAsyncStatusField(conversation)
  const isFinal =
    !pending &&
    Boolean(
      isFinalChatgptWebMessageStatus(status) ||
        message.end_turn ||
        (hasAsyncStatusField && text),
    )

  return {
    messageId: message.id || candidate.id || null,
    status,
    text,
    channel: message.channel || null,
    contentType: message.content?.content_type || '',
    asyncStatus:
      conversation?.asyncStatus !== undefined
        ? conversation.asyncStatus
        : conversation?.async_status,
    pending,
    isFinal,
  }
}

export function formatChatgptWebConversationListItem(item = {}) {
  return {
    id: item.id || null,
    title: item.title || '',
    createTime: item.create_time || null,
    updateTime: item.update_time || null,
    asyncStatus: item.async_status ?? null,
    pending: isPendingChatgptWebConversation(item, { allowUntitledListItem: true }),
    isArchived: item.is_archived === true,
    isStarred: item.is_starred === true,
    workspaceId: item.workspace_id || null,
    snippet: item.snippet || null,
    safeUrlCount: Array.isArray(item.safe_urls) ? item.safe_urls.length : 0,
    blockedUrlCount: Array.isArray(item.blocked_urls) ? item.blocked_urls.length : 0,
  }
}

export function extractChatgptWebConversationListItems(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.items)) return response.items
  if (Array.isArray(response?.conversations)) return response.conversations
  return []
}

export function formatChatgptWebConversationSnapshot(
  conversation = {},
  { userMessageId, assistantMessageId } = {},
) {
  const result = extractChatgptWebConversationResult(conversation, {
    userMessageId,
    assistantMessageId,
  })

  return {
    conversationId: conversation.conversation_id || null,
    title: conversation.title || '',
    createTime: conversation.create_time || null,
    updateTime: conversation.update_time || null,
    currentNode: conversation.current_node || null,
    asyncStatus:
      conversation.asyncStatus !== undefined ? conversation.asyncStatus : conversation.async_status,
    pending: isPendingChatgptWebConversation(conversation),
    defaultModel: conversation.default_model_slug || null,
    safeUrlCount: Array.isArray(conversation.safe_urls) ? conversation.safe_urls.length : 0,
    blockedUrlCount: Array.isArray(conversation.blocked_urls)
      ? conversation.blocked_urls.length
      : 0,
    message: result,
  }
}

export function selectChatgptWebRefreshResult(conversation, resume = null) {
  const conversationText =
    typeof conversation?.message?.text === 'string' ? conversation.message.text : ''
  const resumeText = typeof resume?.message?.text === 'string' ? resume.message.text : ''
  const shouldPreferResumeText =
    Boolean(resumeText) &&
    (conversation?.pending === true ||
      !conversationText ||
      resume?.message?.isFinal === true ||
      (resume?.message?.id &&
        conversation?.message?.messageId &&
        resume.message.id !== conversation.message.messageId))

  return {
    text: shouldPreferResumeText ? resumeText : conversationText || resumeText || '',
    pending:
      shouldPreferResumeText && typeof resume?.pending === 'boolean'
        ? resume.pending
        : conversation?.pending === true,
  }
}
