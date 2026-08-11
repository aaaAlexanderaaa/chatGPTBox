/* eslint-env node */
import { describe, expect, it } from 'vitest'
import {
  base64ToUint8Array,
  createChatgptWebWebsocketBodyParser,
} from '../src/services/clients/chatgpt-web/websocket-state.mjs'

function toBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

describe('base64ToUint8Array', () => {
  it('recovers the original UTF-8 bytes', () => {
    const text = 'café 中文 🎉'
    const bytes = base64ToUint8Array(toBase64(text))
    expect(new TextDecoder('utf-8').decode(bytes)).toBe(text)
  })
})

describe('createChatgptWebWebsocketBodyParser', () => {
  it('parses an SSE payload fed as bytes without mangling non-ASCII text', () => {
    const messages = []
    const parser = createChatgptWebWebsocketBodyParser({
      handleMessage: (data) => messages.push(data),
    })

    const frame = `data: ${JSON.stringify({ text: 'café 中文' })}\n\n`
    parser.feed(base64ToUint8Array(toBase64(frame)))

    expect(messages).toEqual([{ text: 'café 中文' }])
  })

  it('reassembles a multibyte character split across two frames', () => {
    const messages = []
    const parser = createChatgptWebWebsocketBodyParser({
      handleMessage: (data) => messages.push(data),
    })

    const frame = `data: ${JSON.stringify({ text: 'né' })}\n\n`
    const bytes = new TextEncoder().encode(frame)
    const splitAt = frame.indexOf('n') + 2 // lands inside the two-byte 'é'
    parser.feed(bytes.slice(0, splitAt))
    parser.feed(bytes.slice(splitAt))

    expect(messages).toEqual([{ text: 'né' }])
  })

  it('signals completion on [DONE]', () => {
    let done = false
    const parser = createChatgptWebWebsocketBodyParser({ handleDone: () => (done = true) })
    parser.feed('data: [DONE]\n\n')
    expect(done).toBe(true)
  })
})
