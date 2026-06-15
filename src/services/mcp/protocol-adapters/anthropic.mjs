// Anthropic Messages protocol adapter (architecture plan step 7).
//
// Pure, stateless shaping for the anthropic_messages_v1 protocol. Anthropic's
// tool shape ({ name, description, input_schema }) and tool-call extraction
// (tool_use blocks) differ from both OpenAI flavors.

import { normalizeToolSchema } from './_shared.mjs'

// Anthropic uses input_schema instead of parameters, at the top level rather
// than nested under `function`.
export function toAnthropicTools(catalogTools) {
  return (Array.isArray(catalogTools) ? catalogTools : []).map((tool) => ({
    name: tool?.function?.name,
    description: tool?.function?.description || '',
    input_schema: normalizeToolSchema(tool?.function?.parameters),
  }))
}

// Anthropic returns text blocks in payload.content with type === 'text'.
export function extractAnthropicAnswer(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

// Anthropic tool calls arrive as tool_use content blocks. Normalize to the
// canonical { id, function:{ name, arguments }, raw } shape the loop expects;
// `raw` is retained so the loop can rebuild the assistant turn verbatim when
// it reassembles a follow-up that includes tool results.
export function extractAnthropicToolCalls(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  return blocks
    .filter((block) => block?.type === 'tool_use' && block?.name)
    .map((block) => ({
      id: String(block.id || `${block.name}_${Math.random().toString(16).slice(2, 6)}`),
      function: {
        name: String(block.name || ''),
        arguments:
          typeof block.input === 'string'
            ? block.input
            : (() => {
                try {
                  return JSON.stringify(block.input || {})
                } catch {
                  return '{}'
                }
              })(),
      },
      raw: block,
    }))
}
