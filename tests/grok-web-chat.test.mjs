import { describe, expect, it } from 'vitest'
import { createGrokChatWriter } from '../src/services/clients/grok-web/chat.mjs'

function sseResponse(lines, status = 200) {
  const body = lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('')
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('createGrokChatWriter', () => {
  it('POSTs once and folds SSE text + ids', async () => {
    const calls = []
    const writer = createGrokChatWriter({
      fetch: async (url, init) => {
        calls.push({ url, init })
        return sseResponse([
          { conversationId: 'c1', token: 'Hel' },
          { previousResponseID: 'r1', token: 'lo' },
        ])
      },
    })
    const deltas = []
    const result = await writer.send({
      question: 'hi',
      modelSlug: 'grok-chat-expert',
      onDelta: (t) => deltas.push(t),
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://grok.com/rest/app-chat/conversations/new')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      temporary: false,
      modelName: 'grok-chat-expert',
      message: 'hi',
    })
    expect(result).toMatchObject({
      answer: 'Hello',
      conversationId: 'c1',
      previousResponseID: 'r1',
    })
    expect(deltas.at(-1)).toBe('Hello')
  })

  it('does not replay the POST after dispatch when the stream dies', async () => {
    let posts = 0
    const writer = createGrokChatWriter({
      fetch: async () => {
        posts += 1
        throw new Error('network down after send')
      },
    })
    await expect(writer.send({ question: 'hi', modelSlug: 'grok-chat-fast' })).rejects.toThrow(
      /network down/,
    )
    expect(posts).toBe(1)
  })

  it('surfaces 429 without retry or model change', async () => {
    let posts = 0
    const writer = createGrokChatWriter({
      fetch: async () => {
        posts += 1
        return new Response('rate limited', { status: 429 })
      },
    })
    await expect(writer.send({ question: 'hi', modelSlug: 'grok-chat-heavy' })).rejects.toThrow(
      /429/,
    )
    expect(posts).toBe(1)
  })
})
