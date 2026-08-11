// OpenAI Responses protocol adapter (architecture plan step 7).
//
// Pure, stateless shaping for the openai_responses_v1 protocol. The responses
// API uses a different input shape (input/instructions instead of messages,
// function_call output items instead of tool_calls), so the conversion is
// non-trivial — exactly the kind of protocol detail the loop shouldn't carry.

import { extractAssistantContent } from './_shared.mjs'

// Convert a chat-style messages log into the responses API's
// { input, instructions } shape. System messages collapse into `instructions`;
// User messages use `input_text`; assistant turns must use `output_text`.
export function convertMessagesToResponsesInput(messages) {
  const input = []
  let instructions = ''

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || '')
    const content = extractAssistantContent(message)
    if (!content) continue

    if (role === 'system') {
      instructions = instructions ? `${instructions}\n\n${content}` : content
      continue
    }

    if (role === 'user' || role === 'assistant') {
      input.push({
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content }],
      })
    }
  }

  return { input, instructions }
}

// The responses API tool shape is { type:'function', name, description,
// parameters } — flatter than chat's { function: {...} } wrapper.
export function buildResponsesToolCatalog(catalogTools) {
  return (Array.isArray(catalogTools) ? catalogTools : []).map((tool) => ({
    type: 'function',
    name: tool?.function?.name,
    description: tool?.function?.description || '',
    parameters: tool?.function?.parameters,
  }))
}

// Prefer payload.output_text; fall back to scanning output[].message parts.
export function extractResponsesAnswer(payload) {
  const outputText = typeof payload?.output_text === 'string' ? payload.output_text.trim() : ''
  if (outputText) return outputText

  const output = Array.isArray(payload?.output) ? payload.output : []
  const lines = []

  for (const item of output) {
    if (item?.type !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) lines.push(part.text)
      if (typeof part?.output_text === 'string' && part.output_text.trim())
        lines.push(part.output_text)
    }
  }

  return lines.join('\n').trim()
}

// Normalize the responses `function_call` output items into the canonical
// { id, function:{ name, arguments } } shape the loop expects.
export function extractResponsesToolCalls(payload) {
  const toolCalls = []
  const output = Array.isArray(payload?.output) ? payload.output : []

  for (const item of output) {
    if (item?.type !== 'function_call') continue
    const name = String(item.name || item.function?.name || '').trim()
    if (!name) continue
    const id = String(item.call_id || item.id || `${name}_${toolCalls.length + 1}`)

    let argumentsText = '{}'
    if (typeof item.arguments === 'string') argumentsText = item.arguments
    else if (item.arguments && typeof item.arguments === 'object') {
      try {
        argumentsText = JSON.stringify(item.arguments)
      } catch {
        argumentsText = '{}'
      }
    }

    toolCalls.push({
      id,
      function: {
        name,
        arguments: argumentsText,
      },
    })
  }

  return toolCalls
}
