function extractContentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      if (typeof part?.output_text === 'string') return part.output_text
      return ''
    })
    .join('')
}

export function convertMessagesToResponsesInput(messages) {
  const input = []
  let instructions = ''

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || '')
    const text = extractContentText(message?.content).trim()
    if (!text) continue

    if (role === 'system') {
      instructions = instructions ? `${instructions}\n\n${text}` : text
      continue
    }

    if (role === 'user' || role === 'assistant') {
      input.push({
        role,
        content: [{ type: 'input_text', text }],
      })
    }
  }

  return { input, instructions }
}

export function extractResponsesOutputText(payload) {
  const outputText = typeof payload?.output_text === 'string' ? payload.output_text.trim() : ''
  if (outputText) return outputText

  const output = Array.isArray(payload?.output) ? payload.output : []
  const parts = []

  for (const item of output) {
    if (item?.type !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) parts.push(part.text)
      if (typeof part?.output_text === 'string' && part.output_text.trim()) parts.push(part.output_text)
    }
  }

  return parts.join('\n').trim()
}

export function resolveResponsesEndpoint(baseUrlOrEndpoint) {
  const input = String(baseUrlOrEndpoint || '').trim().replace(/\/+$/, '')
  if (!input) return ''
  if (input.endsWith('/responses')) return input
  return `${input}/responses`
}

export async function postOpenAiResponses(baseUrlOrEndpoint, apiKey, body, signal) {
  const endpoint = resolveResponsesEndpoint(baseUrlOrEndpoint)
  if (!endpoint) throw new Error('Responses endpoint is required')

  const headers = {
    'Content-Type': 'application/json',
  }
  const token = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({ ...body, stream: false }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Responses API request failed: ${response.status} ${response.statusText}\n${text}`)
  }
  return response.json()
}
