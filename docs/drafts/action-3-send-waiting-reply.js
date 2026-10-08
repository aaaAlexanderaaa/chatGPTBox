/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
const API_TOKEN = 'PASTE_GATEWAY_API_TOKEN_HERE'
// Set a model slug here only when you want to force it for new conversations and replies.
// Leave it null to use the gateway's current default for new conversations and
// each conversation's model for replies.
const MODEL_OVERRIDE = null
// Set to true when you want ChatGPT thinking/reasoning blocks included in the note.
const INCLUDE_THINKING = false
const WAITING_REPLY_START_RE = /<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/
const WAITING_REPLY_END = '<!-- chatgptbox-waiting-reply:end -->'
const WAITING_REPLY_HEADING = '## Waiting Reply'
const NEW_OPERATION_RE = /\n?<!-- chatgptbox-new-operation:([^ ]+)(?: (\{.*\}))? -->\s*$/
const USER_HEADING_RE = /^### USER\s*$/gm
const PENDING_ANSWER_HEADING = '### ASSISTANT (pending)'
const PENDING_ANSWER_HEADING_RE = /^### ASSISTANT \(pending\)\s*$/gm
const PENDING_ANSWER_TEXT = '_Waiting for ChatGPT. Run the Get action to collect the answer._'

function fail(message) {
  app.displayErrorMessage(message)
  throw new Error(message)
}

function requestJson(url, method, body, idempotencyKey) {
  const http = HTTP.create()
  const request = {
    url,
    method,
    headers: {
      Authorization: 'Bearer ' + API_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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

  const conflict = payload.error
  if (response.statusCode === 409 && conflict && conflict.code === 'idempotency_key_conflict') {
    const receipt = conflict.operation_result
    if (
      conflict.operation_state === 'completed' &&
      receipt &&
      typeof receipt.conversationId === 'string' &&
      receipt.conversationId.trim() &&
      typeof receipt.messageId === 'string' &&
      receipt.messageId.trim() &&
      typeof receipt.query === 'string' &&
      receipt.query.trim()
    ) {
      // Recover the already accepted turn. The edited question is kept locally;
      // this action must not silently send it with a fresh operation ID.
      return { ...receipt, recoveredOperation: true }
    }
    fail(
      'The previous send has a different request and its result is not confirmed. ' +
        'Run Get and check the conversation before sending again. The saved send ID was kept.',
    )
  }

  if (conflict && conflict.dispatched === false && idempotencyKey) {
    clearDraftOperation(idempotencyKey)
  }

  if (!response.success) {
    fail(serverMessage)
  }
  if (response.statusCode >= 400) {
    fail(serverMessage || 'HTTP ' + response.statusCode)
  }

  return payload
}

function makeOperationId() {
  return (
    'drafts-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  )
}

function clearDraftOperation(operationId) {
  const content = draft.content || ''
  const match = content.match(NEW_OPERATION_RE)
  if (match && match[1] === operationId) {
    draft.content = content.replace(NEW_OPERATION_RE, '').trim() + '\n'
    draft.update()
    return
  }
  const waitingReply = findWaitingReply(content)
  if (!waitingReply || waitingReply.metadata.operationId !== operationId) return
  const metadata = { ...waitingReply.metadata }
  delete metadata.operationId
  delete metadata.operationRequest
  draft.content = content.replace(
    WAITING_REPLY_START_RE,
    '<!-- chatgptbox-waiting-reply:start ' + JSON.stringify(metadata) + ' -->',
  )
  draft.update()
}

function prepareNewConversationOperation(content, requestBody) {
  const match = content.match(NEW_OPERATION_RE)
  if (match) {
    let originalRequest
    try {
      originalRequest = match[2] ? JSON.parse(match[2]) : null
    } catch {
      fail('Saved send request is invalid JSON')
    }
    return {
      operationId: match[1],
      requestBody:
        originalRequest && originalRequest.query === requestBody.query
          ? originalRequest
          : requestBody,
    }
  }

  const operationId = makeOperationId()
  draft.content =
    content.trim() +
    '\n\n<!-- chatgptbox-new-operation:' +
    operationId +
    ' ' +
    JSON.stringify(requestBody) +
    ' -->\n'
  draft.update()
  return { operationId, requestBody }
}

function persistWaitingReplyOperation(content, waitingReply, requestBody) {
  if (waitingReply.metadata.operationId) return waitingReply.metadata.operationId
  const operationId = makeOperationId()
  const nextMetadata = { ...waitingReply.metadata, operationId, operationRequest: requestBody }
  draft.content = content.replace(
    WAITING_REPLY_START_RE,
    '<!-- chatgptbox-waiting-reply:start ' + JSON.stringify(nextMetadata) + ' -->',
  )
  draft.update()
  waitingReply.metadata = nextMetadata
  return operationId
}

function retainEditedQuestion(content, query) {
  if (!query) return content
  const match = content.match(WAITING_REPLY_START_RE)
  const start = match && content.indexOf(match[0]) + match[0].length
  const end = match && content.indexOf(WAITING_REPLY_END, start)
  if (!match || end < 0) fail('Waiting reply block is missing')
  return content.slice(0, start) + '\n' + query + '\n' + content.slice(end)
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

function lastMatchIndex(content, regex, beforeIndex) {
  let result = -1
  regex.lastIndex = 0
  let match
  while ((match = regex.exec(content)) !== null) {
    if (beforeIndex !== undefined && match.index >= beforeIndex) break
    result = match.index
  }
  return result
}

// Recovers the question that an earlier send appended to the note. The gateway
// acknowledges a send before ChatGPT has stored the turn, so for a while the
// snapshot has no trace of it and the note is the only copy.
function findLocalPendingQuery(content) {
  const pendingIndex = lastMatchIndex(content, PENDING_ANSWER_HEADING_RE)
  if (pendingIndex < 0) return ''
  const userIndex = lastMatchIndex(content, USER_HEADING_RE, pendingIndex)
  if (userIndex < 0) return ''
  const userHeadingEnd = content.indexOf('\n', userIndex)
  if (userHeadingEnd < 0 || userHeadingEnd > pendingIndex) return ''
  return content.slice(userHeadingEnd, pendingIndex).trim()
}

// The turn being awaited: its user message id from the metadata plus the
// question text from the note. Either one is enough to find it in a snapshot.
function readPendingAnchor(content, metadata) {
  const messageId =
    metadata && typeof metadata.pendingMessageId === 'string'
      ? metadata.pendingMessageId.trim()
      : ''
  const sentAt =
    metadata && typeof metadata.pendingSentAt === 'string' ? metadata.pendingSentAt.trim() : ''
  const query = findLocalPendingQuery(content)
  if (!messageId && !query) return null
  return { messageId, sentAt, query }
}

function section(title, body) {
  return body && body.trim() ? '## ' + title + '\n\n' + body.trim() + '\n' : ''
}

function normalizeText(text) {
  return typeof text === 'string' ? text.trim() : ''
}

function sameQuestion(left, right) {
  const collapse = (text) => normalizeText(text).replace(/\s+/g, ' ')
  const a = collapse(left)
  const b = collapse(right)
  return Boolean(a) && a === b
}

function isPendingMessageStatus(status) {
  const normalized = normalizeText(status).toLowerCase()
  return (
    normalized === 'in_progress' ||
    normalized === 'pending' ||
    normalized === 'streaming' ||
    normalized === 'queued'
  )
}

function findPendingTurnIndex(messages, anchor) {
  if (!anchor) return -1
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor]
    if (normalizeText(message && message.role).toLowerCase() !== 'user') continue
    if (anchor.messageId) {
      if (message.messageId === anchor.messageId) return cursor
      continue
    }
    if (sameQuestion(message.text, anchor.query)) return cursor
  }
  return -1
}

function hasFinishedAssistantAfter(messages, index) {
  return messages.slice(index + 1).some((message) => {
    if (normalizeText(message && message.role).toLowerCase() !== 'assistant') return false
    if (!normalizeText(message && message.text)) return false
    if (message.isFinal === false || message.endTurn === false) return false
    return !isPendingMessageStatus(message && message.status)
  })
}

// Where the awaited turn stands in this snapshot:
// - `missing`: the snapshot has no trace of the question yet
// - `awaiting`: the question is there, the answer is not finished
// - `answered`: this turn has a finished assistant reply
// - `none`: nothing is being awaited
// A stored pendingMessageId matches by id only. Question text is a fallback
// only after that id is gone, so a repeat of an earlier question cannot
// resolve to the old turn. `conversation.pending` can veto "answered" but
// never decides the match by itself.
function resolvePendingTurn(messages, anchor, conversation) {
  if (!anchor) return { state: 'none', index: -1 }
  const list = Array.isArray(messages) ? messages : []
  const index = findPendingTurnIndex(list, anchor)
  if (index < 0) return { state: 'missing', index }

  const result = conversation && conversation.message
  const stillGenerating =
    (conversation && conversation.pending === true) ||
    (result && result.pending === true) ||
    (result && isPendingMessageStatus(result.status))
  if (stillGenerating || !hasFinishedAssistantAfter(list, index)) {
    return { state: 'awaiting', index }
  }
  return { state: 'answered', index }
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
      // Prefer ChatGPT's own sentence (`Worked for 2 minutes`) when present.
      const timing =
        message.thoughtDurationLabel ||
        (message.thoughtDurationText ? 'Thought: ' + message.thoughtDurationText : '')
      const heading = timing ? '### ' + role + ' (' + timing + ')' : '### ' + role
      return heading + '\n\n' + normalizeText(message.text)
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

function buildWaitingReplyMetadata(conversationId, defaultModel, pending) {
  const metadata = {
    conversationId: conversationId,
    defaultModel: defaultModel || null,
  }
  // Remember which turn is still generating so a later Get can stay anchored to
  // it instead of guessing from the transcript.
  if (pending && pending.messageId) metadata.pendingMessageId = pending.messageId
  if (pending && pending.sentAt) metadata.pendingSentAt = pending.sentAt
  return metadata
}

// Keeps the turn that a send left behind visible until the answer actually
// arrives. A snapshot that does not contain the question yet must not erase it
// from the note, and a snapshot that contains it without an answer still gets
// the placeholder.
function renderTranscript(messages, conversation, anchor, pendingTurn) {
  const visible = messages.filter((message) => normalizeText(message && message.text))
  const blocks = [renderMessages(visible)]
  const placeholder = [PENDING_ANSWER_HEADING, '', PENDING_ANSWER_TEXT].join('\n')

  if (pendingTurn.state === 'missing') {
    if (anchor && anchor.query) blocks.push('### USER\n\n' + anchor.query)
    blocks.push(placeholder)
  } else if (pendingTurn.state === 'awaiting') {
    blocks.push(placeholder)
  } else if (pendingTurn.state === 'none' && conversation.pending === true) {
    const last = visible[visible.length - 1]
    if (last && normalizeText(last.role).toLowerCase() === 'user') blocks.push(placeholder)
  }

  return blocks.filter(Boolean).join('\n\n')
}

function renderWaitingReplyBlock(conversation, anchor, pendingTurn) {
  // The turn marker stays until the snapshot shows that turn answered. Whether
  // the conversation reports itself as pending is not the signal: right after a
  // send the snapshot can lack both the async status and the turn itself.
  const keepAnchor = anchor && pendingTurn.state !== 'answered'
  const metadata = buildWaitingReplyMetadata(
    conversation.conversationId,
    conversation.defaultModel,
    keepAnchor ? anchor : null,
  )

  return [
    WAITING_REPLY_HEADING,
    '',
    '<!-- chatgptbox-waiting-reply:start ' + JSON.stringify(metadata) + ' -->',
    '',
    WAITING_REPLY_END,
  ].join('\n')
}

// The follow-up send is asynchronous: the gateway acknowledges the message and
// ChatGPT keeps generating, so the response carries no transcript. Keep the note
// as it is, move the sent question into it, and leave a placeholder for the
// answer. Rebuilding the note from the acknowledgement would erase the thread.
function recordSentTurn(content, waitingReply, pending) {
  const startMatch = content.match(WAITING_REPLY_START_RE)
  if (!startMatch) fail('Waiting reply block went missing before the note could be updated')

  const blockStart = content.indexOf(startMatch[0])
  const blockEnd = content.indexOf(WAITING_REPLY_END, blockStart) + WAITING_REPLY_END.length
  const headingStart = content.lastIndexOf(WAITING_REPLY_HEADING, blockStart)
  const cutAt = headingStart >= 0 ? headingStart : blockStart

  const sentTurn = [
    '### USER',
    '',
    waitingReply.query,
    '',
    '### ASSISTANT (pending)',
    '',
    PENDING_ANSWER_TEXT,
  ].join('\n')

  const metadata = buildWaitingReplyMetadata(
    waitingReply.metadata.conversationId,
    waitingReply.metadata.defaultModel,
    pending,
  )

  return (
    [
      content.slice(0, cutAt).replace(/\s+$/, ''),
      sentTurn,
      [
        WAITING_REPLY_HEADING,
        '',
        '<!-- chatgptbox-waiting-reply:start ' + JSON.stringify(metadata) + ' -->',
        '',
        WAITING_REPLY_END,
      ].join('\n'),
      content.slice(blockEnd).replace(/^\s+/, ''),
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim() + '\n'
  )
}

function renderConversation(conversation, anchor) {
  const lines = []
  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const pendingTurn = resolvePendingTurn(messages, anchor, conversation)
  const transcript = renderTranscript(messages, conversation, anchor, pendingTurn)
  const lastUserText = getLastMessageText(messages, 'user')
  const lastAssistantText = getLastMessageText(messages, 'assistant')
  const latestQuery = normalizeText(conversation.query)
  const latestAnswer = normalizeText(conversation.message && conversation.message.text)
  const awaitingReply = pendingTurn.state === 'missing' || pendingTurn.state === 'awaiting'

  lines.push('# ' + (conversation.title || conversation.conversationId || 'Conversation'))
  lines.push('')
  lines.push('Conversation ID: ' + conversation.conversationId)
  lines.push(
    'Status: ' +
      (conversation.pending === true || awaitingReply ? 'pending' : 'complete') +
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
    lines.push(section('Latest Answer', latestAnswer).trimEnd())
  }

  lines.push(renderWaitingReplyBlock(conversation, anchor, pendingTurn))
  return lines.join('\n\n').trim() + '\n'
}

try {
  const noteContent = (draft.content || '').trim()
  const waitingReply = findWaitingReply(draft.content || '')

  if (!waitingReply) {
    if (!noteContent) {
      fail('Write the note content first')
    }

    const query = noteContent.replace(NEW_OPERATION_RE, '').trim()
    const operation = prepareNewConversationOperation(noteContent, {
      query,
      ...(MODEL_OVERRIDE ? { model: MODEL_OVERRIDE } : {}),
    })
    const payload = requestJson(
      BASE_URL + '/chatgpt/conversations',
      'POST',
      operation.requestBody,
      operation.operationId,
    )
    // The note becomes a one-turn transcript with a pending placeholder, the same
    // shape a follow-up send leaves behind, so Get treats both alike. The user
    // message id comes from the gateway; the Drafts idempotency key is not a
    // ChatGPT message id and must not be stored as one.
    const sentMessageId = typeof payload.messageId === 'string' ? payload.messageId : ''
    const sentAt = payload.createdAt || new Date().toISOString()
    const sentQuery = payload.recoveredOperation ? payload.query : operation.requestBody.query
    const editedQuery = payload.recoveredOperation && sentQuery !== query ? query : ''
    draft.content = renderConversation(
      {
        title: 'Pending Conversation',
        conversationId: payload.conversationId,
        pending: true,
        asyncStatus: null,
        updateTime: sentAt,
        defaultModel: payload.defaultModel || MODEL_OVERRIDE || null,
        messages: [{ role: 'user', messageId: sentMessageId || null, text: sentQuery }],
        thinking: [],
        message: null,
        query: '',
      },
      { messageId: sentMessageId, sentAt, query: sentQuery },
    )
    draft.content = retainEditedQuestion(draft.content, editedQuery)
    draft.update()
    app.displaySuccessMessage(
      (payload.recoveredOperation ? 'Recovered the previous send to ' : 'Created conversation ') +
        payload.conversationId +
        '. Run Get to collect the answer before sending any edited question.',
    )
  } else {
    const conversationId = waitingReply.metadata.conversationId
    if (!conversationId) {
      fail('Waiting reply metadata does not include a conversationId')
    }

    if (!waitingReply.query) {
      // Same anchoring as the Get action: the awaited turn's user message id
      // keeps the snapshot on that turn instead of the previous answer.
      const anchor = readPendingAnchor(draft.content || '', waitingReply.metadata)
      const refreshPayload = requestJson(
        BASE_URL + '/chatgpt/conversations/' + encodeURIComponent(conversationId) + '/refresh',
        'POST',
        {
          userMessageId: anchor && anchor.messageId ? anchor.messageId : undefined,
          preferResume: false,
          resumeTimeoutMs: 10_000,
          think: INCLUDE_THINKING,
        },
      )
      const refreshedConversation = refreshPayload.conversation || refreshPayload
      draft.content = renderConversation(refreshedConversation, anchor)
      draft.update()
      const stillWaiting =
        anchor &&
        resolvePendingTurn(refreshedConversation.messages || [], anchor, refreshedConversation)
          .state !== 'answered'
      app.displaySuccessMessage(
        'Refreshed conversation ' +
          conversationId +
          (stillWaiting ? '. Still waiting for the answer; run Get again later.' : ''),
      )
    } else {
      const currentRequest = {
        query: waitingReply.query,
        ...(MODEL_OVERRIDE ? { model: MODEL_OVERRIDE } : {}),
        think: INCLUDE_THINKING,
      }
      const operationId = persistWaitingReplyOperation(
        draft.content || '',
        waitingReply,
        currentRequest,
      )
      const savedRequest = waitingReply.metadata.operationRequest
      const requestBody =
        savedRequest && savedRequest.query === waitingReply.query ? savedRequest : currentRequest
      const payload = requestJson(
        BASE_URL + '/chatgpt/conversations/' + encodeURIComponent(conversationId) + '/messages',
        'POST',
        requestBody,
        operationId,
      )

      // The Drafts idempotency key is not a ChatGPT message id; without a real id
      // from the gateway, Get falls back to matching the question text.
      if (payload.conversationId && payload.conversationId !== conversationId)
        fail('The saved send belongs to another conversation. Run Get before sending again.')
      const sentQuery = payload.recoveredOperation ? payload.query : waitingReply.query
      const editedQuery =
        payload.recoveredOperation && sentQuery !== waitingReply.query ? waitingReply.query : ''
      draft.content = recordSentTurn(
        draft.content || '',
        { ...waitingReply, query: sentQuery },
        {
          messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
          sentAt: payload.createdAt || new Date().toISOString(),
        },
      )
      draft.content = retainEditedQuestion(draft.content, editedQuery)
      draft.update()
      app.displaySuccessMessage(
        (payload.recoveredOperation ? 'Recovered the previous send to ' : 'Sent to ') +
          conversationId +
          '. Run Get to collect the answer before sending any edited question.',
      )
    }
  }
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
