// OpenAI-compatible protocol negotiation for Custom API endpoints.
//
// Custom API URLs that point at a `/responses` endpoint are spoken to with the
// OpenAI Responses API instead of Chat Completions. This used to live in the
// agent runtime (services/agent/protocols.mjs); it is a plain Custom-API
// capability, so it survives here as a small standalone module.

export const AgentProtocol = {
  auto: 'auto',
  openAiChatCompletionsV1: 'openai_chat_completions_v1',
  openAiResponsesV1: 'openai_responses_v1',
}

export function resolveOpenAiCompatibleProtocol(apiUrl = '') {
  const url = String(apiUrl || '').toLowerCase()
  if (url.includes('/responses')) return AgentProtocol.openAiResponsesV1
  return AgentProtocol.openAiChatCompletionsV1
}
