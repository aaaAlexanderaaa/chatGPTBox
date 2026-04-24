/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
// Explicit default for new conversations created by this script.
const DEFAULT_MODEL = 'gpt-5-4-thinking'
// Set this to a model slug like 'gpt-5-4-pro' to force all sends to use that model.
// Leave it as null to keep using each conversation's stored default model when available.
const MODEL_OVERRIDE = null
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

function normalizeText(text) {
  return typeof text === 'string' ? text.trim() : ''
}

function resolveModel(defaultModel) {
  return MODEL_OVERRIDE || defaultModel || DEFAULT_MODEL
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
  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const transcript = renderMessages(messages)
  const lastUserText = getLastMessageText(messages, 'user')
  const lastAssistantText = getLastMessageText(messages, 'assistant')
  const normalizedSentQuery = normalizeText(sentQuery)
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

  if (normalizedSentQuery && normalizedSentQuery !== lastUserText) {
    lines.push(section('Sent Query', normalizedSentQuery).trimEnd())
  }

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
      model: resolveModel(),
    })
    draft.content = renderConversation(
      {
        title: 'Pending Conversation',
        conversationId: payload.conversationId,
        pending: true,
        asyncStatus: null,
        updateTime: payload.createdAt || null,
        defaultModel: payload.defaultModel || resolveModel(),
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
          think: INCLUDE_THINKING,
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
          model: resolveModel(waitingReply.metadata.defaultModel),
          think: INCLUDE_THINKING,
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
