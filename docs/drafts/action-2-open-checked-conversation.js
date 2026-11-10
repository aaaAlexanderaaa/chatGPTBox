/* global HTTP, app, draft, FileManager */
// BEGIN CONTROL DOCUMENT
/* eslint-disable no-unused-vars */
// Generated into every action. The header authenticates structure, not content secrecy.
// Model text and user questions never supply control metadata or pending anchors.
const CONTROL_HEADER_RE = /^<!-- chatgptbox-document:(\{[^\n]*\}) -->\n?/
const CONTROL_JSON_VALUES = new Set()
const CONTROL = openControlDocument(draft.content || '')
if (CONTROL.migrated) {
  delete CONTROL.migrated
  saveControlDocument()
}

function controlFailure() {
  const message =
    'This note has ambiguous or damaged ChatGPTBox controls. Automatic processing stopped. Keep the complete note and its send IDs; update all actions together and inspect the original conversation from a fresh List/Get note before trying again.'
  app.displayErrorMessage(message)
  throw new Error(message)
}
function controlJson(value) {
  const text = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  CONTROL_JSON_VALUES.add(text)
  return text
}
function controlText(value) {
  return value.replace(/chatgptbox-/g, 'chatgptbox-' + CONTROL.id + '-')
}
function controlRegex(value) {
  return new RegExp(
    value.source.replace(/chatgptbox-/g, 'chatgptbox-' + CONTROL.id + '-'),
    value.flags,
  )
}
function controlComments(content, id) {
  return content.match(new RegExp('<!-- chatgptbox-' + id + '-[^\\n]*? -->', 'g')) || []
}
function assertUniqueControls(comments, list) {
  const counts = {}
  let textOperations = 0,
    photoOperation = false,
    pendingMessage = false
  for (const comment of comments) {
    const match = comment.match(
      /^<!-- chatgptbox-(?:[a-z0-9]{16,80}-)?(waiting-reply:start|waiting-reply:end|photos:|photo-operation:|new-operation:|photo-status:start|photo-status:end|conversation:)(.*?) -->$/,
    )
    if (!match) controlFailure()
    const name = match[1],
      value = match[2]
    if (name === 'waiting-reply:end' || name.startsWith('photo-status:')) {
      if (value !== '') controlFailure()
    } else if (name === 'conversation:') {
      if (!/^[A-Za-z0-9-]+$/.test(value)) controlFailure()
    } else {
      let json = value
      if (name === 'new-operation:') {
        const operation = value.match(/^drafts-[a-z0-9]+-[a-z0-9]+(?: (\{.*\}))?$/)
        if (!operation) controlFailure()
        json = operation[1] || '{}'
      }
      let metadata
      try {
        metadata = JSON.parse(json)
      } catch {
        controlFailure()
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) controlFailure()
      if (name === 'new-operation:') textOperations += 1
      if (name === 'photo-operation:') photoOperation = true
      if (name === 'waiting-reply:start') {
        if (
          Object.prototype.hasOwnProperty.call(metadata, 'operationId') &&
          (typeof metadata.operationId !== 'string' || !metadata.operationId.trim())
        )
          controlFailure()
        if (metadata.operationId && metadata.pendingMessageId) controlFailure()
        if (metadata.operationId) textOperations += 1
        else if (metadata.pendingMessageId || metadata.pendingQuery || metadata.pendingSentAt)
          pendingMessage = true
      }
    }
    if (list && name === 'conversation:') continue
    counts[name] = (counts[name] || 0) + 1
    if (counts[name] > 1) controlFailure()
  }
  if (!!counts['waiting-reply:start'] !== !!counts['waiting-reply:end']) controlFailure()
  if (!!counts['photo-status:start'] !== !!counts['photo-status:end']) controlFailure()
  if (textOperations > 1 || (photoOperation && (textOperations || pendingMessage))) controlFailure()
}
function openControlDocument(content) {
  const match = content.match(CONTROL_HEADER_RE)
  if (match) {
    let value
    try {
      value = JSON.parse(match[1])
    } catch {
      controlFailure()
    }
    if (
      value.version !== 2 ||
      !/^[a-z0-9]{16,80}$/.test(value.id) ||
      !Array.isArray(value.controls)
    )
      controlFailure()
    const body = content.slice(match[0].length)
    const comments = controlComments(body, value.id)
    const openers = body.match(new RegExp('<!-- chatgptbox-' + value.id + '-', 'g')) || []
    if (openers.length !== comments.length) controlFailure()
    assertUniqueControls(comments, value.kind === 'list')
    if (controlJson(comments) !== controlJson(value.controls)) controlFailure()
    return value
  }
  if (/<!-- chatgptbox-document:|<!-- chatgptbox-[a-z0-9]{16,80}-/.test(content)) controlFailure()
  const legacy = content.match(/<!-- chatgptbox-[^\n]*? -->/g) || []
  if ((content.match(/<!-- chatgptbox-/g) || []).length !== legacy.length) controlFailure()
  const list =
    legacy.length > 0 &&
    legacy.every((item) => /^<!-- chatgptbox-conversation:[A-Za-z0-9-]+ -->$/.test(item)) &&
    content
      .trim()
      .split('\n')
      .every((line) => /^- \[[ x]\].*<!-- chatgptbox-conversation:[A-Za-z0-9-]+ -->\s*$/.test(line))
  assertUniqueControls(legacy, list)
  // A bare old operation/photo marker could be a quoted example. Only a
  // recognizable old conversation or task list can own legacy controls.
  if (legacy.length && !list && !legacy.some((item) => item.includes('waiting-reply:start')))
    controlFailure()
  let fence = null
  for (const line of content.split('\n')) {
    const edge = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (edge) {
      if (/<!-- chatgptbox-/.test(line)) controlFailure()
      if (!fence) fence = edge[1]
      else if (edge[1][0] === fence[0] && edge[1].length >= fence.length) fence = null
    } else if (fence && /<!-- chatgptbox-/.test(line)) controlFailure()
  }
  if (
    legacy.some((item) => item.includes('waiting-reply:start')) &&
    (!/^# [^\n]+\n+Conversation ID:\s*[A-Za-z0-9-]+\s*\n/.test(content) ||
      !/^## Waiting Reply[ \t]*\n+<!-- chatgptbox-waiting-reply:start /m.test(content) ||
      content.indexOf('<!-- chatgptbox-waiting-reply:start') < content.indexOf('## Waiting Reply'))
  )
    controlFailure()
  const headerId = content.match(/^Conversation ID:\s*([A-Za-z0-9-]+)\s*$/m)
  const waiting = content.match(/<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/)
  if (waiting) {
    let metadata
    try {
      metadata = JSON.parse(waiting[1])
    } catch {
      controlFailure()
    }
    if (headerId && metadata.conversationId !== headerId[1]) controlFailure()
  }
  if (legacy.length && !list) {
    const endMarker = '<!-- chatgptbox-waiting-reply:end -->'
    const end = content.indexOf(endMarker)
    for (const comment of legacy) {
      if (comment.includes('waiting-reply:')) continue
      if (
        content.indexOf(comment) < end ||
        !/^<!-- chatgptbox-(?:photos:|photo-operation:|photo-status:)/.test(comment)
      )
        controlFailure()
    }
    // In original conversation notes these generated blocks follow Waiting
    // Reply. Transcript examples and arbitrary trailing prose cannot own them.
    const tail = content
      .slice(end + endMarker.length)
      .replace(
        /<!-- chatgptbox-photo-status:start -->\nPhoto send: [^\n]*\n<!-- chatgptbox-photo-status:end -->/g,
        '',
      )
      .replace(/<!-- chatgptbox-(?:photos:|photo-operation:)\{[^\n]*\} -->/g, '')
    if (tail.trim()) controlFailure()
  }
  const id =
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  // Only unique legacy structural controls migrate. Preserve operation identity/payload.
  draft.content = content.replace(/<!-- chatgptbox-/g, '<!-- chatgptbox-' + id + '-')
  return {
    version: 2,
    id,
    kind: list ? 'list' : waiting || headerId ? 'conversation' : 'note',
    conversationId: headerId?.[1] || null,
    controls: controlComments(draft.content, id),
    migrated: legacy.length > 0,
  }
}
function plainNoteContent(content) {
  return content.replace(CONTROL_HEADER_RE, '')
}
function saveControlDocument() {
  const body = plainNoteContent(draft.content || '')
  const comments = controlComments(body, CONTROL.id)
  assertUniqueControls(comments, CONTROL.kind === 'list')
  for (const comment of comments) {
    const json = comment.match(/(\{.*\}) -->$/)?.[1]
    if (json && !CONTROL_JSON_VALUES.has(json) && !CONTROL.controls.includes(comment))
      controlFailure()
  }
  CONTROL.controls = comments
  if (comments.some((item) => item.includes('-waiting-reply:start '))) CONTROL.kind = 'conversation'
  draft.content = '<!-- chatgptbox-document:' + controlJson(CONTROL) + ' -->\n' + body
  draft.update()
}
function assertOperationAge(operationId) {
  const match =
    typeof operationId === 'string' && operationId.match(/^drafts-([a-z0-9]+)-[a-z0-9]+$/)
  const createdAt = match ? parseInt(match[1], 36) : NaN
  if (
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt >= 7 * 24 * 60 * 60 * 1000 ||
    createdAt > Date.now() + 60000
  )
    throw new Error(
      'This send is outside the known recovery window. Its ID was kept. Inspect the original conversation; do not resend with a new ID.',
    )
}
/* eslint-enable no-unused-vars */
// END CONTROL DOCUMENT
const MODEL_OVERRIDE = null
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
const API_TOKEN = 'PASTE_GATEWAY_API_TOKEN_HERE'
// Set to true when you want ChatGPT thinking/reasoning blocks included in the note.
const INCLUDE_THINKING = false
const WAITING_REPLY_START_RE = controlRegex(/<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/)
const WAITING_REPLY_END = controlText('<!-- chatgptbox-waiting-reply:end -->')
const PENDING_ANSWER_HEADING = '### ASSISTANT (pending)'
const PENDING_ANSWER_TEXT = '_Waiting for ChatGPT. Run the Get action to collect the answer._'

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
      Authorization: 'Bearer ' + API_TOKEN,
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
  if (CONTROL.kind !== 'list') return []
  return [
    ...content.matchAll(
      controlRegex(/^- \[x\].*<!-- chatgptbox-conversation:([A-Za-z0-9-]+) -->\s*$/gm),
    ),
  ].map((match) => match[1])
}

// The turn being awaited: its user message id from the metadata plus the
// question text retained for display. Only the message id proves identity.
function readPendingAnchor(content, metadata) {
  if (
    metadata?.operationId &&
    (!metadata.operationRequest ||
      typeof metadata.operationRequest.query !== 'string' ||
      !metadata.operationRequest.query.trim())
  )
    fail(
      'The saved send request is missing. The complete note and its ID were kept; inspect the original operation before refreshing.',
    )
  const messageId =
    metadata && typeof metadata.pendingMessageId === 'string'
      ? metadata.pendingMessageId.trim()
      : ''
  const sentAt =
    metadata && typeof metadata.pendingSentAt === 'string' ? metadata.pendingSentAt.trim() : ''
  const query = metadata?.pendingQuery || metadata?.operationRequest?.query || ''
  if (!messageId && !query && !sentAt) return null
  return { messageId, sentAt, query }
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
      anchor: readPendingAnchor(content, waitingReply.metadata),
    }
  }

  const idMatch = CONTROL.conversationId
    ? [null, CONTROL.conversationId]
    : plainNoteContent(content).match(
        /^(?:#[^\n]+\n\s*)?Conversation ID:\s*([A-Za-z0-9-]+)\s*(?:\n|$)/,
      )
  if (idMatch) {
    return {
      conversationId: idMatch[1],
      draftReply: '',
      metadata: null,
      anchor: readPendingAnchor(content, null),
    }
  }
  return null
}

function resolveConversationTarget(content) {
  const checkedIds = getCheckedConversationIds(content)
  if (checkedIds.length > 1) {
    fail('Check exactly one conversation line before running this action')
  }
  if (checkedIds.length === 1) {
    return {
      conversationId: checkedIds[0],
      draftReply: '',
      metadata: null,
      anchor: null,
      forceRefresh: false,
    }
  }

  const open = getOpenConversationId(content)
  if (open) {
    return {
      conversationId: open.conversationId,
      draftReply: open.draftReply,
      metadata: open.metadata,
      anchor: open.anchor,
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
  if (!anchor?.messageId) return -1
  return messages.findIndex(
    (message) =>
      normalizeText(message && message.role).toLowerCase() === 'user' &&
      message.messageId === anchor.messageId,
  )
}

function hasFinishedAssistantAfter(messages, index) {
  for (const message of messages.slice(index + 1)) {
    const role = normalizeText(message && message.role).toLowerCase()
    if (role === 'user') return false
    if (role !== 'assistant' || !normalizeText(message && message.text)) continue
    if (message.isFinal === false || message.endTurn === false) continue
    if (!isPendingMessageStatus(message && message.status)) return true
  }
  return false
}

// Where the awaited turn stands in this snapshot:
// - `missing`: the snapshot has no trace of the question yet
// - `awaiting`: the question is there, the answer is not finished
// - `answered`: this turn has a finished assistant reply
// - `none`: nothing is being awaited
// A stored pendingMessageId matches by id only. Without an id, question
// text cannot identify a send, so its pending anchor stays unresolved. `conversation.pending` can veto "answered" but
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

// Keeps the turn that the Send action left behind visible until the answer
// actually arrives. A snapshot that does not contain the question yet must not
// erase it from the note, and a snapshot that contains it without an answer
// still gets the placeholder.
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
      const photos = (message.attachments || [])
        .filter((item) => item.kind === 'image')
        .map(
          (item) =>
            '_Photo' +
            (item.width && item.height ? ' (' + item.width + ' × ' + item.height + ')' : '') +
            '_',
        )
        .join('\n')
      return heading + '\n\n' + normalizeText(message.text) + (photos ? '\n\n' + photos : '')
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

function renderWaitingReplyBlock(conversation, draftReply, existingMetadata, anchor, pendingTurn) {
  const metadata = {
    conversationId: conversation.conversationId,
    defaultModel: conversation.defaultModel || null,
  }
  const pendingReply = typeof draftReply === 'string' ? draftReply.trim() : ''
  const existingOperationId =
    existingMetadata && typeof existingMetadata.operationId === 'string'
      ? existingMetadata.operationId.trim()
      : ''
  if (existingOperationId) {
    metadata.operationId = existingOperationId
    if (existingMetadata.operationRequest)
      metadata.operationRequest = existingMetadata.operationRequest
  }
  // The turn marker stays until the snapshot shows that turn answered. Whether
  // the conversation reports itself as pending is not the signal: right after a
  // send the snapshot can lack both the async status and the turn itself, and
  // dropping the marker then would leave every later Get unanchored.
  if (anchor && pendingTurn.state !== 'answered') {
    if (anchor.messageId) metadata.pendingMessageId = anchor.messageId
    if (anchor.sentAt) metadata.pendingSentAt = anchor.sentAt
    if (anchor.query) metadata.pendingQuery = anchor.query
  }
  const body = pendingReply ? '\n' + pendingReply + '\n' : ''

  return [
    '## Waiting Reply',
    '',
    controlText('<!-- chatgptbox-waiting-reply:start ') + controlJson(metadata) + ' -->',
    body,
    controlText('<!-- chatgptbox-waiting-reply:end -->'),
  ].join('\n')
}

function renderConversation(conversation, draftReply, existingMetadata, anchor) {
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

  lines.push(
    renderWaitingReplyBlock(conversation, draftReply, existingMetadata, anchor, pendingTurn),
  )
  return lines.join('\n\n').trim() + '\n'
}

// BEGIN PHOTO HELPERS
/* eslint-disable no-unused-vars */
const PHOTO_METADATA_RE = controlRegex(/<!-- chatgptbox-photos:(\{.*\}) -->/)
const PHOTO_OPERATION_RE = controlRegex(/<!-- chatgptbox-photo-operation:(\{.*\}) -->/)
const PHOTO_STATUS_RE = controlRegex(
  /<!-- chatgptbox-photo-status:start -->[\s\S]*?<!-- chatgptbox-photo-status:end -->\n?/g,
)

function readPhotoMetadata(content) {
  const match = content.match(PHOTO_METADATA_RE)
  return match ? JSON.parse(match[1]) : { images: [], pendingPhotos: [], projectId: null }
}

function writePhotoMetadata(metadata) {
  const marker = controlText('<!-- chatgptbox-photos:') + controlJson(metadata) + ' -->'
  draft.content = PHOTO_METADATA_RE.test(draft.content || '')
    ? draft.content.replace(PHOTO_METADATA_RE, () => marker)
    : (draft.content || '').trimEnd() + '\n\n' + marker + '\n'
  saveControlDocument()
}

function readPhotoOperation(content) {
  const match = content.match(PHOTO_OPERATION_RE)
  return match ? JSON.parse(match[1]) : null
}

function photoPrompt(content, waitingReply) {
  return waitingReply
    ? waitingReply.query
    : content
        .replace(PHOTO_METADATA_RE, '')
        .replace(PHOTO_OPERATION_RE, '')
        .replace(PHOTO_STATUS_RE, '')
        .replace(CONTROL_HEADER_RE, '')
        .trim()
}

function stagePhotoFiles(metadata) {
  const pending = metadata.pendingPhotos || []
  // Drafts extends Date.parse and may return null for ISO timestamps with milliseconds.
  const expired = (metadata.images || []).filter((image) => {
    const expiresAt = new Date(image.expiresAt).getTime()
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now()
  })
  if (!pending.length && !expired.length) return metadata
  const fm = FileManager.createLocal()
  for (const photo of expired) {
    const image = fm.readJSON(photo.path)
    if (!image)
      fail('The photo expired and its local copy is unavailable. Attach it again before sending.')
    const info = requestJson(BASE_URL + '/chatgpt/attachments', 'POST', image)
    if (info.id !== photo.id) fail('The saved photo changed. Attach it again before sending.')
    metadata.images = metadata.images.map((item) =>
      item.id === photo.id ? { ...info, path: photo.path } : item,
    )
    writePhotoMetadata(metadata)
  }
  for (const photo of [...pending]) {
    const image = fm.readJSON(photo.path)
    if (!image)
      fail(
        'Photo file is unavailable on this device. Return to the device where it was attached, or attach the photo again.',
      )
    const info = requestJson(BASE_URL + '/chatgpt/attachments', 'POST', image)
    if (!info.id) fail('Gateway returned no photo ID')
    metadata.images = [...(metadata.images || []), { ...info, path: photo.path }]
    metadata.pendingPhotos = metadata.pendingPhotos.filter((item) => item.path !== photo.path)
    writePhotoMetadata(metadata)
  }
  return metadata
}

function photoStatus(status) {
  const names = {
    preparing: 'Preparing photos',
    uploading: 'Uploading photos to ChatGPT',
    sending: 'Sending message',
    accepted: 'Waiting for ChatGPT',
    failed: 'Photo send failed before submission; run Send to retry',
    interrupted: 'Preparation interrupted; run Send to continue',
    ambiguous:
      'Submission could not be confirmed; inspect the original conversation before sending again',
  }
  const label = names[status.phase] || 'Checking send status'
  const line =
    'Photo send: ' +
    label +
    (status.error ? ' (' + status.error.replace(/[\r\n]/g, ' ') + ')' : '') +
    '\n'
  draft.content =
    (draft.content || '').replace(PHOTO_STATUS_RE, '').trimEnd() +
    '\n\n' +
    controlText('<!-- chatgptbox-photo-status:start -->\n') +
    line +
    controlText('<!-- chatgptbox-photo-status:end -->\n')
  saveControlDocument()
  if (['failed', 'ambiguous'].includes(status.phase)) app.displayErrorMessage(label)
  else app.displaySuccessMessage(label)
}

function finishPhotoOperation(status, job) {
  const receipt = status.result
  if (!receipt || !receipt.conversationId || !receipt.messageId) return false
  const currentContent = draft.content || ''
  const currentReply = findWaitingReply(currentContent)
  const edited = photoPrompt(currentContent, currentReply)
  const metadata = readPhotoMetadata(currentContent)
  const unsent = edited && edited !== job.request.query ? edited : ''
  const images = metadata.images || []
  const summary = images
    .filter((image) => job.request.attachments.includes(image.id))
    .map((image) => '_Photo: ' + String(image.name || 'photo').replace(/[\r\n]/g, ' ') + '_')
    .join('\n')
  if (currentReply) {
    const match = currentContent.match(WAITING_REPLY_START_RE)
    const start = currentContent.indexOf(match[0]) + match[0].length
    const end = currentContent.indexOf(WAITING_REPLY_END, start)
    draft.content =
      currentContent.slice(0, start) + '\n' + job.request.query + '\n' + currentContent.slice(end)
  } else {
    draft.content =
      controlText('# Conversation\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start ') +
      controlJson({ conversationId: receipt.conversationId }) +
      ' -->\n' +
      job.request.query +
      controlText('\n<!-- chatgptbox-waiting-reply:end -->\n')
  }
  const match = draft.content.match(WAITING_REPLY_START_RE)
  const waitingMetadata = JSON.parse(match[1])
  delete waitingMetadata.operationId
  delete waitingMetadata.operationRequest
  waitingMetadata.conversationId = receipt.conversationId
  waitingMetadata.defaultModel = receipt.defaultModel || waitingMetadata.defaultModel || null
  waitingMetadata.pendingMessageId = receipt.messageId
  waitingMetadata.pendingQuery = job.request.query
  waitingMetadata.pendingSentAt = receipt.createdAt || new Date().toISOString()
  const afterStart = draft.content.indexOf(match[0]) + match[0].length
  const blockEnd = draft.content.indexOf(WAITING_REPLY_END, afterStart)
  const heading = draft.content.lastIndexOf('## Waiting Reply', draft.content.indexOf(match[0]))
  const prefix = draft.content
    .slice(0, heading >= 0 ? heading : draft.content.indexOf(match[0]))
    .trimEnd()
  draft.content =
    prefix +
    '\n\n### USER\n\n' +
    job.request.query +
    (summary ? '\n\n' + summary : '') +
    '\n\n### ASSISTANT (pending)\n\n' +
    PENDING_ANSWER_TEXT +
    controlText('\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start ') +
    controlJson(waitingMetadata) +
    ' -->\n' +
    unsent +
    controlText('\n<!-- chatgptbox-waiting-reply:end -->\n') +
    draft.content.slice(blockEnd + WAITING_REPLY_END.length)
  draft.content =
    draft.content
      .replace(PHOTO_OPERATION_RE, '')
      .replace(PHOTO_STATUS_RE, '')
      .replace(PHOTO_METADATA_RE, '')
      .trimEnd() + '\n'
  metadata.images = images.filter((image) => !job.request.attachments.includes(image.id))
  metadata.projectId = receipt.projectId || metadata.projectId || null
  writePhotoMetadata(metadata)
  return true
}

function sendPhotoOperation(content, waitingReply) {
  let job = readPhotoOperation(content)
  if (!job) {
    if (
      waitingReply &&
      (waitingReply.metadata.pendingMessageId ||
        waitingReply.metadata.pendingQuery ||
        waitingReply.metadata.pendingSentAt ||
        waitingReply.metadata.operationRequest?.query)
    )
      fail(
        'The previous turn is still pending. Your next question and photos were kept; run Get before sending them.',
      )
    const metadata = stagePhotoFiles(readPhotoMetadata(content))
    const query = photoPrompt(content, waitingReply) || '请分析这些图片，标明不确定的地方。'
    const conversationId = waitingReply && waitingReply.metadata.conversationId
    const id = 'drafts-photo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    job = {
      id,
      createdAt: new Date().toISOString(),
      path:
        '/chatgpt/conversations' +
        (conversationId ? '/' + encodeURIComponent(conversationId) + '/messages' : ''),
      request: {
        query,
        attachments: (metadata.images || []).map((image) => image.id),
        async: true,
        ...(metadata.projectId ? { project_id: metadata.projectId } : {}),
        ...(MODEL_OVERRIDE ? { model: MODEL_OVERRIDE } : {}),
      },
    }
    draft.content =
      (draft.content || '').trimEnd() +
      controlText('\n\n<!-- chatgptbox-photo-operation:') +
      controlJson(job) +
      ' -->\n'
    saveControlDocument()
  }
  stagePhotoFiles(readPhotoMetadata(draft.content || ''))
  const createdAt = typeof job.createdAt === 'string' ? new Date(job.createdAt).getTime() : NaN
  if (!Number.isFinite(createdAt))
    fail(
      'The saved send time is invalid. Run Get or inspect the original conversation; its send ID was kept.',
    )
  if (Date.now() - createdAt >= 7 * 24 * 60 * 60 * 1000)
    fail(
      'This send is older than the gateway recovery window. Inspect the original conversation; its send ID was kept.',
    )
  const status = requestJson(BASE_URL + job.path, 'POST', job.request, job.id)
  if (!finishPhotoOperation(status, job)) photoStatus(status)
}

function getPhotoOperation(content, includeThinking = false) {
  const job = readPhotoOperation(content)
  if (!job) return true
  const status = requestJson(BASE_URL + '/chatgpt/operations/' + encodeURIComponent(job.id), 'GET')
  if (status.phase === 'accepted') return finishPhotoOperation(status, job)
  // A lost acknowledgement does not erase a submitted turn. Only the gateway's
  // message ID can confirm this send; matching an older question by text cannot.
  const target =
    typeof job.path === 'string' &&
    job.path.match(/^\/chatgpt\/conversations\/([^/?#]+)\/messages$/)
  if (
    status.phase === 'ambiguous' &&
    target &&
    typeof status.operationId === 'string' &&
    status.operationId.trim()
  ) {
    const conversationId = decodeURIComponent(target[1])
    const messageId = status.operationId
    const conversation = requestJson(
      BASE_URL +
        '/chatgpt/conversations/' +
        encodeURIComponent(conversationId) +
        '?force_refresh=true&think=' +
        String(includeThinking) +
        '&user_message_id=' +
        encodeURIComponent(messageId),
      'GET',
    )
    const found =
      conversation.conversationId === conversationId &&
      Array.isArray(conversation.messages) &&
      conversation.messages.some(
        (message) => message.role === 'user' && message.messageId === messageId,
      )
    if (
      found &&
      finishPhotoOperation(
        {
          result: {
            conversationId,
            messageId,
            createdAt: job.createdAt,
            defaultModel: conversation.defaultModel,
            projectId: job.request.project_id,
          },
        },
        job,
      )
    )
      return { conversation }
  }
  photoStatus(status)
  return false
}
/* eslint-enable no-unused-vars */
// END PHOTO HELPERS

try {
  const photoRecovery = getPhotoOperation(draft.content || '', INCLUDE_THINKING)
  if (photoRecovery) {
    const photoMetadata = PHOTO_METADATA_RE.test(draft.content || '')
      ? readPhotoMetadata(draft.content)
      : null
    const target = resolveConversationTarget(draft.content || '')
    const pendingMessageId = target.anchor ? target.anchor.messageId : ''
    const query = [
      'think=' + String(INCLUDE_THINKING),
      target.forceRefresh ? 'force_refresh=true' : '',
      // Anchor the snapshot to the turn being awaited. Without it the snapshot
      // describes the previous answer for as long as this one is still generating.
      pendingMessageId ? 'user_message_id=' + encodeURIComponent(pendingMessageId) : '',
    ]
      .filter(Boolean)
      .join('&')
    const payload =
      photoRecovery.conversation ||
      requestJson(
        BASE_URL +
          '/chatgpt/conversations/' +
          encodeURIComponent(target.conversationId) +
          '?' +
          query,
        'GET',
      )
    if (
      target.anchor &&
      !target.anchor.query &&
      (!target.anchor.messageId ||
        !(payload.messages || []).some((message) => message.messageId === target.anchor.messageId))
    )
      fail(
        'The awaited message is not visible yet. The original note and send identity were kept; run Get again later.',
      )
    draft.content = renderConversation(payload, target.draftReply, target.metadata, target.anchor)
    if (photoMetadata) writePhotoMetadata(photoMetadata)
    saveControlDocument()
    const stillWaiting =
      target.anchor &&
      resolvePendingTurn(payload.messages || [], target.anchor, payload).state !== 'answered'
    app.displaySuccessMessage(
      (target.forceRefresh ? 'Refreshed conversation ' : 'Loaded conversation ') +
        target.conversationId +
        (stillWaiting ? '. Still waiting for the answer; run Get again later.' : ''),
    )
  }
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
