import { createParser } from './eventsource-parser.mjs'

export async function fetchSSE(resource, options) {
  const { onMessage, onStart, onEnd, onError, ...fetchOptions } = options
  const resp = await fetch(resource, fetchOptions).catch(async (err) => {
    await onError(err)
  })
  if (!resp) return
  if (!resp.ok) {
    await onError(resp)
    return
  }
  const contentType = resp.headers.get('content-type')?.toLowerCase() ?? ''
  const isEventStreamResponse = contentType.includes('text/event-stream')
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let hasSseEvent = false
  const parser = createParser((event) => {
    if (event.type === 'event') {
      hasSseEvent = true
      onMessage(event.data)
    }
  })
  const reader = resp.body?.getReader()
  if (!reader) {
    const responseText = await resp.text()
    await onStart(responseText)
    feedFallbackResponse(responseText)
    await onEnd()
    return
  }

  let hasStarted = false
  let bufferedResponseText = ''
  let result
  while (!(result = await reader.read()).done) {
    const chunk = result.value
    const decodedChunk = decoder.decode(chunk, { stream: true })
    bufferedResponseText += decodedChunk
    if (!hasStarted) {
      hasStarted = true
      await onStart(decodedChunk)
    }
    parser.feed(chunk)
  }

  bufferedResponseText += decoder.decode()
  if (!hasSseEvent && !isEventStreamResponse) {
    feedFallbackResponse(bufferedResponseText)
  }
  await onEnd()

  function feedFallbackResponse(responseText) {
    let fakeSseData
    try {
      const commonResponse = JSON.parse(responseText)
      fakeSseData = `data: ${JSON.stringify(commonResponse)}\n\ndata: [DONE]\n\n`
    } catch (error) {
      console.debug('not common response', error)
    }

    const fallbackParser = createParser((event) => {
      if (event.type === 'event') {
        onMessage(event.data)
      }
    })
    fallbackParser.feed(encoder.encode(fakeSseData || responseText))
  }
}
