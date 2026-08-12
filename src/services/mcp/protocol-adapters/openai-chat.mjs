// OpenAI Chat Completions protocol adapter (architecture plan step 7).
//
// Pure, stateless shaping for the openai_chat_completions_v1 protocol. The
// tool-loop calls these instead of inlining chat-specific logic; the transport
// (postJson), state machine, and memory updates stay in the loop.

import { extractAssistantContent } from './_shared.mjs'

// Chat sends the OpenAI-shaped tool catalog through verbatim — no transform.
export function buildChatToolCatalog(catalogTools) {
  return Array.isArray(catalogTools) ? catalogTools : []
}

// Pull the assistant message out of a chat-completions response.
export function extractChatMessage(payload) {
  return payload?.choices?.[0]?.message
}

// Read the assistant's text answer. Chat carries it in message.content.
export function extractChatAnswer(message) {
  return extractAssistantContent(message)
}

// Chat carries tool calls as message.tool_calls in OpenAI's canonical shape,
// so this is (almost) a passthrough — it normalizes id/arguments to strings.
export function extractChatToolCalls(message) {
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  return calls.map((call) => {
    const name = String(call?.function?.name || '')
    const id = String(call?.id || `${name}_${Math.random().toString(16).slice(2, 6)}`)
    const args =
      typeof call?.function?.arguments === 'string'
        ? call.function.arguments
        : (() => {
            try {
              return JSON.stringify(call?.function?.arguments || {})
            } catch {
              return '{}'
            }
          })()
    return { id, function: { name, arguments: args } }
  })
}
