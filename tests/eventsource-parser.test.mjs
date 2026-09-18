/* eslint-env node */
import { describe, expect, it } from 'vitest'
import { createParser } from '../src/utils/eventsource-parser.mjs'

const encoder = new TextEncoder()
const toBytes = (text) => encoder.encode(text)

function collect(chunks) {
  const parsed = []
  const parser = createParser((event) => parsed.push(event))
  for (const chunk of chunks) parser.feed(chunk)
  return { parsed, parser }
}

describe('createParser', () => {
  it('parses multiple SSE events in one chunk', () => {
    const { parsed } = collect([toBytes('data: one\n\ndata: two\n\ndata: three\n\n')])

    expect(parsed.map((event) => event.data)).toEqual(['one', 'two', 'three'])
    expect(parsed.every((event) => event.type === 'event')).toBe(true)
  })

  it('parses CRLF line endings the same as LF', () => {
    const lf = collect([toBytes('data: hello\ndata: world\n\n')]).parsed
    const crlf = collect([toBytes('data: hello\r\ndata: world\r\n\r\n')]).parsed

    expect(crlf).toHaveLength(1)
    expect(crlf[0].data).toBe('hello\nworld')
    expect(crlf[0].data).toBe(lf[0].data)
  })

  it('reassembles an incomplete line split across two feed() calls', () => {
    const parsed = []
    const parser = createParser((event) => parsed.push(event))

    parser.feed(toBytes('data: first\n\ndata: incom'))
    expect(parsed).toEqual([
      {
        type: 'event',
        id: undefined,
        event: undefined,
        data: 'first',
        extra: undefined,
      },
    ])

    parser.feed(toBytes('plete\n\n'))
    expect(parsed.map((event) => event.data)).toEqual(['first', 'incomplete'])
  })

  it('reassembles a UTF-8 multi-byte character split across chunks', () => {
    const stream = toBytes('data: 台灣🙂 café\n\n')
    const splitAt = [...stream].findIndex(
      (byte, index, bytes) => byte === 0xf0 && bytes[index + 1] === 0x9f,
    )
    expect(splitAt).toBeGreaterThan(0)

    const { parsed } = collect([stream.slice(0, splitAt + 2), stream.slice(splitAt + 2)])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('台灣🙂 café')
    expect(parsed[0].data.includes('\uFFFD')).toBe(false)
  })

  it('preserves UTF-8 data at every byte boundary', () => {
    const stream = toBytes('data: 台灣🙂 café\n\n')
    const expected = '台灣🙂 café'

    for (let split = 0; split <= stream.length; split += 1) {
      const { parsed } = collect([stream.slice(0, split), stream.slice(split)])
      expect(
        parsed.map((event) => event.data),
        `split at byte ${split}`,
      ).toEqual([expected])
    }
  })

  it('ignores a UTF-8 BOM on the first chunk', () => {
    const payload = toBytes('data: bom\n\n')
    const withBom = new Uint8Array(3 + payload.length)
    withBom.set([0xef, 0xbb, 0xbf], 0)
    withBom.set(payload, 3)

    const { parsed } = collect([withBom])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('bom')
  })

  it('parses id, event, data, and retry / reconnect-interval', () => {
    const { parsed } = collect([
      toBytes('retry: 1500\nevent: update\nid: msg-1\ndata: part-1\ndata: part-2\n\n'),
    ])

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ type: 'reconnect-interval', value: 1500 })
    expect(parsed[1]).toMatchObject({
      type: 'event',
      event: 'update',
      id: 'msg-1',
      data: 'part-1\npart-2',
    })
  })

  it('collects local meta fields into extra on the event', () => {
    const { parsed } = collect([toBytes('data: hello\nmeta: {"source":"ws"}\nmeta: {"seq":2}\n\n')])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('hello')
    expect(parsed[0].extra).toEqual([{ meta: { source: 'ws' } }, { meta: { seq: 2 } }])
  })

  it('accepts Uint8Array chunks rather than only strings', () => {
    const bytes = toBytes('data: from-bytes\n\n')
    expect(bytes).toBeInstanceOf(Uint8Array)

    const { parsed } = collect([bytes])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('from-bytes')
  })

  it('keeps a CRLF pair intact when it is split across feed() calls', () => {
    const { parsed } = collect([
      toBytes('data: hello\r'),
      toBytes('\ndata: world\r'),
      toBytes('\n\r'),
      toBytes('\n'),
    ])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('hello\nworld')
  })

  it('does not swallow an LF delimiter after mixed CRLF lines', () => {
    const { parsed } = collect([toBytes('data: a\r\ndata: b\n'), toBytes('\n')])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('a\nb')
  })

  it('does not swallow an LF delimiter when mixed CRLF lines arrive in one chunk', () => {
    const { parsed } = collect([toBytes('data: a\r\ndata: b\n\n')])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].data).toBe('a\nb')
  })

  it('reset() clears leftover buffer, extra/meta, and event state', () => {
    const parsed = []
    const parser = createParser((event) => parsed.push(event))

    parser.feed(toBytes('meta: {"source":"stale"}\nevent: leftover\nid: old\ndata: pending'))
    parser.reset()
    parser.feed(toBytes('data: clean\n\n'))

    expect(parsed).toEqual([
      {
        type: 'event',
        id: undefined,
        event: undefined,
        data: 'clean',
        extra: undefined,
      },
    ])
  })

  it('reset() discards pending decoder bytes from a split UTF-8 sequence', () => {
    const parsed = []
    const parser = createParser((event) => parsed.push(event))

    parser.feed(toBytes('🙂').slice(0, 2))
    parser.reset()
    parser.feed(toBytes('data: clean\n\n'))

    expect(parsed.map((event) => event.data)).toEqual(['clean'])
    expect(parsed[0].data.includes('\uFFFD')).toBe(false)
  })
})
