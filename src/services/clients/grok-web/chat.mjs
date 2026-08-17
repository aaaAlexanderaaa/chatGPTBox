import { grokSlugToModeId } from '../../../config/grok-web.mjs'

const NEW_CHAT_URL = 'https://grok.com/rest/app-chat/conversations/new'

function chatUrl(conversationId, previousResponseID) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!id) return NEW_CHAT_URL
  const parentId = typeof previousResponseID === 'string' ? previousResponseID.trim() : ''
  if (!parentId) {
    throw new Error('previousResponseID is required to continue a Grok conversation')
  }
  return `https://grok.com/rest/app-chat/conversations/${encodeURIComponent(id)}/responses`
}

function grokStreamErrorMessage(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object') return ''
  if (typeof value.message === 'string' && value.message.trim()) return value.message.trim()
  if (typeof value.error === 'string' && value.error.trim()) return value.error.trim()
  if (typeof value.detail === 'string' && value.detail.trim()) return value.detail.trim()
  return ''
}

function throwIfGrokStreamError(payload) {
  if (!payload || typeof payload !== 'object') return
  if (payload.error && typeof payload.error === 'object') {
    throw new Error(grokStreamErrorMessage(payload.error) || 'Grok Web stream error')
  }
  const result = payload.result && typeof payload.result === 'object' ? payload.result : null
  const response = result?.response && typeof result.response === 'object' ? result.response : null
  if (response?.error && typeof response.error === 'object') {
    throw new Error(grokStreamErrorMessage(response.error) || 'Grok Web stream error')
  }
  const streamErrors = response?.modelResponse?.streamErrors
  if (!Array.isArray(streamErrors)) return
  for (const item of streamErrors) {
    const nested = item && typeof item === 'object' ? item.error : null
    const message =
      grokStreamErrorMessage(item) ||
      (nested && typeof nested === 'object' ? grokStreamErrorMessage(nested) : '')
    if (message) throw new Error(message)
  }
}

function buildRequestBody({ question, modelSlug, conversationId, previousResponseID }) {
  const body = {
    temporary: false,
    modeId: grokSlugToModeId(modelSlug) || 'fast',
    message: question,
    fileAttachments: [],
    imageAttachments: [],
  }
  const parentId = typeof previousResponseID === 'string' ? previousResponseID.trim() : ''
  if (typeof conversationId === 'string' && conversationId.trim() && parentId) {
    body.responseId = parentId
  }
  return body
}

function createSseFolder(onDelta) {
  let answer = ''
  let conversationId = ''
  let previousResponseID = ''
  let emittedText = ''

  const emit = (next) => {
    if (next === answer) return
    answer = next
    emittedText = next
    if (typeof onDelta === 'function') onDelta(answer)
  }

  const applyFrame = (payload) => {
    if (!payload || typeof payload !== 'object') return
    throwIfGrokStreamError(payload)
    const result = payload.result && typeof payload.result === 'object' ? payload.result : null
    const conversation = result?.conversation
    if (conversation && typeof conversation.conversationId === 'string' && conversation.conversationId) {
      conversationId = conversation.conversationId
    }

    const response = result?.response && typeof result.response === 'object' ? result.response : null
    if (!response) return

    const userResponse = response.userResponse
    if (userResponse && typeof userResponse.responseId === 'string' && userResponse.responseId) {
      previousResponseID = userResponse.responseId
    }

    const token = typeof response.token === 'string' ? response.token : ''
    const thinking = response.isThinking === true
    const tag = typeof response.messageTag === 'string' ? response.messageTag : ''
    if (token && !thinking && (tag === 'final' || tag === '')) {
      emit(answer + token)
    }

    const modelResponse = response.modelResponse
    if (!modelResponse || typeof modelResponse !== 'object') return

    if (
      typeof modelResponse.parentResponseId === 'string' &&
      modelResponse.parentResponseId &&
      !previousResponseID
    ) {
      previousResponseID = modelResponse.parentResponseId
    }

    const message = typeof modelResponse.message === 'string' ? modelResponse.message : ''
    if (!message) return
    if (message.startsWith(emittedText)) {
      const delta = message.slice(emittedText.length)
      if (delta) emit(emittedText + delta)
      return
    }
    if (!emittedText) emit(message)
  }

  const feedText = (text) => {
    for (const line of String(text).split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const jsonText = trimmed.slice(5).trim()
      if (!jsonText || jsonText === '[DONE]') continue
      try {
        applyFrame(JSON.parse(jsonText))
      } catch (err) {
        if (err instanceof SyntaxError) continue
        throw err
      }
    }
  }

  return {
    feedText,
    result: () => ({ answer, conversationId, previousResponseID }),
  }
}

async function consumeSse(response, onDelta) {
  const folder = createSseFolder(onDelta)
  const reader = response.body?.getReader?.()
  if (!reader) {
    folder.feedText(await response.text())
    return folder.result()
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let chunk = await reader.read()
  while (!chunk.done) {
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    folder.feedText(lines.join('\n') + '\n')
    chunk = await reader.read()
  }
  buffer += decoder.decode()
  if (buffer) folder.feedText(buffer)
  return folder.result()
}

export function createGrokChatWriter({ fetch: fetchImpl }) {
  return {
    async send({ question, modelSlug, conversationId, previousResponseID, signal, onDelta }) {
      const response = await fetchImpl(chatUrl(conversationId, previousResponseID), {
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

      return consumeSse(response, onDelta)
    },
  }
}
