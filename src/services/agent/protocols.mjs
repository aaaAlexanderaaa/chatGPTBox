export const AgentProtocol = {
  auto: 'auto',
  openAiChatCompletionsV1: 'openai_chat_completions_v1',
  openAiResponsesV1: 'openai_responses_v1',
  anthropicMessagesV1: 'anthropic_messages_v1',
}

const OPENAI_COMPATIBLE_PROTOCOLS = new Set([
  AgentProtocol.openAiChatCompletionsV1,
  AgentProtocol.openAiResponsesV1,
])

export function normalizeAgentProtocol(value, fallback = AgentProtocol.auto) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return fallback
  return Object.values(AgentProtocol).includes(normalized) ? normalized : fallback
}

export function resolveOpenAiCompatibleProtocol(apiUrl = '', preference = AgentProtocol.auto) {
  const normalizedPreference = normalizeAgentProtocol(preference, AgentProtocol.auto)
  if (normalizedPreference !== AgentProtocol.auto) {
    if (OPENAI_COMPATIBLE_PROTOCOLS.has(normalizedPreference)) {
      return normalizedPreference
    }
    return AgentProtocol.openAiChatCompletionsV1
  }

  const url = String(apiUrl || '').toLowerCase()
  if (url.includes('/responses')) return AgentProtocol.openAiResponsesV1
  return AgentProtocol.openAiChatCompletionsV1
}
