import { describe, expect, it } from 'vitest'
import { createGrokChatWriter } from '../src/services/clients/grok-web/chat.mjs'

function sseResponse(frames, status = 200) {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function grok2apiFrames() {
  return [
    { result: { conversation: { conversationId: 'c1' } } },
    { result: { response: { userResponse: { responseId: 'parent_1' } } } },
    {
      result: {
        response: { token: 'Hel', isThinking: false, messageTag: 'final' },
      },
    },
    {
      result: {
        response: { token: 'lo', isThinking: false, messageTag: 'final' },
      },
    },
    {
      result: {
        response: { modelResponse: { parentResponseId: 'parent_1', message: 'Hello' } },
      },
    },
  ]
}

describe('createGrokChatWriter', () => {
  it('POSTs once with modeId and folds grok2api nested frames', async () => {
    const calls = []
    const writer = createGrokChatWriter({
      fetch: async (url, init) => {
        calls.push({ url, init })
        return sseResponse(grok2apiFrames())
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
      modeId: 'expert',
      message: 'hi',
    })
    expect(JSON.parse(calls[0].init.body).modelName).toBeUndefined()
    expect(result).toMatchObject({
      answer: 'Hello',
      conversationId: 'c1',
      previousResponseID: 'parent_1',
    })
    expect(deltas.at(-1)).toBe('Hello')
  })

  it('follows up on /responses with responseId', async () => {
    const calls = []
    const writer = createGrokChatWriter({
      fetch: async (url, init) => {
        calls.push({ url, init })
        return sseResponse(grok2apiFrames())
      },
    })
    await writer.send({
      question: 'again',
      modelSlug: 'grok-chat-fast',
      conversationId: 'c1',
      previousResponseID: 'parent_1',
    })
    expect(calls[0].url).toBe('https://grok.com/rest/app-chat/conversations/c1/responses')
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      modeId: 'fast',
      message: 'again',
      responseId: 'parent_1',
    })
    expect(JSON.parse(calls[0].init.body).conversationId).toBeUndefined()
    expect(JSON.parse(calls[0].init.body).parentResponseId).toBeUndefined()
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

  it('throws on result.response.error and does not treat the stream as success', async () => {
    const writer = createGrokChatWriter({
      fetch: async () =>
        sseResponse([
          { result: { conversation: { conversationId: 'c1' } } },
          { result: { response: { error: { message: 'usage limit reached' } } } },
        ]),
    })
    await expect(writer.send({ question: 'hi', modelSlug: 'grok-chat-fast' })).rejects.toThrow(
      /usage limit reached/,
    )
  })

  it('throws on modelResponse.streamErrors', async () => {
    const writer = createGrokChatWriter({
      fetch: async () =>
        sseResponse([
          {
            result: {
              response: {
                modelResponse: {
                  streamErrors: [
                    { message: 'Admission denied by perf_based_admission_controller' },
                  ],
                },
              },
            },
          },
        ]),
    })
    await expect(writer.send({ question: 'hi', modelSlug: 'grok-chat-fast' })).rejects.toThrow(
      /Admission denied/,
    )
  })

  it('throws on root.error', async () => {
    const writer = createGrokChatWriter({
      fetch: async () => sseResponse([{ error: { message: 'anti-bot rejection' } }]),
    })
    await expect(writer.send({ question: 'hi', modelSlug: 'grok-chat-fast' })).rejects.toThrow(
      /anti-bot rejection/,
    )
  })

  it('refuses a follow-up without previousResponseID and does not POST', async () => {
    let posts = 0
    const writer = createGrokChatWriter({
      fetch: async () => {
        posts += 1
        return sseResponse(grok2apiFrames())
      },
    })
    await expect(
      writer.send({
        question: 'again',
        modelSlug: 'grok-chat-fast',
        conversationId: 'c1',
      }),
    ).rejects.toThrow(/previousResponseID/)
    expect(posts).toBe(0)
  })
})
