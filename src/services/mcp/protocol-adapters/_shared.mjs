// Shared helpers for the protocol adapters (architecture plan step 7).
//
// The tool-loop used to inline three families of protocol-specific helpers
// (openai-chat / openai-responses / anthropic). The PURE, stateless ones —
// request-body shaping, answer extraction, tool-call extraction — are
// extracted into sibling adapter modules so they are unit-testable in
// isolation and so a future protocol (e.g. Gemini function calling) only
// adds one adapter file.
//
// This file holds the two tiny pure functions every adapter shares, kept out
// of the loop so adapters don't reach back into tool-loop.mjs.

// Ensure a JSON-schema-like object always has a `type` (Anthropic input_schema
// wants an explicit object type; OpenAI tolerates its absence).
export function normalizeToolSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} }
  }
  if (schema.type) return schema
  return { ...schema, type: 'object' }
}

// Flatten a message's `content` (string or array of text/output_text parts)
// into a single string. Used by the responses adapter when converting the
// chat-style message log into the responses API's input shape.
export function extractAssistantContent(message) {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part.text === 'string') return part.text
        if (part && typeof part.output_text === 'string') return part.output_text
        return ''
      })
      .join('')
  }
  return ''
}
