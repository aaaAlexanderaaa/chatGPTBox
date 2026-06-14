/* global __CHATGPTBOX_ENABLE_AGENTS__ */

// Enumerations, feature-flag, and built-in id constants used across config,
// storage migrations, and provider predicates. Pure data — no imports.

export const ENABLE_AGENT_FEATURES =
  typeof __CHATGPTBOX_ENABLE_AGENTS__ !== 'undefined' && __CHATGPTBOX_ENABLE_AGENTS__ === true

export const TriggerMode = {
  always: 'Always',
  questionMark: 'When query ends with question mark (?)',
  manually: 'Manually',
}

export const ThemeMode = {
  light: 'Light',
  dark: 'Dark',
  auto: 'Auto',
}

export const ModelMode = {
  balanced: 'Balanced',
  creative: 'Creative',
  precise: 'Precise',
  fast: 'Fast',
}

export const ModelStatus = {
  active: 'active',
  deprecated: 'deprecated',
}

export const RuntimeMode = {
  safe: 'safe',
  developer: 'developer',
}

// Agent protocol negotiation. Authoritative home is config (no services
// dependency); services/agent/protocols.mjs re-exports these.
export const AgentProtocol = {
  auto: 'auto',
  openAiChatCompletionsV1: 'openai_chat_completions_v1',
  openAiResponsesV1: 'openai_responses_v1',
  anthropicMessagesV1: 'anthropic_messages_v1',
}

export function normalizeAgentProtocol(value, fallback = AgentProtocol.auto) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return fallback
  return Object.values(AgentProtocol).includes(normalized) ? normalized : fallback
}

export const BUILTIN_DESIGN_ASSISTANT_ID = ENABLE_AGENT_FEATURES
  ? 'builtin-assistant-design-analyst'
  : ''

const BuiltInSkillIds = ENABLE_AGENT_FEATURES
  ? {
      analyzeWebDesignPatterns: 'builtin-skill-analyze-web-design-patterns',
    }
  : {}

const BuiltInAssistantIds = ENABLE_AGENT_FEATURES
  ? {
      designAssistant: BUILTIN_DESIGN_ASSISTANT_ID,
    }
  : {}

const BuiltInMcpServerIds = ENABLE_AGENT_FEATURES
  ? {
      skillLibrary: 'mcp-builtin-skill-library',
      browserContextToolkit: 'mcp-builtin-browser-context-toolkit',
    }
  : {}

// Exposed for storage migrations (legacy design-defaults cleanup) and for
// defaultConfig seeding. Not part of the public config surface.
export const BuiltInIds = {
  skill: BuiltInSkillIds,
  assistant: BuiltInAssistantIds,
  mcpServer: BuiltInMcpServerIds,
}
