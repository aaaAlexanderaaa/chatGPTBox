/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'

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

function renderMessages(messages) {
  return messages
    .map((message) => {
      const role = message.role ? message.role.toUpperCase() : 'UNKNOWN'
      const text = message.text && message.text.trim() ? message.text.trim() : '(empty)'
      return '### ' + role + '\n\n' + text
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

  const transcript = renderMessages(
    Array.isArray(conversation.messages) ? conversation.messages : [],
  )
  if (transcript) lines.push(section('Transcript', transcript).trimEnd())

  if (conversation.query) {
    lines.push(section('Latest Query', conversation.query).trimEnd())
  }

  if (Array.isArray(conversation.thinking) && conversation.thinking.length) {
    lines.push(section('Thinking', renderThinking(conversation.thinking)).trimEnd())
  }

  const latestAnswer =
    conversation.message && conversation.message.text ? conversation.message.text.trim() : ''
  if (latestAnswer) {
    lines.push(section('Latest Answer', latestAnswer).trimEnd())
  }

  lines.push(renderWaitingReplyBlock(conversation))
  return lines.join('\n\n').trim() + '\n'
}

try {
  const conversationId = getCheckedConversationId(draft.content || '')
  const payload = requestJson(
    BASE_URL + '/chatgpt/conversations/' + encodeURIComponent(conversationId) + '?think=true',
    'GET',
  )
  draft.content = renderConversation(payload)
  draft.update()
  app.displaySuccessMessage('Loaded conversation ' + conversationId)
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
