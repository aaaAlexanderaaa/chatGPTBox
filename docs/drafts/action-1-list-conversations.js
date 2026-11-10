/* global HTTP, app, draft */
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
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
const API_TOKEN = 'PASTE_GATEWAY_API_TOKEN_HERE'
// Uses the local cache. Run Full Sync explicitly when you want to refresh it;
// listing should not trigger a large burst of ChatGPT Web requests.
const LIST_URL = BASE_URL + '/chatgpt/conversations?offset=0&limit=100&order=updated'

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

function formatLine(item) {
  const title = item.title && item.title.trim() ? item.title.trim() : '(untitled)'
  const created = item.create_time || item.createTime || ''
  return (
    '- [ ] ' +
    title +
    ' | ' +
    created +
    controlText(' <!-- chatgptbox-conversation:') +
    item.id +
    ' -->'
  )
}

try {
  const payload = requestJson(LIST_URL, 'GET')
  const items = Array.isArray(payload.items) ? payload.items : []
  CONTROL.kind = 'list'
  draft.content = items.map(formatLine).join('\n')
  saveControlDocument()
  app.displaySuccessMessage('Loaded ' + items.length + ' conversations')
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
