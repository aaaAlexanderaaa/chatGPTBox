/* global HTTP, app, draft, FileManager, HTMLPreview, context */
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
const BASE_URL = 'http://127.0.0.1:18080'
const API_TOKEN = 'PASTE_GATEWAY_API_TOKEN_HERE'
const MODEL_OVERRIDE = null
const WAITING_REPLY_START_RE = controlRegex(/<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/)
const WAITING_REPLY_END = controlText('<!-- chatgptbox-waiting-reply:end -->')
const PENDING_ANSWER_TEXT = '_Waiting for ChatGPT. Run the Get action to collect the answer._'
// BEGIN PHOTO PICKER
const PHOTO_PICKER_HTML =
  "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />\n    <meta\n      http-equiv=\"Content-Security-Policy\"\n      content=\"default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'\"\n    />\n    <title>添加餐食照片</title>\n    <style>\n      html {\n        color-scheme: light dark;\n        font: 17px system-ui;\n      }\n      body {\n        max-width: 640px;\n        margin: auto;\n        padding: 24px;\n      }\n      h1 {\n        font-size: 24px;\n      }\n      p {\n        line-height: 1.6;\n      }\n      input,\n      button {\n        font: inherit;\n      }\n      button {\n        padding: 12px 18px;\n        margin: 8px 6px 0 0;\n        border-radius: 10px;\n        border: 1px solid #888;\n      }\n      #photos {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 12px;\n        margin: 20px 0;\n      }\n      img {\n        width: 140px;\n        height: 140px;\n        object-fit: cover;\n        border-radius: 12px;\n      }\n      #error {\n        color: #c33;\n      }\n      button:disabled {\n        opacity: 0.4;\n      }\n    </style>\n  </head>\n  <body>\n    <h1>添加餐食照片</h1>\n    <p>选择最多 4 张照片。照片会缩小后保存到本机，发送分析请运行 Send。</p>\n    <input id=\"files\" type=\"file\" accept=\"image/*\" multiple />\n    <div id=\"photos\"></div>\n    <p id=\"error\" role=\"alert\"></p>\n    <button id=\"add\" disabled>添加照片</button><button id=\"cancel\">取消</button>\n    <script>\n      let images = []\n      let selection = 0\n      document.getElementById('files').addEventListener('change', async (event) => {\n        const add = document.getElementById('add'),\n          error = document.getElementById('error'),\n          photos = document.getElementById('photos')\n        add.disabled = true\n        error.textContent = ''\n        photos.replaceChildren()\n        images = []\n        const current = ++selection,\n          captured = []\n        const files = Array.from(event.target.files || [])\n        if (files.length > 4) {\n          error.textContent = '最多选择 4 张照片。'\n          return\n        }\n        try {\n          for (const file of files) {\n            if (file.size > 32 * 1024 * 1024) throw new Error('照片过大，请先缩小后再选择。')\n            const url = URL.createObjectURL(file),\n              img = new Image()\n            try {\n              await new Promise((resolve, reject) => {\n                img.onload = resolve\n                img.onerror = () => reject(new Error('无法读取照片，请使用 JPEG、PNG 或 WebP。'))\n                img.src = url\n              })\n              if (current !== selection) return\n              const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))\n              const canvas = document.createElement('canvas')\n              canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))\n              canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))\n              const ctx = canvas.getContext('2d')\n              ctx.fillStyle = '#fff'\n              ctx.fillRect(0, 0, canvas.width, canvas.height)\n              ctx.drawImage(img, 0, 0, canvas.width, canvas.height)\n              const dataUrl = canvas.toDataURL('image/jpeg', 0.85)\n              if (dataUrl.length > 11184812) throw new Error('照片压缩后仍超过 8 MiB。')\n              captured.push({ name: file.name.replace(/\\.[^.]+$/, '') + '.jpg', data_url: dataUrl })\n              const thumbnail = document.createElement('img')\n              thumbnail.src = dataUrl\n              thumbnail.alt = file.name\n              photos.appendChild(thumbnail)\n            } finally {\n              URL.revokeObjectURL(url)\n            }\n          }\n          if (current === selection) {\n            images = captured\n            add.disabled = !images.length\n          }\n        } catch (err) {\n          if (current === selection) {\n            error.textContent = err.message\n            images = []\n          }\n        }\n      })\n      document.getElementById('add').addEventListener('click', () => {\n        if (!images.length) return\n        Drafts.send('chatgptboxPhotos', images)\n        Drafts.continue()\n      })\n      document.getElementById('cancel').addEventListener('click', () => Drafts.cancel())\n    </script>\n  </body>\n</html>\n"
// END PHOTO PICKER
function fail(message) {
  app.displayErrorMessage(message)
  throw new Error(message)
}
function requestJson(url, method, body) {
  const response = HTTP.create().request({
    url,
    method,
    encoding: 'json',
    data: body,
    headers: { Authorization: 'Bearer ' + API_TOKEN, 'Content-Type': 'application/json' },
  })
  if (!response.success || response.statusCode >= 400)
    fail(
      response.responseData?.error?.message ||
        response.error ||
        'Photo upload failed; the photo files were kept. Run Attach Photos or Send to retry.',
    )
  return response.responseData || {}
}
function findWaitingReply(content) {
  const match = content.match(WAITING_REPLY_START_RE)
  if (!match) return null
  const start = content.indexOf(match[0]) + match[0].length,
    end = content.indexOf(WAITING_REPLY_END, start)
  if (end < 0) fail('Waiting reply block is incomplete')
  return { metadata: JSON.parse(match[1]), query: content.slice(start, end).trim() }
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
  if (readPhotoOperation(draft.content || ''))
    fail('A photo send is already in progress. Run Get before changing its attachments.')
  const existingReply = findWaitingReply(draft.content || '')
  if (
    existingReply?.metadata.operationId ||
    existingReply?.metadata.pendingMessageId ||
    controlRegex(/<!-- chatgptbox-new-operation:/).test(draft.content || '')
  )
    fail('The previous send is still pending. Run Get before attaching photos to the next message.')
  let metadata = readPhotoMetadata(draft.content || '')
  if (!(metadata.pendingPhotos || []).length) {
    if ((metadata.images || []).length >= 4)
      fail('This message already has 4 photos. Send them before attaching more.')
    if (HTMLPreview.create().show(PHOTO_PICKER_HTML)) {
      const photos = context.previewValues.chatgptboxPhotos
      if (!Array.isArray(photos) || !photos.length)
        fail('Choose photos and use the Add Photos button.')
      if (photos.length + (metadata.images || []).length > 4)
        fail('At most 4 photos can be attached to a message.')
      const fm = FileManager.createLocal()
      fm.createDirectory('ChatGPTBox Photos', '/')
      if (!(metadata.images || []).length) metadata.capturedAt = new Date().toISOString()
      for (const [index, photo] of photos.entries()) {
        const file =
          '/ChatGPTBox Photos/' +
          Date.now().toString(36) +
          '-' +
          Math.random().toString(36).slice(2) +
          '-' +
          index +
          '.json'
        if (!fm.writeJSON(file, photo))
          fail('Could not save the photo: ' + (fm.lastError || 'local storage unavailable'))
        metadata.pendingPhotos = [
          ...(metadata.pendingPhotos || []),
          { path: file, name: photo.name },
        ]
        writePhotoMetadata(metadata)
      }
    } else throw new Error('Photo selection cancelled')
  }
  const waiting = findWaitingReply(draft.content || '')
  const prompt =
    '记录时间：' +
    (metadata.capturedAt || new Date().toISOString()) +
    '\n请根据照片记录这一餐：识别食物，估计份量、热量和主要营养的范围，说明看不出的油、糖、酱料等不确定因素，并给出简短的饮食建议。'
  if (waiting && !waiting.query) {
    const match = draft.content.match(WAITING_REPLY_START_RE)
    const end = draft.content.indexOf(
      WAITING_REPLY_END,
      draft.content.indexOf(match[0]) + match[0].length,
    )
    draft.content = draft.content.slice(0, end) + prompt + '\n' + draft.content.slice(end)
    saveControlDocument()
  } else if (!waiting && !photoPrompt(draft.content || '', null)) {
    draft.content = prompt + '\n\n' + draft.content
    saveControlDocument()
  }
  metadata = stagePhotoFiles(metadata)
  app.displaySuccessMessage('Photos attached. Run Send to ask ChatGPT.')
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
