/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
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
  if (!startMatch) {
    return null
  }

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

function renderConversation(conversation, sentQuery) {
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

  if (sentQuery) {
    lines.push(section('Sent Query', sentQuery).trimEnd())
  }

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
  const noteContent = (draft.content || '').trim()
  const waitingReply = findWaitingReply(draft.content || '')

  if (!waitingReply) {
    if (!noteContent) {
      fail('Write the note content first')
    }

    const payload = requestJson(BASE_URL + '/chatgpt/conversations', 'POST', {
      query: noteContent,
    })
    draft.content = renderConversation(
      {
        title: 'Pending Conversation',
        conversationId: payload.conversationId,
        pending: true,
        asyncStatus: null,
        updateTime: payload.createdAt || null,
        defaultModel: payload.defaultModel || null,
        messages: [],
        thinking: [],
        message: null,
        query: '',
      },
      noteContent,
    )
    draft.update()
    app.displaySuccessMessage('Created conversation ' + payload.conversationId)
  } else {
    const conversationId = waitingReply.metadata.conversationId
    if (!conversationId) {
      fail('Waiting reply metadata does not include a conversationId')
    }

    if (!waitingReply.query) {
      const refreshPayload = requestJson(
        BASE_URL + '/chatgpt/conversations/' + encodeURIComponent(conversationId) + '/refresh',
        'POST',
        {
          preferResume: true,
          resumeTimeoutMs: 10_000,
          think: true,
        },
      )
      const refreshedConversation = refreshPayload.conversation || refreshPayload
      draft.content = renderConversation(refreshedConversation)
      draft.update()
      app.displaySuccessMessage('Refreshed conversation ' + conversationId)
    } else {
      const payload = requestJson(
        BASE_URL + '/chatgpt/conversations/' + encodeURIComponent(conversationId) + '/messages',
        'POST',
        {
          query: waitingReply.query,
          model: waitingReply.metadata.defaultModel || undefined,
          think: true,
        },
      )

      const conversation = payload.conversation || payload
      draft.content = renderConversation(conversation, waitingReply.query)
      draft.update()
      app.displaySuccessMessage('Sent reply to ' + conversationId)
    }
  }
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
