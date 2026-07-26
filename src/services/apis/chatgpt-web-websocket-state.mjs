import { createParser } from '../../utils/eventsource-parser.mjs'

function defaultSocketCloseError() {
  return new Error('ChatGPT websocket closed before response completed')
}

// Websocket frames carry the response body base64-encoded. `atob` yields one
// character per raw byte, so the bytes must be recovered as bytes — decoding
// that Latin-1 string as text would mangle every UTF-8 multibyte sequence.
export function base64ToUint8Array(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function createChatgptWebWebsocketBodyParser({
  handleMessage,
  handleDone,
  handleParseError,
}) {
  const encoder = new TextEncoder()
  const parser = createParser((event) => {
    if (event.type !== 'event') return

    const body = typeof event.data === 'string' ? event.data.trim() : ''
    if (!body) return
    if (body === '[DONE]') {
      handleDone?.()
      return
    }

    try {
      handleMessage?.(JSON.parse(body))
    } catch (error) {
      handleParseError?.(error, body)
    }
  })

  return {
    feed(chunk) {
      if (chunk instanceof Uint8Array) {
        if (chunk.length === 0) return
        parser.feed(chunk)
        return
      }
      if (typeof chunk !== 'string' || chunk.length === 0) return
      parser.feed(encoder.encode(chunk))
    },
  }
}

export function createChatgptWebWebsocketRequestController({
  session,
  handleMessage,
  finishMessage,
  failMessage,
  cleanup,
  createSocketCloseError = defaultSocketCloseError,
  maxBufferedEvents = 32,
}) {
  const bufferedEvents = []
  let settled = false

  function runCleanup() {
    try {
      cleanup?.()
    } catch {
      /* ignore cleanup errors */
    }
  }

  function settle(callback) {
    if (settled) return false
    settled = true
    runCleanup()
    callback?.()
    return true
  }

  function finish() {
    return settle(() => finishMessage?.())
  }

  function fail(error = createSocketCloseError()) {
    return settle(() => failMessage?.(error))
  }

  function handleSocketEvent(entry) {
    if (settled) return 'settled'
    if (!session.conversationId) {
      if (bufferedEvents.length >= maxBufferedEvents) bufferedEvents.shift()
      bufferedEvents.push(entry)
      return 'buffered'
    }
    if (entry.conversationId !== session.conversationId) return 'ignored'
    if (entry.type === 'done') {
      finish()
      return 'finished'
    }
    handleMessage?.(entry.data)
    return 'handled'
  }

  function confirmDispatch({ conversationId, wsRequestId } = {}) {
    if (settled) {
      return {
        accepted: false,
        bufferedCount: 0,
        settled: true,
      }
    }

    session.conversationId = conversationId
    if (wsRequestId != null) {
      session.wsRequestId = wsRequestId
    }

    const bufferedCount = bufferedEvents.length
    while (bufferedEvents.length > 0 && !settled) {
      handleSocketEvent(bufferedEvents.shift())
    }
    return {
      accepted: true,
      bufferedCount,
      settled,
    }
  }

  function handleSocketClose(error = createSocketCloseError()) {
    fail(error)
    return error
  }

  return {
    confirmDispatch,
    fail,
    getBufferedCount: () => bufferedEvents.length,
    handleSocketClose,
    handleSocketEvent,
    isSettled: () => settled,
  }
}
