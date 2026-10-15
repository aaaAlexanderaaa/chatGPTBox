/* global HTTP, app, draft, FileManager, HTMLPreview, context */
const BASE_URL = 'http://127.0.0.1:18080'
const API_TOKEN = 'PASTE_GATEWAY_API_TOKEN_HERE'
const MODEL_OVERRIDE = null
const WAITING_REPLY_START_RE = /<!-- chatgptbox-waiting-reply:start (\{.*\}) -->/
const WAITING_REPLY_END = '<!-- chatgptbox-waiting-reply:end -->'
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
const PHOTO_METADATA_RE = /<!-- chatgptbox-photos:(\{.*\}) -->/
const PHOTO_OPERATION_RE = /<!-- chatgptbox-photo-operation:(\{.*\}) -->/
const PHOTO_STATUS_RE = /^Photo send:.*\n?/gm

function readPhotoMetadata(content) {
  const match = content.match(PHOTO_METADATA_RE)
  return match ? JSON.parse(match[1]) : { images: [], pendingPhotos: [], projectId: null }
}

function writePhotoMetadata(metadata) {
  const marker = '<!-- chatgptbox-photos:' + JSON.stringify(metadata) + ' -->'
  draft.content = PHOTO_METADATA_RE.test(draft.content || '')
    ? draft.content.replace(PHOTO_METADATA_RE, () => marker)
    : (draft.content || '').trimEnd() + '\n\n' + marker + '\n'
  draft.update()
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
  draft.content = (draft.content || '').replace(PHOTO_STATUS_RE, '').trimEnd() + '\n\n' + line
  draft.update()
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
      '# Conversation\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start ' +
      JSON.stringify({ conversationId: receipt.conversationId }) +
      ' -->\n' +
      job.request.query +
      '\n<!-- chatgptbox-waiting-reply:end -->\n'
  }
  const match = draft.content.match(WAITING_REPLY_START_RE)
  const waitingMetadata = JSON.parse(match[1])
  delete waitingMetadata.operationId
  delete waitingMetadata.operationRequest
  waitingMetadata.conversationId = receipt.conversationId
  waitingMetadata.defaultModel = receipt.defaultModel || waitingMetadata.defaultModel || null
  waitingMetadata.pendingMessageId = receipt.messageId
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
    '\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start ' +
    JSON.stringify(waitingMetadata) +
    ' -->\n' +
    unsent +
    '\n<!-- chatgptbox-waiting-reply:end -->\n' +
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
      '\n\n<!-- chatgptbox-photo-operation:' +
      JSON.stringify(job) +
      ' -->\n'
    draft.update()
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
    /<!-- chatgptbox-new-operation:/.test(draft.content || '')
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
    draft.update()
  } else if (!waiting && !photoPrompt(draft.content || '', null)) {
    draft.content = prompt + '\n\n' + draft.content
    draft.update()
  }
  metadata = stagePhotoFiles(metadata)
  app.displaySuccessMessage('Photos attached. Run Send to ask ChatGPT.')
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
