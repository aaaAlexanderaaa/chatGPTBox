/* eslint-env node */
import { afterEach, describe, expect, it } from 'vitest'
import { sendMcpJsonRpc } from '../src/services/mcp/http-transport.mjs'

const SERVER = { httpUrl: 'https://mcp.example/rpc' }

// normalizeOptions clamps timeoutMs to a 1000ms floor, so the timings below are
// expressed relative to that rather than to something shorter.
const IDLE_TIMEOUT_MS = 1000
const CHUNK_GAP_MS = 400
const CHUNK_COUNT = 4 // 1600ms total > IDLE_TIMEOUT_MS, but no single gap is

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function sseEvent(index) {
  return `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { index } })}\n\n`
}

/**
 * Stands in for fetch: an event stream whose chunks arrive on a timer, wired to
 * the abort signal the way a real fetch body is.
 */
function stubStreamingFetch({
  chunkCount,
  gapMs,
  stall = false,
  holdOpen = false,
  contentType,
  calls,
}) {
  globalThis.fetch = (_url, init) => {
    if (calls) calls.count += 1
    const signal = init.signal
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let aborted = false
        const onAbort = () => {
          aborted = true
          try {
            controller.error(signal.reason || new Error('aborted'))
          } catch {
            /* already closed */
          }
        }
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })

        if (stall) return // headers arrive, body never produces a byte

        for (let index = 0; index < chunkCount; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, gapMs))
          if (aborted) return
          controller.enqueue(encoder.encode(sseEvent(index)))
        }
        // holdOpen models a server that emits a result and then never closes the
        // stream — the case where the call has already taken effect.
        if (!aborted && !holdOpen) controller.close()
      },
    })
    return Promise.resolve(
      new Response(stream, {
        headers: { 'content-type': contentType || 'text/event-stream' },
      }),
    )
  }
}

// A chunked JSON body, delivered on the same timer as the SSE stub.
function stubChunkedJsonFetch({ gapMs, pieces, calls }) {
  globalThis.fetch = (_url, init) => {
    if (calls) calls.count += 1
    const signal = init.signal
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let aborted = false
        const onAbort = () => {
          aborted = true
          try {
            controller.error(signal.reason || new Error('aborted'))
          } catch {
            /* already closed */
          }
        }
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })

        for (const piece of pieces) {
          await new Promise((resolve) => setTimeout(resolve, gapMs))
          if (aborted) return
          controller.enqueue(encoder.encode(piece))
        }
        if (!aborted) controller.close()
      },
    })
    return Promise.resolve(
      new Response(stream, { headers: { 'content-type': 'application/json' } }),
    )
  }
}

describe('sendMcpJsonRpc event-stream timeout', () => {
  it('lets a slow but live stream run past the timeout window', async () => {
    stubStreamingFetch({ chunkCount: CHUNK_COUNT, gapMs: CHUNK_GAP_MS })

    const payload = await sendMcpJsonRpc(
      SERVER,
      'tools/call',
      {},
      { timeoutMs: IDLE_TIMEOUT_MS, maxRetries: 0 },
    )

    // A total deadline would have aborted this at 1000ms, well before the
    // 1600ms the stream takes to finish.
    expect(payload).toEqual({ jsonrpc: '2.0', id: 1, result: { index: 0 } })
  })

  it('still aborts a stream that stalls after the headers', async () => {
    stubStreamingFetch({ chunkCount: 0, gapMs: 0, stall: true })

    await expect(
      sendMcpJsonRpc(SERVER, 'tools/call', {}, { timeoutMs: IDLE_TIMEOUT_MS, maxRetries: 0 }),
    ).rejects.toThrow(/inactivity/)
  })

  it('honours an external abort signal mid-stream', async () => {
    stubStreamingFetch({ chunkCount: CHUNK_COUNT, gapMs: CHUNK_GAP_MS })
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('caller went away')), CHUNK_GAP_MS / 2)

    await expect(
      sendMcpJsonRpc(
        SERVER,
        'tools/call',
        {},
        { timeoutMs: IDLE_TIMEOUT_MS, maxRetries: 0, signal: controller.signal },
      ),
    ).rejects.toThrow(/caller went away/)
  })

  it('lets a slow but live JSON body run past the timeout window too', async () => {
    // The non-streaming paths are awaited as well, so they need the same
    // per-chunk rearm — otherwise a large JSON download gained a hard deadline.
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    const pieces = [body.slice(0, 10), body.slice(10, 20), body.slice(20, 30), body.slice(30)]
    stubChunkedJsonFetch({ gapMs: CHUNK_GAP_MS, pieces })

    const payload = await sendMcpJsonRpc(
      SERVER,
      'tools/call',
      {},
      { timeoutMs: IDLE_TIMEOUT_MS, maxRetries: 0 },
    )

    expect(payload).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })

  it('caps a stream that drips just fast enough to keep rearming the idle timer', async () => {
    // maxTotalMs is the backstop: without it this stream never ends.
    stubStreamingFetch({ chunkCount: 1000, gapMs: 100 })

    await expect(
      sendMcpJsonRpc(
        SERVER,
        'tools/call',
        {},
        { timeoutMs: IDLE_TIMEOUT_MS, maxTotalMs: 1200, maxRetries: 0 },
      ),
    ).rejects.toThrow(/total/)
  })

  it('does not retry a timeout once the server has started responding', async () => {
    // Re-POSTing a tools/call the server already began executing could duplicate
    // a side effect, so a mid-body timeout must not be classified retryable.
    const calls = { count: 0 }
    stubStreamingFetch({ chunkCount: 1, gapMs: 100, holdOpen: true, calls })

    await expect(
      sendMcpJsonRpc(
        SERVER,
        'tools/call',
        {},
        { timeoutMs: IDLE_TIMEOUT_MS, maxRetries: 2, retryDelayMs: 50 },
      ),
    ).rejects.toThrow(/timeout/)
    expect(calls.count).toBe(1)
  })

  it('still retries a timeout that fires before any byte arrives', async () => {
    const calls = { count: 0 }
    stubStreamingFetch({ chunkCount: 0, gapMs: 0, stall: true, calls })

    await expect(
      sendMcpJsonRpc(
        SERVER,
        'tools/call',
        {},
        { timeoutMs: IDLE_TIMEOUT_MS, maxRetries: 1, retryDelayMs: 50 },
      ),
    ).rejects.toThrow(/inactivity/)
    expect(calls.count).toBe(2)
  })
})
