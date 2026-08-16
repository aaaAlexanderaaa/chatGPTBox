// Barrel re-export of the config module surface. Individual submodules:
//   constants.mjs  — enumerations
//   limits.mjs     — numeric DEFAULT_/MIN_/MAX_ bounds
//   models.mjs     — *ModelKeys, ModelGroups, Models table, accessors
//   predicates.mjs — isUsing*Model predicate functions
//   storage.mjs    — defaultConfig, getUserConfig, setUserConfig, tokens
//   migrations.mjs — legacy-shape tables + migrateArrayField
//
// New code should import from the specific submodule (e.g. '../config/storage').
// This barrel exists as a compatibility shim for the many existing imports that
// still use '../config'.

// From chatgpt-web thinking (re-export kept for backward compat).
export { CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS } from '../services/clients/chatgpt-web/thinking.mjs'

// constants.mjs
export {
  ModelStatus,
  ThemeMode,
  TriggerMode,
} from './constants.mjs'

// limits.mjs
export {
  CHATGPT_WEB_DEBUG_LOG_KEY,
  CHATGPT_WEB_DEFAULT_MODEL_KEY,
  CHATGPT_WEB_DEFAULT_MODEL_SLUG,
  CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
} from './limits.mjs'

// models.mjs
export {
  aimlApiModelKeys,
  AlwaysCustomGroups,
  azureOpenAiApiModelKeys,
  chatglmApiModelKeys,
  chatgptApiModelKeys,
  chatgptWebModelKeys,
  claudeApiModelKeys,
  CustomApiKeyGroups,
  customApiModelKeys,
  CustomUrlGroups,
  deepSeekApiModelKeys,
  DefaultActiveModelKeysByGroup,
  DefaultEnabledProviderGroups,
  DeprecatedModelKeys,
  getModelMeta,
  getModelProviderGroup,
  getModelStatus,
  gptApiModelKeys,
  grokWebModelKeys,
  isModelDeprecated,
  ModelGroups,
  Models,
  moonshotApiModelKeys,
  moonshotWebModelKeys,
  ollamaApiModelKeys,
  openRouterApiModelKeys,
} from './models.mjs'

// grok-web.mjs
export {
  GROK_WEB_SLUGS,
  grokSlugToModelKey,
  grokWebApiModesForAccount,
  isGrokChatSlug,
  pickDefaultGrokWebKey,
  slugsForGrokWebTier,
} from './grok-web.mjs'

// predicates.mjs
export {
  isUsingAimlApiModel,
  isUsingAzureOpenAiApiModel,
  isUsingChatGLMApiModel,
  isUsingChatgptApiModel,
  isUsingChatgptWebModel,
  isUsingClaudeApiModel,
  isUsingCustomModel,
  isUsingDeepSeekApiModel,
  isUsingGptCompletionApiModel,
  isUsingGrokWebModel,
  isUsingMoonshotApiModel,
  isUsingMoonshotWebModel,
  isUsingOllamaApiModel,
  isUsingOpenAiApiModel,
  isUsingOpenRouterApiModel,
} from './predicates.mjs'

// storage.mjs
export {
  clearOldAccessToken,
  defaultConfig,
  getNavigatorLanguage,
  getPreferredLanguageKey,
  getUserConfig,
  setAccessToken,
  setUserConfig,
} from './storage.mjs'
