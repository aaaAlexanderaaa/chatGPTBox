const MAX_ERROR_BODY_LENGTH = 4000

export function normalizeCustomChatCompletionsUrl(apiUrl) {
  const url = String(apiUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!url) return ''
  if (url.endsWith('/v1')) return `${url}/chat/completions`
  return url
}

export function buildCustomApiHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
  }
  const token = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function compactJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatCustomApiErrorPayload(payload) {
  if (!payload) return ''
  if (typeof payload === 'string') return payload
  if (payload.message) return String(payload.message)
  if (payload.error) {
    const nested = formatCustomApiErrorPayload(payload.error)
    if (nested) return nested
  }
  return compactJson(payload)
}

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

function extractReasoningDetailsText(details) {
  if (!Array.isArray(details)) return ''
  return details
    .map((detail) => {
      if (typeof detail === 'string') return detail
      if (typeof detail?.text === 'string') return detail.text
      if (typeof detail?.summary === 'string') return detail.summary
      if (typeof detail?.content === 'string') return detail.content
      return ''
    })
    .join('')
}

function extractReasoningText(source) {
  if (!source || typeof source !== 'object') return ''
  if (typeof source.reasoning_content === 'string') return source.reasoning_content
  if (typeof source.reasoning === 'string') return source.reasoning
  if (typeof source.thinking === 'string') return source.thinking
  if (typeof source.thinking_content === 'string') return source.thinking_content
  if (typeof source.text === 'string') return source.text
  if (typeof source.summary === 'string') return source.summary
  return extractReasoningDetailsText(source.reasoning_details)
}

export function extractCustomApiChunkText(data) {
  if (!data || typeof data !== 'object') {
    return { recognized: false, hasContent: false, content: '', reasoning: '', replace: false }
  }

  if (data.type === 'response.reasoning.delta') {
    const reasoning =
      typeof data.delta === 'string' ? data.delta : extractReasoningText(data.delta)
    return { recognized: true, hasContent: Boolean(reasoning), content: '', reasoning, replace: false }
  }
  if (data.type === 'response.output_text.delta') {
    const content = typeof data.delta === 'string' ? data.delta : ''
    return { recognized: true, hasContent: Boolean(content), content, reasoning: '', replace: false }
  }

  if (typeof data.response === 'string') {
    return {
      recognized: true,
      hasContent: data.response.length > 0,
      content: data.response,
      reasoning: '',
      replace: true,
    }
  }

  if (!Array.isArray(data.choices)) {
    return { recognized: false, hasContent: false, content: '', reasoning: '', replace: false }
  }
  const choice = data.choices[0]
  if (!choice) {
    return { recognized: true, hasContent: false, content: '', reasoning: '', replace: false }
  }

  const reasoning =
    extractReasoningText(choice.delta) ||
    extractReasoningText(choice.message) ||
    extractReasoningText(choice)
  if (typeof choice.delta?.content === 'string') {
    return {
      recognized: true,
      hasContent: choice.delta.content.length > 0 || reasoning.length > 0,
      content: choice.delta.content,
      reasoning,
      replace: false,
    }
  }

  const content = extractContentText(choice.message?.content)
  if (content || reasoning) {
    return {
      recognized: true,
      hasContent: content.length > 0 || reasoning.length > 0,
      content,
      reasoning,
      replace: Boolean(content),
    }
  }

  if (typeof choice.text === 'string') {
    return {
      recognized: true,
      hasContent: choice.text.length > 0,
      content: choice.text,
      reasoning: '',
      replace: false,
    }
  }

  return { recognized: true, hasContent: false, content: '', reasoning: '', replace: false }
}

function escapeClosingThinkTag(text) {
  return String(text || '').replace(/<\/think>/gi, '<\\/think>')
}

export function formatCustomApiDisplayAnswer(reasoning, content) {
  const reasoningText = String(reasoning || '')
  const contentText = String(content || '')
  const parts = []
  if (reasoningText.trim()) parts.push(`<think>\n${escapeClosingThinkTag(reasoningText)}\n</think>`)
  if (contentText) parts.push(contentText)
  return parts.join('\n\n')
}

export function truncateCustomApiErrorBody(text) {
  const value = String(text || '').trim()
  if (value.length <= MAX_ERROR_BODY_LENGTH) return value
  return `${value.slice(0, MAX_ERROR_BODY_LENGTH)}...`
}

export async function createCustomApiHttpError(resp) {
  const statusText = [resp.status, resp.statusText].filter(Boolean).join(' ')
  const url = resp.url ? ` ${resp.url}` : ''
  const rawText = await resp.text().catch(() => '')
  let detail = rawText
  if (rawText) {
    try {
      const json = JSON.parse(rawText)
      detail = formatCustomApiErrorPayload(json) || compactJson(json)
    } catch {
      detail = rawText
    }
  }

  const message = [`Custom API request failed: ${statusText || 'HTTP error'}${url}`]
  if (detail) message.push(truncateCustomApiErrorBody(detail))
  return new Error(message.join('\n'))
}

export function createCustomApiNetworkError(error, requestUrl = '') {
  const message = error?.message || String(error || 'unknown network error')
  const details = [`Custom API request failed before receiving a response: ${message}`]
  const endpoint = String(requestUrl || '').trim()
  if (endpoint) details.push(`Endpoint: ${endpoint}`)
  details.push(
    'Check that the server is running, the URL is reachable from this browser, and the endpoint permits the request method/headers.',
  )
  return new Error(details.join('\n'))
}

export function createUnexpectedCustomApiPayloadError(data) {
  return new Error(
    `Unexpected Custom API response payload: ${truncateCustomApiErrorBody(compactJson(data))}`,
  )
}
