const CHAT_URL = 'https://grok.com/rest/app-chat/conversations/new'

function buildRequestBody({ question, modelSlug, conversationId, previousResponseID }) {
  const body = {
    temporary: false,
    modelName: modelSlug,
    message: question,
    fileAttachments: [],
    imageAttachments: [],
  }
  if (typeof conversationId === 'string' && conversationId.trim() !== '') {
    body.conversationId = conversationId
  }
  if (typeof previousResponseID === 'string' && previousResponseID.trim() !== '') {
    body.parentResponseId = previousResponseID
  }
  return body
}

function extractText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.token === 'string') return payload.token
  if (typeof payload.message === 'string') return payload.message
  if (payload.result && typeof payload.result === 'object' && typeof payload.result.response === 'string') {
    return payload.result.response
  }
  return ''
}

function foldSse(text, onDelta) {
  let answer = ''
  let conversationId = ''
  let previousResponseID = ''

  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const jsonText = trimmed.slice(5).trim()
    if (!jsonText || jsonText === '[DONE]') continue

    let payload
    try {
      payload = JSON.parse(jsonText)
    } catch {
      continue
    }
    if (!payload || typeof payload !== 'object') continue

    if (typeof payload.conversationId === 'string' && payload.conversationId) {
      conversationId = payload.conversationId
    }
    if (typeof payload.previousResponseID === 'string' && payload.previousResponseID) {
      previousResponseID = payload.previousResponseID
    } else if (typeof payload.responseId === 'string' && payload.responseId) {
      previousResponseID = payload.responseId
    }

    const piece = extractText(payload)
    if (piece) {
      answer += piece
      if (typeof onDelta === 'function') onDelta(answer)
    }
  }

  return { answer, conversationId, previousResponseID }
}

export function createGrokChatWriter({ fetch: fetchImpl }) {
  return {
    async send({ question, modelSlug, conversationId, previousResponseID, signal, onDelta }) {
      const response = await fetchImpl(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildRequestBody({ question, modelSlug, conversationId, previousResponseID }),
        ),
        signal,
      })

      if (!response.ok) {
        const bodyText = await response.text()
        throw new Error(`Grok Web request failed (${response.status}): ${bodyText}`)
      }

      const streamText = await response.text()
      return foldSse(streamText, onDelta)
    },
  }
}
