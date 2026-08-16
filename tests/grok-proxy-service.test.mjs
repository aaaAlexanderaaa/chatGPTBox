import { describe, expect, it } from 'vitest'
import { acquireGrokWebSessionLock } from '../src/background/grok-proxy-service.mjs'
import { handleGrokProxyRequest } from '../src/content-script/grok-proxy-handlers.mjs'

describe('acquireGrokWebSessionLock', () => {
  it('serializes one session and rejects a second locker', () => {
    const posts = []
    const port = { postMessage: (m) => posts.push(m) }
    const release = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    expect(typeof release).toBe('function')
    const second = acquireGrokWebSessionLock({ sessionId: 's1' }, port)
    expect(second).toBeNull()
    expect(posts.some((p) => /already in progress/i.test(p.error || ''))).toBe(true)
    release()
  })
})

describe('handleGrokProxyRequest', () => {
  it('uses the injected fetch once and returns folded text', async () => {
    let posts = 0
    const messages = []
    const result = await handleGrokProxyRequest({
      session: { question: 'hi', modelName: 'grokWebExpert' },
      fetch: async () => {
        posts += 1
        return new Response(`data: ${JSON.stringify({ token: 'ok', conversationId: 'c1' })}\n\n`, {
          status: 200,
        })
      },
      post: (m) => messages.push(m),
    })
    expect(posts).toBe(1)
    expect(result.answer).toBe('ok')
    expect(messages.some((m) => m.done)).toBe(true)
  })
})
