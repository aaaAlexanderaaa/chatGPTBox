import { describe, expect, it } from 'vitest'
import {
  convertMessagesToResponsesInput,
  extractResponsesOutputText,
  resolveResponsesEndpoint,
} from '../src/services/apis/openai-responses-shared.mjs'

describe('convertMessagesToResponsesInput', () => {
  it('uses output_text for assistant turns and input_text for user turns', () => {
    const { input } = convertMessagesToResponsesInput([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'follow-up' },
    ])

    expect(input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'first question' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'first answer' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'follow-up' }] },
    ])
  })

  it('collects system messages into instructions', () => {
    const { input, instructions } = convertMessagesToResponsesInput([
      { role: 'system', content: 'be brief' },
      { role: 'system', content: 'be kind' },
      { role: 'user', content: 'hi' },
    ])

    expect(instructions).toBe('be brief\n\nbe kind')
    expect(input).toHaveLength(1)
  })

  it('skips empty and unknown roles', () => {
    const { input } = convertMessagesToResponsesInput([
      { role: 'user', content: '   ' },
      { role: 'tool', content: 'ignored' },
    ])

    expect(input).toEqual([])
  })
})

describe('extractResponsesOutputText', () => {
  it('prefers a top-level output_text', () => {
    expect(extractResponsesOutputText({ output_text: ' hello ' })).toBe('hello')
  })

  it('falls back to message content parts', () => {
    const payload = {
      output: [{ type: 'message', content: [{ text: 'part one' }, { text: 'part two' }] }],
    }
    expect(extractResponsesOutputText(payload)).toBe('part one\npart two')
  })
})

describe('resolveResponsesEndpoint', () => {
  it('appends /responses once', () => {
    expect(resolveResponsesEndpoint('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/responses',
    )
    expect(resolveResponsesEndpoint('https://api.example.com/v1/responses')).toBe(
      'https://api.example.com/v1/responses',
    )
  })

  it('returns empty string for empty input', () => {
    expect(resolveResponsesEndpoint('')).toBe('')
  })
})
