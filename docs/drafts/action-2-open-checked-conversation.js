/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
// Set to true when you want ChatGPT thinking/reasoning blocks included in the note.
const INCLUDE_THINKING = false

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

function getCheckedConversationId(content) {
  const matches = [
    ...content.matchAll(/^- \[x\].*<!-- chatgptbox-conversation:([A-Za-z0-9-]+) -->\s*$/gm),
  ]
  if (matches.length !== 1) {
    fail('Check exactly one conversation line before running this action')
  }
  return matches[0][1]
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

function renderReferences(references) {
  if (!Array.isArray(references) || references.length === 0) return ''
  var lines = references
    .map(function (ref) {
      var label = ref.alt || ref.title || ref.url || ''
      if (!label) return null
      if (ref.url) return '- [' + (ref.title || ref.alt || ref.url) + '](' + ref.url + ')'
      return '- ' + label
    })
    .filter(Boolean)
  if (lines.length === 0) return ''
  return '\n\n**References**\n\n' + lines.join('\n')
}

function renderMessages(messages) {
  return messages
    .filter((message) => normalizeText(message && message.text))
    .map((message) => {
      const role = message.role ? message.role.toUpperCase() : 'UNKNOWN'
      var body = '### ' + role + '\n\n' + normalizeText(message.text)
      if (role === 'ASSISTANT') body += renderReferences(message.references)
      return body
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

function renderWaitingReplyBlock(conversation) {
  const metadata = JSON.stringify({
    conversationId: conversation.conversationId,
    defaultModel: conversation.defaultModel || null,
  })

  return [
    '## Waiting Reply',
    '',
    '<!-- chatgptbox-waiting-reply:start ' + metadata + ' -->',
    '',
    '<!-- chatgptbox-waiting-reply:end -->',
  ].join('\n')
}

function renderConversation(conversation) {
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
    var answerBody = latestAnswer + renderReferences(conversation.message && conversation.message.references)
    lines.push(section('Latest Answer', answerBody).trimEnd())
  }

  lines.push(renderWaitingReplyBlock(conversation))
  return lines.join('\n\n').trim() + '\n'
}

try {
  const conversationId = getCheckedConversationId(draft.content || '')
  const payload = requestJson(
    BASE_URL +
      '/chatgpt/conversations/' +
      encodeURIComponent(conversationId) +
      '?think=' +
      String(INCLUDE_THINKING),
    'GET',
  )
  draft.content = renderConversation(payload)
  draft.update()
  app.displaySuccessMessage('Loaded conversation ' + conversationId)
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
