/* global HTTP, app, draft */
// Change this if your API gateway runs on a different host or port.
const BASE_URL = 'http://127.0.0.1:18080'
const LIST_URL =
  BASE_URL + '/chatgpt/conversations?offset=0&limit=100&order=updated&force_sync=true'

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

function formatLine(item) {
  const title = item.title && item.title.trim() ? item.title.trim() : '(untitled)'
  const created = item.create_time || item.createTime || ''
  return '- [ ] ' + title + ' | ' + created + ' <!-- chatgptbox-conversation:' + item.id + ' -->'
}

try {
  const payload = requestJson(LIST_URL, 'GET')
  const items = Array.isArray(payload.items) ? payload.items : []
  draft.content = items.map(formatLine).join('\n')
  draft.update()
  app.displaySuccessMessage('Loaded ' + items.length + ' conversations')
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
