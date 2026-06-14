// Authoritative definitions of AgentProtocol + normalizeAgentProtocol live in
// config/constants.mjs (so config does not depend on services). This module
// imports them for services/ callers and adds its own resolveOpenAiCompatibleProtocol.
import { AgentProtocol, normalizeAgentProtocol } from '../../config/constants.mjs'

export { AgentProtocol, normalizeAgentProtocol }

const OPENAI_COMPATIBLE_PROTOCOLS = new Set([
  AgentProtocol.openAiChatCompletionsV1,
  AgentProtocol.openAiResponsesV1,
])

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
