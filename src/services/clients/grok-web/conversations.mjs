const LIST_URL = 'https://grok.com/rest/app-chat/conversations'

function senderToRole(sender) {
  return sender === 'human' ? 'user' : 'assistant'
}

export function normalizeGrokConversationList(payload) {
  const conversations = Array.isArray(payload?.conversations) ? payload.conversations : []
  const items = conversations.map((entry) => ({
    conversationId: typeof entry?.conversationId === 'string' ? entry.conversationId : '',
    title: typeof entry?.title === 'string' ? entry.title : '',
  }))
  return { items, total: items.length }
}

export function normalizeGrokConversationSnapshot(payload, conversationId) {
  const responseNodes = Array.isArray(payload?.responseNodes) ? payload.responseNodes : []
  const messages = responseNodes.map((node) => ({
    role: senderToRole(node?.sender),
    content: typeof node?.message === 'string' ? node.message : '',
  }))

  const title =
    typeof payload?.title === 'string'
      ? payload.title
      : typeof payload?.conversation?.title === 'string'
      ? payload.conversation.title
      : ''

  const defaultModel =
    typeof payload?.modelName === 'string'
      ? payload.modelName
      : typeof payload?.defaultModel === 'string'
      ? payload.defaultModel
      : ''

  let previousResponseID = ''
  for (const node of responseNodes) {
    if (node?.sender !== 'human') continue
    if (typeof node?.responseId === 'string' && node.responseId) {
      previousResponseID = node.responseId
    }
  }

  return {
    conversationId,
    title,
    messages,
    defaultModel,
    previousResponseID,
    pending: false,
  }
}

async function parseGrokJsonResponse(response) {
  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(`Grok Web request failed (${response.status}): ${bodyText}`)
  }
  return response.json()
}

export async function listGrokConversations({ fetch, pageSize }) {
  const url = `${LIST_URL}?pageSize=${encodeURIComponent(pageSize)}`
  const response = await fetch(url, { method: 'GET' })
  return parseGrokJsonResponse(response)
}

export async function getGrokConversation({ fetch, conversationId }) {
  const url = `https://grok.com/rest/app-chat/conversations/${encodeURIComponent(
    conversationId,
  )}/response-node?includeThreads=true`
  const response = await fetch(url, { method: 'GET' })
  return parseGrokJsonResponse(response)
}
