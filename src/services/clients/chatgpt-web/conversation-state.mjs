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

function getNodeMessage(node) {
  return node?.message && typeof node.message === 'object' ? node.message : null
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

function buildRootPath(mapping, startNodeId, maxDepth = 256) {
  return buildAncestorPath(mapping, startNodeId, maxDepth).reverse()
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

function collectReferenceUrls(reference) {
  const items = Array.isArray(reference?.items) ? reference.items : []
  const primary = items[0]
  if (!primary) return []

  const urls = []
  const primaryUrl = typeof primary.url === 'string' ? primary.url.trim() : ''
  const primaryTitle = typeof primary.title === 'string' ? primary.title.trim() : ''
  const primaryAttr = typeof primary.attribution === 'string' ? primary.attribution.trim() : ''
  if (primaryUrl)
    urls.push({ url: primaryUrl, title: primaryTitle || primaryUrl, attribution: primaryAttr })

  const sw = Array.isArray(primary.supporting_websites) ? primary.supporting_websites : []
  for (const site of sw) {
    if (!site) continue
    const sUrl = typeof site.url === 'string' ? site.url.trim() : ''
    const sTitle = typeof site.title === 'string' ? site.title.trim() : ''
    const sAttr = typeof site.attribution === 'string' ? site.attribution.trim() : ''
    if (sUrl) urls.push({ url: sUrl, title: sTitle || sUrl, attribution: sAttr })
  }
  return urls
}

function normalizeChatgptWebReferenceText(text, contentReferences = []) {
  let nextText = typeof text === 'string' ? text : ''
  if (!nextText) return ''

  const refs = Array.isArray(contentReferences) ? contentReferences.filter(Boolean) : []
  if (!refs.length) return cleanupChatgptWebReferenceArtifacts(nextText)

  // Build global deduplicated reference index (url -> sequential number)
  const urlToIndex = new Map()
  const indexedRefs = [] // [{url, title, attribution}] — 1-based via position+1

  function getOrAddRef(url, title, attribution) {
    const key = url.replace(/\?utm_source=chatgpt\.com$/, '')
    if (urlToIndex.has(key)) return urlToIndex.get(key)
    const idx = indexedRefs.length + 1
    urlToIndex.set(key, idx)
    indexedRefs.push({ url: key, title, attribution: attribution || '' })
    return idx
  }

  // First pass: register all URLs so numbering is stable (sorted by start_idx)
  const sortedRefs = refs
    .filter((r) => r?.type === 'grouped_webpages' || r?.type === 'nav_list')
    .sort((a, b) => (a.start_idx ?? Infinity) - (b.start_idx ?? Infinity))

  for (const ref of sortedRefs) {
    if (ref.type === 'grouped_webpages') {
      for (const u of collectReferenceUrls(ref)) getOrAddRef(u.url, u.title, u.attribution)
    } else if (ref.type === 'nav_list') {
      const items = Array.isArray(ref.items) ? ref.items : []
      for (const item of items) {
        if (!item) continue
        const url = typeof item.url === 'string' ? item.url.trim() : ''
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const attr = typeof item.attribution === 'string' ? item.attribution.trim() : ''
        if (url) getOrAddRef(url, title, attr)
      }
    }
  }

  // Build replacements
  const replacements = []
  for (const ref of refs) {
    const matchedText = typeof ref.matched_text === 'string' ? ref.matched_text : ''
    if (!matchedText || !matchedText.trim()) continue

    let replacement = ''
    if (ref.type === 'grouped_webpages') {
      const urls = collectReferenceUrls(ref)
      if (urls.length) {
        const indices = urls.map((u) => getOrAddRef(u.url, u.title))
        const unique = [...new Set(indices)]
        replacement = unique
          .map((i) => {
            const r = indexedRefs[i - 1]
            const label = r.attribution || r.title
            return `[${label}][${i}]`
          })
          .join(' ')
      } else {
        replacement = typeof ref.alt === 'string' ? ref.alt : ''
      }
    } else if (ref.type === 'nav_list') {
      const items = Array.isArray(ref.items) ? ref.items : []
      const links = items
        .filter((item) => item && typeof item.url === 'string')
        .map((item) => {
          const url = item.url.trim()
          const title = typeof item.title === 'string' ? item.title.trim() : url
          return `- [${title}](${url})`
        })
      replacement = links.length ? '\n' + links.join('\n') + '\n' : ''
    } else if (ref.type === 'sources_footnote') {
      replacement = ''
    } else {
      replacement = typeof ref.alt === 'string' ? ref.alt : ''
    }

    replacements.push({
      matchedText,
      replacement,
      start: Number.isInteger(ref.start_idx) ? ref.start_idx : null,
      end: Number.isInteger(ref.end_idx) ? ref.end_idx : null,
    })
  }

  // Sort by start descending so index-based replacements don't shift
  replacements.sort((left, right) => {
    const leftStart = Number.isInteger(left.start) ? left.start : -1
    const rightStart = Number.isInteger(right.start) ? right.start : -1
    return rightStart - leftStart
  })

  for (const { matchedText, replacement, start, end } of replacements) {
    const canReplaceByRange =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= nextText.length &&
      nextText.slice(start, end) === matchedText

    if (canReplaceByRange) {
      nextText = `${nextText.slice(0, start)}${replacement}${nextText.slice(end)}`
      continue
    }

    if (nextText.includes(matchedText)) {
      nextText = nextText.split(matchedText).join(replacement)
    }
  }

  nextText = cleanupChatgptWebReferenceArtifacts(nextText)

  // Append reference-style link definitions
  if (indexedRefs.length > 0) {
    const defs = indexedRefs.map((r, i) => {
      const escaped = r.title.replace(/"/g, '\\"')
      return `[${i + 1}]: <${r.url}> "${escaped}"`
    })
    nextText = nextText.trimEnd() + '\n\n' + defs.join('\n')
  }

  return nextText
}

function getNodeContentType(node) {
  return node?.message?.content?.content_type || ''
}

function getNodeText(node) {
  return extractChatgptWebMessageText(node?.message)
}

function findClosestAncestorNode(mapping, startNodeId, predicate) {
  const path = buildAncestorPath(mapping, startNodeId)
  return path.find((node) => predicate(node)) || null
}

function extractChatgptWebThoughts(message) {
  const thoughts = Array.isArray(message?.content?.thoughts) ? message.content.thoughts : []
  return thoughts
    .map((thought, index) => {
      if (!thought || typeof thought !== 'object') return null
      const summary = typeof thought.summary === 'string' ? thought.summary : ''
      const content = typeof thought.content === 'string' ? thought.content : ''
      if (!summary && !content) return null
      return {
        index,
        summary,
        content,
        finished: thought.finished === true,
      }
    })
    .filter(Boolean)
}

function shouldExposeThinkingNode(node) {
  const message = getNodeMessage(node)
  if (!message || message.author?.role !== 'assistant') return false
  const contentType = getNodeContentType(node)
  if (contentType === 'thoughts' || contentType === 'reasoning_recap') return true
  if (extractChatgptWebThoughts(message).length > 0) return true
  return Boolean(
    message?.metadata?.reasoning_status ||
      message?.metadata?.reasoning_title ||
      message?.metadata?.reasoning_start_time,
  )
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

function selectChatgptWebConversationAssistantCandidate(
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

  return candidate || null
}

function formatConversationMessageNode(node) {
  const message = getNodeMessage(node)
  if (!message) return null

  return {
    messageId: message.id || node?.id || null,
    role: message.author?.role || '',
    status: typeof message.status === 'string' ? message.status : '',
    channel: message.channel || null,
    contentType: message.content?.content_type || '',
    createTime: message.create_time || null,
    updateTime: message.update_time || null,
    text: extractChatgptWebMessageText(message),
  }
}

function scoreConversationTurnAssistantNode(node, order) {
  const message = getNodeMessage(node)
  if (!message || message.author?.role !== 'assistant') return -Infinity

  const text = getNodeText(node)
  const status = typeof message.status === 'string' ? message.status : ''
  const contentType = getNodeContentType(node)
  const timestamp = getNodeTimestamp(node)
  let score = order

  if (text) score += 10_000 + Math.min(text.length, 4000)
  else score -= 5_000
  if (message.channel === 'final') score += 2_000
  if (message.channel === 'commentary') score += 200
  if (contentType === 'text') score += 1_000
  else if (contentType === 'multimodal_text') score += 900
  else if (contentType === 'code') score += 800
  if (message.end_turn === true) score += 600
  if (isFinalChatgptWebMessageStatus(status)) score += 400
  if (isPendingChatgptWebMessageStatus(status)) score += 200
  if (!isUserVisibleAssistantNode(node)) score -= 2_000
  if (Number.isFinite(timestamp)) score += Math.floor(timestamp)

  return score
}

function pickBestConversationTurnAssistant(nodes = []) {
  return (
    nodes
      .filter(Boolean)
      .sort((left, right) => {
        const leftOrder = nodes.indexOf(left)
        const rightOrder = nodes.indexOf(right)
        const scoreDelta =
          scoreConversationTurnAssistantNode(right, rightOrder) -
          scoreConversationTurnAssistantNode(left, leftOrder)
        if (scoreDelta !== 0) return scoreDelta
        return String(right?.id || '').localeCompare(String(left?.id || ''))
      })[0] || null
  )
}

function isVisibleConversationMessageNode(node) {
  const message = getNodeMessage(node)
  if (!message) return false
  if (message?.metadata?.is_visually_hidden_from_conversation === true) return false

  const role = message.author?.role || ''
  if (role === 'user') return true
  if (role !== 'assistant') return false

  const contentType = message.content?.content_type || ''
  return contentType !== 'thoughts' && contentType !== 'reasoning_recap'
}

function formatThinkingNode(node) {
  const message = getNodeMessage(node)
  if (!message) return null

  const thoughts = extractChatgptWebThoughts(message)
  const text = extractChatgptWebMessageText(message)
  const reasoningTitle =
    typeof message?.metadata?.reasoning_title === 'string' ? message.metadata.reasoning_title : ''
  const reasoningStatus =
    typeof message?.metadata?.reasoning_status === 'string' ? message.metadata.reasoning_status : ''

  return {
    messageId: message.id || node?.id || null,
    status: typeof message.status === 'string' ? message.status : '',
    channel: message.channel || null,
    contentType: message.content?.content_type || '',
    createTime: message.create_time || null,
    updateTime: message.update_time || null,
    text,
    reasoningTitle,
    reasoningStatus,
    thoughtCount: thoughts.length,
    thoughts,
  }
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
  const candidate = selectChatgptWebConversationAssistantCandidate(conversation, {
    userMessageId,
    assistantMessageId,
  })
  if (!candidate || getMessageRole(candidate) !== 'assistant') return null

  const message = candidate.message || {}
  const text = extractChatgptWebMessageText(message)
  const status = typeof message.status === 'string' ? message.status : ''
  const pending = isPendingChatgptWebConversation(conversation)
  const hasAsyncStatusField = hasConversationAsyncStatusField(conversation)
  const isFinal =
    !pending &&
    Boolean(
      isFinalChatgptWebMessageStatus(status) || message.end_turn || (hasAsyncStatusField && text),
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

export function extractChatgptWebConversationQuery(
  conversation,
  { userMessageId, assistantMessageId } = {},
) {
  const mapping = conversation?.mapping
  if (!mapping || typeof mapping !== 'object') return null

  const candidate = selectChatgptWebConversationAssistantCandidate(conversation, {
    userMessageId,
    assistantMessageId,
  })
  const fallbackNodeId = candidate?.id || conversation?.current_node || null
  const userNode =
    (userMessageId && getMappingNode(mapping, userMessageId)) ||
    findClosestAncestorNode(mapping, fallbackNodeId, (node) => getMessageRole(node) === 'user')
  const message = getNodeMessage(userNode)
  if (!message || message.author?.role !== 'user') return null

  return {
    messageId: message.id || userNode.id || null,
    text: extractChatgptWebMessageText(message),
    createTime: message.create_time || null,
    updateTime: message.update_time || null,
  }
}

export function extractChatgptWebConversationMessages(conversation = {}) {
  const mapping = conversation?.mapping
  if (!mapping || typeof mapping !== 'object') return []

  const rootPath = buildRootPath(mapping, conversation?.current_node || null)
  const messages = []
  let activeUserNode = null
  let assistantNodes = []

  function flushTurn() {
    if (!activeUserNode) return

    const userMessage = formatConversationMessageNode(activeUserNode)
    if (userMessage?.text) messages.push(userMessage)

    const assistantNode = pickBestConversationTurnAssistant(assistantNodes)
    const assistantMessage = formatConversationMessageNode(assistantNode)
    if (assistantMessage?.text) messages.push(assistantMessage)

    activeUserNode = null
    assistantNodes = []
  }

  rootPath.forEach((node) => {
    const role = getMessageRole(node)
    if (role === 'user') {
      flushTurn()
      activeUserNode = node
      return
    }

    if (role !== 'assistant' || !activeUserNode) return
    if (!isVisibleConversationMessageNode(node)) return
    assistantNodes.push(node)
  })

  flushTurn()
  return messages
}

export function extractChatgptWebConversationThinking(
  conversation,
  { userMessageId, assistantMessageId } = {},
) {
  const mapping = conversation?.mapping
  if (!mapping || typeof mapping !== 'object') return []

  const candidate = selectChatgptWebConversationAssistantCandidate(conversation, {
    userMessageId,
    assistantMessageId,
  })
  if (!candidate) return []

  const userNode = findClosestAncestorNode(
    mapping,
    candidate.id,
    (node) => getMessageRole(node) === 'user',
  )
  const path = buildAncestorPath(mapping, candidate.id)
  const thinkingNodes = []

  for (const node of path) {
    if (node.id === userNode?.id) break
    if (node.id === candidate.id) continue
    if (!shouldExposeThinkingNode(node)) continue
    thinkingNodes.push(node)
  }

  return thinkingNodes
    .reverse()
    .map((node) => formatThinkingNode(node))
    .filter(Boolean)
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
  { userMessageId, assistantMessageId, think = false } = {},
) {
  const result = extractChatgptWebConversationResult(conversation, {
    userMessageId,
    assistantMessageId,
  })
  const query = extractChatgptWebConversationQuery(conversation, {
    userMessageId,
    assistantMessageId,
  })
  const messages = extractChatgptWebConversationMessages(conversation)
  const thinking = think
    ? extractChatgptWebConversationThinking(conversation, {
        userMessageId,
        assistantMessageId,
      })
    : undefined

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
    query: query?.text || '',
    queryMessage: query,
    messages,
    thinking,
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
