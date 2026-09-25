// MAIN owns native authentication. This bridge carries response bytes only;
// it does not expose tokens or grant the page access to extension APIs.
export function createChatgptWebPageTransport(context, page = globalThis.window) {
  if (context.transport !== 'native') return { fetch: (...args) => fetch(...args), close() {} }
  const pending = new Map()
  let closed = false
  const send = (data) =>
    page.postMessage(
      { source: 'chatgptbox-native-request', channel: context.channel, ...data },
      'https://chatgpt.com',
    )
  const abortError = () => new DOMException('Aborted', 'AbortError')
  const receive = (event) => {
    const data = event.data
    if (
      event.source !== page ||
      event.origin !== 'https://chatgpt.com' ||
      data?.source !== 'chatgptbox-native-response' ||
      data.channel !== context.channel
    )
      return
    const entry = pending.get(data.id)
    if (!entry) return
    entry.touch()
    try {
      if (data.type === 'headers' && !entry.responded) {
        const response = new Response([204, 205, 304].includes(data.status) ? null : entry.stream, {
          status: data.status,
          statusText: data.statusText,
          headers: data.headers,
        })
        entry.responded = true
        entry.resolve(response)
      } else if (data.type === 'chunk' && entry.responded) {
        entry.controller.enqueue(Uint8Array.from(data.bytes))
      } else if (data.type === 'end') {
        if (!entry.responded) throw new Error('ChatGPT native response had no headers.')
        entry.controller.close()
        entry.cleanup()
      } else if (data.type === 'error') {
        throw data.aborted ? abortError() : new Error(data.message)
      }
    } catch (error) {
      entry.fail(error)
    }
  }
  page.addEventListener('message', receive)
  function close() {
    if (closed) return
    closed = true
    send({ type: 'close' })
    for (const entry of pending.values()) entry.fail(abortError())
    page.removeEventListener('message', receive)
    page.removeEventListener('pagehide', close)
  }
  page.addEventListener('pagehide', close, { once: true })
  return {
    native: true,
    close,
    fetch(url, options = {}) {
      if (closed || options.signal?.aborted) return Promise.reject(abortError())
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        let timer
        const entry = { resolve, reject, responded: false }
        const abort = () => entry.fail(abortError())
        entry.cleanup = () => {
          clearTimeout(timer)
          pending.delete(id)
          options.signal?.removeEventListener('abort', abort)
        }
        entry.fail = (error) => {
          send({ type: 'abort', id })
          if (entry.responded) entry.controller.error(error)
          else {
            entry.controller.close()
            reject(error)
          }
          entry.cleanup()
        }
        entry.touch = () => {
          clearTimeout(timer)
          timer = setTimeout(
            () => entry.fail(new Error('ChatGPT native response timed out.')),
            90000,
          )
        }
        entry.stream = new ReadableStream({
          start(controller) {
            entry.controller = controller
          },
          cancel() {
            send({ type: 'abort', id })
            entry.cleanup()
          },
        })
        pending.set(id, entry)
        options.signal?.addEventListener('abort', abort, { once: true })
        entry.touch()
        send({
          type: 'fetch',
          id,
          url: String(url),
          method: options.method || 'GET',
          headers: Object.fromEntries(new Headers(options.headers)),
          body: options.body,
        })
      })
    },
  }
}
