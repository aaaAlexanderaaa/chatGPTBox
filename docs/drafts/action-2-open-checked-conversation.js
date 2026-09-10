/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
// Set to true when you want ChatGPT thinking/reasoning blocks included in the note.
const INCLUDE_THINKING = false
const WAITING_REPLY_START_RE = /<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/
const WAITING_REPLY_END = '<!-- chatgptbox-waiting-reply:end -->'

function fail(message) {
  app.displayErrorMessage(message)
  throw new Error(message)
}

function requestJson(url, method, body) {
  const http = HTTP.create()
  const request = {
    url,
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  }

  if (body) {
    request.data = body
    request.encoding = 'json'
  }

  const response = http.request(request)

  const payload = response.responseData || {}
  const serverMessage =
    (payload.error && payload.error.message) ||
    response.responseText ||
    response.error ||
    'HTTP request failed'

  if (!response.success) {
    fail(serverMessage)
  }
  if (response.statusCode >= 400) {
    fail(serverMessage || 'HTTP ' + response.statusCode)
  }

  return payload
}

function findWaitingReply(content) {
  const startMatch = content.match(WAITING_REPLY_START_RE)
  if (!startMatch) return null

  let metadata
  try {
    metadata = JSON.parse(startMatch[1])
  } catch (error) {
    fail('Waiting reply metadata is invalid JSON')
  }

  const startIndex = content.indexOf(startMatch[0]) + startMatch[0].length
  const endIndex = content.indexOf(WAITING_REPLY_END, startIndex)
  if (endIndex < 0) {
    fail('Waiting reply end marker is missing')
  }

  return {
    metadata,
    query: content.slice(startIndex, endIndex).trim(),
  }
}

function getCheckedConversationIds(content) {
  return [...content.matchAll(/^- \[x\].*<!-- chatgptbox-conversation:([A-Za-z0-9-]+) -->\s*$/gm)].map(
    (match) => match[1],
  )
}

function getOpenConversationId(content) {
  const waitingReply = findWaitingReply(content)
  const waitingId =
    waitingReply && typeof waitingReply.metadata.conversationId === 'string'
      ? waitingReply.metadata.conversationId.trim()
      : ''
  if (waitingId) {
    return {
      conversationId: waitingId,
      draftReply: waitingReply.query || '',
      metadata: waitingReply.metadata,
    }
  }

  const idMatch = content.match(/^Conversation ID:\s*([A-Za-z0-9-]+)\s*$/m)
  if (idMatch) return { conversationId: idMatch[1], draftReply: '', metadata: null }
  return null
}

function resolveConversationTarget(content) {
  const checkedIds = getCheckedConversationIds(content)
  if (checkedIds.length > 1) {
    fail('Check exactly one conversation line before running this action')
  }
  if (checkedIds.length === 1) {
    return { conversationId: checkedIds[0], draftReply: '', metadata: null, forceRefresh: false }
  }

  const open = getOpenConversationId(content)
  if (open) {
    return {
      conversationId: open.conversationId,
      draftReply: open.draftReply,
      metadata: open.metadata,
      forceRefresh: true,
    }
  }

  fail('Check one conversation from the list, or run Get on an already opened conversation')
}

function section(title, body) {
  return body && body.trim() ? '## ' + title + '\n\n' + body.trim() + '\n' : ''
}

function normalizeText(text) {
  return typeof text === 'string' ? text.trim() : ''
}

function getLastMessageText(messages, role) {
  const normalizedRole = normalizeText(role).toLowerCase()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (normalizeText(message && message.role).toLowerCase() !== normalizedRole) continue
    const text = normalizeText(message && message.text)
    if (text) return text
  }
  return ''
}

function renderMessages(messages) {
  return messages
    .filter((message) => normalizeText(message && message.text))
    .map((message) => {
      const role = message.role ? message.role.toUpperCase() : 'UNKNOWN'
      return '### ' + role + '\n\n' + normalizeText(message.text)
    })
    .join('\n\n')
}

function renderThinking(thinking) {
  return thinking
    .map((entry, index) => {
      const lines = []
      lines.push('### Step ' + (index + 1))
      lines.push('')
      lines.push('- type: ' + (entry.contentType || ''))
      lines.push('- status: ' + (entry.status || ''))
      if (entry.durationText) lines.push('- duration: ' + entry.durationText)
      else if (entry.finishedText) lines.push('- duration: ' + entry.finishedText)
      if (entry.reasoningTitle) lines.push('- title: ' + entry.reasoningTitle)
      if (entry.reasoningStatus) lines.push('- reasoning_status: ' + entry.reasoningStatus)
      if (entry.text && entry.text.trim()) {
        lines.push('')
        lines.push(entry.text.trim())
      }
      if (Array.isArray(entry.thoughts) && entry.thoughts.length) {
        entry.thoughts.forEach((thought, thoughtIndex) => {
          lines.push('')
          lines.push('- thought ' + (thoughtIndex + 1) + ': ' + (thought.summary || '(no summary)'))
          if (thought.content) lines.push(thought.content)
        })
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

function renderWaitingReplyBlock(conversation, draftReply, existingMetadata) {
  const metadata = {
    conversationId: conversation.conversationId,
    defaultModel: conversation.defaultModel || null,
  }
  const pendingReply = typeof draftReply === 'string' ? draftReply.trim() : ''
  const existingOperationId =
    existingMetadata && typeof existingMetadata.operationId === 'string'
      ? existingMetadata.operationId.trim()
      : ''
  if (pendingReply && existingOperationId) {
    metadata.operationId = existingOperationId
  }
  const body = pendingReply ? '\n' + pendingReply + '\n' : ''

  return [
    '## Waiting Reply',
    '',
    '<!-- chatgptbox-waiting-reply:start ' + JSON.stringify(metadata) + ' -->',
    body,
    '<!-- chatgptbox-waiting-reply:end -->',
  ].join('\n')
}

function renderConversation(conversation, draftReply, existingMetadata) {
  const lines = []
  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const transcript = renderMessages(messages)
  const lastUserText = getLastMessageText(messages, 'user')
  const lastAssistantText = getLastMessageText(messages, 'assistant')
  const latestQuery = normalizeText(conversation.query)
  const latestAnswer = normalizeText(conversation.message && conversation.message.text)

  lines.push('# ' + (conversation.title || conversation.conversationId || 'Conversation'))
  lines.push('')
  lines.push('Conversation ID: ' + conversation.conversationId)
  lines.push(
    'Status: ' +
      (conversation.pending ? 'pending' : 'complete') +
      (conversation.asyncStatus !== null && conversation.asyncStatus !== undefined
        ? ' (asyncStatus=' + conversation.asyncStatus + ')'
        : ''),
  )
  if (conversation.updateTime) lines.push('Updated: ' + conversation.updateTime)
  if (conversation.thoughtDurationText) {
    lines.push('Thought: ' + conversation.thoughtDurationText)
  }
  if (conversation.defaultModel) lines.push('Model: ' + conversation.defaultModel)
  lines.push('')

  if (transcript) lines.push(section('Transcript', transcript).trimEnd())

  if (latestQuery && latestQuery !== lastUserText) {
    lines.push(section('Latest Query', latestQuery).trimEnd())
  }

  if (Array.isArray(conversation.thinking) && conversation.thinking.length) {
    lines.push(section('Thinking', renderThinking(conversation.thinking)).trimEnd())
  }

  if (latestAnswer && latestAnswer !== lastAssistantText) {
    lines.push(section('Latest Answer', latestAnswer).trimEnd())
  }

  lines.push(renderWaitingReplyBlock(conversation, draftReply, existingMetadata))
  return lines.join('\n\n').trim() + '\n'
}

try {
  const target = resolveConversationTarget(draft.content || '')
  const query = [
    'think=' + String(INCLUDE_THINKING),
    target.forceRefresh ? 'force_refresh=true' : '',
  ]
    .filter(Boolean)
    .join('&')
  const payload = requestJson(
    BASE_URL +
      '/chatgpt/conversations/' +
      encodeURIComponent(target.conversationId) +
      '?' +
      query,
    'GET',
  )
  draft.content = renderConversation(payload, target.draftReply, target.metadata)
  draft.update()
  app.displaySuccessMessage(
    (target.forceRefresh ? 'Refreshed conversation ' : 'Loaded conversation ') +
      target.conversationId,
  )
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
