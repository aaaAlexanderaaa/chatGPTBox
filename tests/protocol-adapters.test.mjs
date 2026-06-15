import { describe, expect, it } from 'vitest'

// Unit tests for the MCP protocol adapters (architecture plan step 7).
//
// The adapters are the per-protocol shaping logic (tool-catalog format,
// request body, answer extraction, tool-call extraction) extracted out of
// services/mcp/tool-loop.mjs. They are PURE functions — no transport, no state
// — so each protocol's happy path is verifiable without a network or a browser.
// The tool-loop's job is now orchestration + memory; protocol specifics live
// here.

import {
  normalizeToolSchema,
  extractAssistantContent,
} from '../src/services/mcp/protocol-adapters/_shared.mjs'
import {
  buildChatToolCatalog,
  extractChatAnswer,
  extractChatMessage,
  extractChatToolCalls,
} from '../src/services/mcp/protocol-adapters/openai-chat.mjs'
import {
  convertMessagesToResponsesInput,
  buildResponsesToolCatalog,
  extractResponsesAnswer,
  extractResponsesToolCalls,
} from '../src/services/mcp/protocol-adapters/openai-responses.mjs'
import {
  toAnthropicTools,
  extractAnthropicAnswer,
  extractAnthropicToolCalls,
} from '../src/services/mcp/protocol-adapters/anthropic.mjs'

describe('shared: normalizeToolSchema', () => {
  it('adds a default object type when missing', () => {
    expect(normalizeToolSchema({ properties: { a: {} } })).toEqual({
      properties: { a: {} },
      type: 'object',
    })
  })

  it('leaves an explicit type untouched', () => {
    const schema = { type: 'string' }
    expect(normalizeToolSchema(schema)).toBe(schema)
  })

  it('returns a minimal object schema for null/garbage input', () => {
    expect(normalizeToolSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(normalizeToolSchema(undefined)).toEqual({ type: 'object', properties: {} })
  })
})

describe('shared: extractAssistantContent', () => {
  it('returns string content verbatim', () => {
    expect(extractAssistantContent({ content: 'hi' })).toBe('hi')
  })

  it('joins array content of text/output_text parts', () => {
    expect(
      extractAssistantContent({ content: [{ text: 'a' }, { output_text: 'b' }, 'c', { x: 1 }] }),
    ).toBe('abc')
  })

  it('returns empty string for missing content', () => {
    expect(extractAssistantContent({})).toBe('')
    expect(extractAssistantContent(null)).toBe('')
  })
})

describe('openai-chat adapter', () => {
  it('passes the catalog through as-is', () => {
    const tools = [{ function: { name: 't' } }]
    expect(buildChatToolCatalog(tools)).toBe(tools)
    expect(buildChatToolCatalog(undefined)).toEqual([])
  })

  it('extracts the assistant message from choices[0]', () => {
    expect(extractChatMessage({ choices: [{ message: { role: 'assistant' } }] })).toEqual({
      role: 'assistant',
    })
    expect(extractChatMessage({ choices: [] })).toBeUndefined()
    expect(extractChatMessage({})).toBeUndefined()
  })

  it('reads a string answer', () => {
    expect(extractChatAnswer({ content: 'hello' })).toBe('hello')
  })

  it('flattens array content to text', () => {
    expect(extractChatAnswer({ content: [{ text: 'a ' }, { text: 'b' }] })).toBe('a b')
  })

  it('normalizes tool_calls to {id, function:{name, arguments}}', () => {
    const calls = extractChatToolCalls({
      tool_calls: [
        { id: 'c1', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
        { function: { name: 'no_args' } }, // missing id + string args
        { function: { name: 'obj_args', arguments: { x: 1 } } }, // object args
      ],
    })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({
      id: 'c1',
      function: { name: 'get_weather', arguments: '{"city":"SF"}' },
    })
    expect(calls[1].id).toMatch(/^no_args_/) // synthesized id
    expect(calls[1].function.arguments).toBe('{}')
    expect(calls[2].function.arguments).toBe('{"x":1}')
  })

  it('returns an empty array when there are no tool_calls', () => {
    expect(extractChatToolCalls({})).toEqual([])
    expect(extractChatToolCalls({ tool_calls: [] })).toEqual([])
  })
})

describe('openai-responses adapter', () => {
  it('collapses system messages into instructions and wraps user/assistant into input_text', () => {
    const { input, instructions } = convertMessagesToResponsesInput([
      { role: 'system', content: 'be brief' },
      { role: 'system', content: 'and kind' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: '' }, // dropped: empty content
    ])
    expect(instructions).toBe('be brief\n\nand kind')
    expect(input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'input_text', text: 'hello' }] },
    ])
  })

  it('reshapes the tool catalog to flat {type,name,description,parameters}', () => {
    const out = buildResponsesToolCatalog([
      { function: { name: 't', description: 'd', parameters: { type: 'object' } } },
    ])
    expect(out).toEqual([
      { type: 'function', name: 't', description: 'd', parameters: { type: 'object' } },
    ])
  })

  it('prefers output_text for the answer', () => {
    expect(extractResponsesAnswer({ output_text: '  hi  ' })).toBe('hi')
  })

  it('falls back to scanning output message parts', () => {
    const payload = {
      output: [
        { type: 'other' },
        { type: 'message', content: [{ text: 'a' }, { output_text: 'b' }, { foo: 1 }] },
      ],
    }
    expect(extractResponsesAnswer(payload)).toBe('a\nb')
  })

  it('extracts function_call output items into canonical tool calls', () => {
    const payload = {
      output: [
        { type: 'function_call', call_id: 'fc1', name: 'search', arguments: '{"q":"x"}' },
        { type: 'function_call', name: 'obj', arguments: { a: 1 } },
        { type: 'other' },
      ],
    }
    const calls = extractResponsesToolCalls(payload)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ id: 'fc1', function: { name: 'search', arguments: '{"q":"x"}' } })
    expect(calls[1].function.arguments).toBe('{"a":1}')
  })
})

describe('anthropic adapter', () => {
  it('reshapes the catalog to {name, description, input_schema}', () => {
    const out = toAnthropicTools([
      { function: { name: 't', description: 'd', parameters: { properties: { a: {} } } } },
      { function: { name: 'u' } }, // missing description/parameters
    ])
    expect(out[0]).toEqual({
      name: 't',
      description: 'd',
      input_schema: { properties: { a: {} }, type: 'object' },
    })
    expect(out[1]).toEqual({
      name: 'u',
      description: '',
      input_schema: { type: 'object', properties: {} },
    })
  })

  it('joins text blocks for the answer', () => {
    const payload = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ],
    }
    expect(extractAnthropicAnswer(payload)).toBe('Hello world')
  })

  it('extracts tool_use blocks, serializing input to JSON and retaining raw', () => {
    const payload = {
      content: [
        { type: 'text', text: 'thinking...' },
        { type: 'tool_use', id: 'tu1', name: 'search', input: { q: 'x' } },
        { type: 'tool_use', name: 'string_input', input: '{"raw":true}' }, // missing id
      ],
    }
    const calls = extractAnthropicToolCalls(payload)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      id: 'tu1',
      function: { name: 'search', arguments: '{"q":"x"}' },
      raw: payload.content[1],
    })
    expect(calls[1].id).toMatch(/^string_input_/) // synthesized id
    expect(calls[1].function.arguments).toBe('{"raw":true}') // string input preserved
    expect(calls[1].raw).toBe(payload.content[2])
  })

  it('returns empty arrays when content is absent', () => {
    expect(extractAnthropicToolCalls({})).toEqual([])
    expect(extractAnthropicAnswer({})).toBe('')
  })
})
