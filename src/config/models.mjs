import { ModelStatus } from './constants.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from './limits.mjs'

// Provider model-key arrays, group metadata, the Models table, and accessors.
// Predicates (isUsing*Model) live in predicates.mjs and consume the arrays
// exported here.

// Chat / Latest picker (`GET /models`). Default stays 5.6 Thinking; Pro is listed but not default.
export const chatgptWebChatModelKeys = [
  'chatgptWeb56Thinking',
  'chatgptWeb56Auto',
  'chatgptWeb56Instant',
  'chatgptWeb6Pro',
  'chatgptWeb56Pro',
  'chatgptWeb56TMini',
  'chatgptWeb56Mini',
  'chatgptWeb55Thinking',
  'chatgptWeb55Auto',
  'chatgptWeb55Instant',
  'chatgptWeb55Pro',
  'chatgptWeb55Mini',
]

// ChatGPT Work / TPP picker (`GET /tpp/models/`, is_work_mode_model, *-wm slugs).
export const chatgptWebWorkModelKeys = [
  'chatgptWeb6AstraWork',
  'chatgptWeb56SolWork',
  'chatgptWeb56TerraWork',
  'chatgptWeb56LunaWork',
  'chatgptWeb55Work',
]

export const chatgptWebLegacyModelKeys = [
  'chatgptWeb54Thinking',
  'chatgptWeb54Auto',
  'chatgptWeb54Instant',
  'chatgptWeb54Pro',
  'chatgptWeb53Thinking',
  'chatgptWeb53Auto',
  'chatgptWeb53Instant',
  'chatgptWeb52Thinking',
  'chatgptWeb52Auto',
  'chatgptWeb52Instant',
  'chatgptWeb52Pro',
  'chatgptWeb51Thinking',
  'chatgptWeb51Auto',
  'chatgptWeb51Instant',
  'chatgptWeb51Pro',

  // legacy presets kept for migration compatibility
  'chatgptFree35',
  'chatgptFree4o',
  'chatgptFree4oMini',
  'chatgptPlus4',
  'chatgptFree35Mobile',
  'chatgptPlus4Browsing',
  'chatgptPlus4Mobile',
]

export const chatgptWebModelKeys = [
  ...chatgptWebChatModelKeys,
  ...chatgptWebWorkModelKeys,
  ...chatgptWebLegacyModelKeys,
]
export const moonshotWebModelKeys = [
  'moonshotWebFree',
  'moonshotWebFreeK15',
  'moonshotWebFreeK15Think',
]
export const grokWebModelKeys = [
  'grokWebFast',
  'grokWebAuto',
  'grokWebExpert',
  'grokWebHeavy',
]
export const gptApiModelKeys = ['gptApiInstruct', 'gptApiDavinci']
export const chatgptApiModelKeys = [
  'chatgptApi35',
  'chatgptApi35_16k',
  'chatgptApi35_1106',
  'chatgptApi35_0125',
  'chatgptApi4o_128k',
  'chatgptApi4oLatest',
  'chatgptApi5Latest',
  'chatgptApi4oMini',
  'chatgptApi4_8k',
  'chatgptApi4_8k_0613',
  'chatgptApi4_32k',
  'chatgptApi4_32k_0613',
  'chatgptApi4_128k',
  'chatgptApi4_128k_preview',
  'chatgptApi4_128k_1106_preview',
  'chatgptApi4_128k_0125_preview',
  'chatgptApi4_1',
  'chatgptApi4_1_mini',
  'chatgptApi4_1_nano',
  'chatgptApiO4Mini',
  'chatgptApiGpt5',
  'chatgptApiGpt5Mini',
  'chatgptApiGpt5Nano',
  'chatgptApi5_1Latest',
  'chatgptApi5_1',
  'chatgptApi5_2Latest',
  'chatgptApi5_2',
  'chatgptApi5_3Latest',
  'chatgptApi5_4',
  'chatgptApiGpt6Astra',
]
export const customApiModelKeys = ['customModel']
export const ollamaApiModelKeys = ['ollamaModel']
export const azureOpenAiApiModelKeys = ['azureOpenAi']
export const claudeApiModelKeys = [
  'claude12Api',
  'claude2Api',
  'claude21Api',
  'claude3HaikuApi',
  'claude3SonnetApi',
  'claude3OpusApi',
  'claude35SonnetApi',
  'claude35HaikuApi',
  'claude37SonnetApi',
  'claudeOpus4Api',
  'claudeOpus41Api',
  'claudeSonnet4Api',
  'claudeSonnet45Api',
  'claudeHaiku45Api',
  'claudeOpus45Api',
  'claudeOpus46Api',
]
export const chatglmApiModelKeys = ['chatglmTurbo', 'chatglm4', 'chatglmEmohaa', 'chatglmCharGLM3']
export const moonshotApiModelKeys = [
  'moonshot_k2',
  'moonshot_kimi_latest',
  'moonshot_v1_8k',
  'moonshot_v1_32k',
  'moonshot_v1_128k',
]
export const deepSeekApiModelKeys = ['deepseek_chat', 'deepseek_reasoner']
export const openRouterApiModelKeys = [
  'openRouter_anthropic_claude_sonnet4',
  'openRouter_anthropic_claude_sonnet4_5',
  'openRouter_anthropic_claude_haiku4_5',
  'openRouter_anthropic_claude_3_7_sonnet',
  'openRouter_google_gemini_2_5_pro',
  'openRouter_google_gemini_2_5_flash',
  'openRouter_openai_o3',
  'openRouter_openai_gpt_4_1_mini',
  'openRouter_deepseek_deepseek_chat_v3_0324_free',
  'openRouter_anthropic_claude_opus4_5',
  'openRouter_anthropic_claude_opus4_6',
  'openRouter_google_gemini_3_pro',
  'openRouter_google_gemini_3_flash',
  'openRouter_google_gemini_3_1_pro',
]
export const aimlApiModelKeys = [
  'aiml_anthropic_claude_opus_4',
  'aiml_anthropic_claude_sonnet_4',
  'aiml_anthropic_claude_sonnet_4_5',
  'aiml_anthropic_claude_opus_4_1',
  'aiml_claude_3_7_sonnet_20250219',
  'aiml_google_gemini_2_5_pro_preview_05_06',
  'aiml_google_gemini_2_5_flash_preview',
  'aiml_openai_o3_2025_04_16',
  'aiml_openai_gpt_4_1_2025_04_14',
  'aiml_deepseek_deepseek_chat',
  'aiml_moonshot_kimi_k2_preview',
]

export const dshHarnessModelKeys = ['dshHarnessAgent']

// The picker entry for the dsh engine. Not part of activeApiModes (that
// array belongs to the user's directory); surfaces append this option
// whenever the module is enabled instead.
export const DSH_HARNESS_API_MODE = Object.freeze({
  groupName: 'dshHarnessModelKeys',
  itemName: 'dshHarnessAgent',
  isCustom: false,
  displayName: '',
  customName: '',
  customUrl: '',
  apiKey: '',
  active: true,
})

export const AlwaysCustomGroups = [
  'ollamaApiModelKeys',
  'customApiModelKeys',
  'azureOpenAiApiModelKeys',
]
export const CustomUrlGroups = ['customApiModelKeys']
export const CustomApiKeyGroups = ['customApiModelKeys']
export const ModelGroups = {
  chatgptWebModelKeys: {
    value: chatgptWebModelKeys,
    desc: 'ChatGPT (Web)',
  },
  moonshotWebModelKeys: {
    value: moonshotWebModelKeys,
    desc: 'Kimi.Moonshot (Web)',
  },
  grokWebModelKeys: {
    value: grokWebModelKeys,
    desc: 'Grok (Web)',
  },

  chatgptApiModelKeys: {
    value: chatgptApiModelKeys,
    desc: 'ChatGPT (API)',
  },
  claudeApiModelKeys: {
    value: claudeApiModelKeys,
    desc: 'Claude.ai (API)',
  },
  moonshotApiModelKeys: {
    value: moonshotApiModelKeys,
    desc: 'Kimi.Moonshot (API)',
  },
  chatglmApiModelKeys: {
    value: chatglmApiModelKeys,
    desc: 'ChatGLM (API)',
  },
  ollamaApiModelKeys: {
    value: ollamaApiModelKeys,
    desc: 'Ollama (API)',
  },
  azureOpenAiApiModelKeys: {
    value: azureOpenAiApiModelKeys,
    desc: 'ChatGPT (Azure API)',
  },
  gptApiModelKeys: {
    value: gptApiModelKeys,
    desc: 'GPT Completion (API)',
  },
  deepSeekApiModelKeys: {
    value: deepSeekApiModelKeys,
    desc: 'DeepSeek (API)',
  },
  openRouterApiModelKeys: {
    value: openRouterApiModelKeys,
    desc: 'OpenRouter (API)',
  },
  aimlModelKeys: {
    value: aimlApiModelKeys,
    desc: 'AI/ML (API)',
  },
  customApiModelKeys: {
    value: customApiModelKeys,
    desc: 'Custom Model',
  },
  dshHarnessModelKeys: {
    value: dshHarnessModelKeys,
    desc: 'DeepSeek Harness (agent)',
  },
}

export const DefaultEnabledProviderGroups = {
  chatgptWebModelKeys: true,
  chatgptApiModelKeys: true,
  customApiModelKeys: true,

  // Everything else is Advanced-only by default.
  moonshotWebModelKeys: false,
  claudeApiModelKeys: false,
  moonshotApiModelKeys: false,
  chatglmApiModelKeys: false,
  ollamaApiModelKeys: false,
  azureOpenAiApiModelKeys: false,
  gptApiModelKeys: false,
  deepSeekApiModelKeys: false,
  openRouterApiModelKeys: false,
  aimlModelKeys: false,
}

export const DefaultActiveModelKeysByGroup = {
  chatgptWebModelKeys: [CHATGPT_WEB_DEFAULT_MODEL_KEY],
  chatgptApiModelKeys: ['chatgptApi5_4'],
}

export const DeprecatedModelKeys = [
  // Older ChatGPT Web chat lanes no longer in the Latest picker
  'chatgptWeb54Thinking',
  'chatgptWeb54Auto',
  'chatgptWeb54Instant',
  'chatgptWeb54Pro',
  'chatgptWeb53Thinking',
  'chatgptWeb53Auto',
  'chatgptWeb53Instant',
  'chatgptWeb52Thinking',
  'chatgptWeb52Auto',
  'chatgptWeb52Instant',
  'chatgptWeb52Pro',
  'chatgptWeb51Thinking',
  'chatgptWeb51Auto',
  'chatgptWeb51Instant',
  'chatgptWeb51Pro',

  // ChatGPT Web legacy presets
  'chatgptFree35',
  'chatgptFree4o',
  'chatgptFree4oMini',
  'chatgptPlus4',
  'chatgptPlus4Browsing',
  'chatgptPlus4Mobile',
  'chatgptFree35Mobile',

  // OpenAI API legacy models
  'chatgptApi35',
  'chatgptApi35_16k',
  'chatgptApi35_1106',
  'chatgptApi35_0125',
  'chatgptApi4o_128k',
  'chatgptApi4oMini',
  'chatgptApi4oLatest',
  'chatgptApi4_8k',
  'chatgptApi4_8k_0613',
  'chatgptApi4_32k',
  'chatgptApi4_32k_0613',
  'chatgptApi4_128k',
  'chatgptApi4_128k_preview',
  'chatgptApi4_128k_1106_preview',
  'chatgptApi4_128k_0125_preview',
  'chatgptApi4_1',
  'chatgptApi4_1_mini',
  'chatgptApi4_1_nano',
  'chatgptApiGpt5',
  'chatgptApiGpt5Mini',
  'chatgptApiGpt5Nano',

  'chatgptApiO4Mini',

  // OpenAI legacy completion models
  'gptApiInstruct',
  'gptApiDavinci',

  // Removed web-scraper providers (Poe / Bing / Bard / Claude web) and the
  // legacy waylaidwanderer third-party bridge. The upstream endpoints are
  // gone; stored selections are migrated away at load.
  'poeAiWebSage',
  'poeAiWebGPT4',
  'poeAiWebGPT4_32k',
  'poeAiWebClaudePlus',
  'poeAiWebClaude',
  'poeAiWebClaude100k',
  'poeAiWebCustom',
  'poeAiWebChatGpt',
  'poeAiWebChatGpt_16k',
  'poeAiWebGooglePaLM',
  'poeAiWeb_Llama_2_7b',
  'poeAiWeb_Llama_2_13b',
  'poeAiWeb_Llama_2_70b',
  'bingFree4',
  'bingFreeSydney',
  'bardWebFree',
  'claude2WebFree',
  'waylaidwandererApi',

  // Anthropic Claude legacy models (example: Claude Sonnet 3.5)
  'claude12Api',
  'claude2Api',
  'claude21Api',
  'claude35SonnetApi',
  'claude35HaikuApi',
]

const deprecatedModelKeySet = new Set(DeprecatedModelKeys)

function getModelKeyBase(modelName) {
  if (!modelName) return modelName
  if (modelName.includes('-')) return modelName.split('-')[0]
  return modelName
}

export function getModelStatus(modelName) {
  const base = getModelKeyBase(modelName)
  return deprecatedModelKeySet.has(base) ? ModelStatus.deprecated : ModelStatus.active
}

export function isModelDeprecated(modelName) {
  return getModelStatus(modelName) === ModelStatus.deprecated
}

export function getModelProviderGroup(modelName) {
  const base = getModelKeyBase(modelName)
  if (base in ModelGroups) return base
  const found = Object.entries(ModelGroups).find(([, group]) => group.value.includes(base))
  if (!found) return null
  const [groupName] = found
  return groupName
}

export function getModelMeta(modelName) {
  const providerGroup = getModelProviderGroup(modelName)
  const status = getModelStatus(modelName)
  return {
    status,
    providerGroup,
    tags: [
      providerGroup === 'chatgptWebModelKeys' || providerGroup === 'chatgptApiModelKeys'
        ? 'official-openai'
        : providerGroup === 'customApiModelKeys' || providerGroup === 'azureOpenAiApiModelKeys'
        ? 'openai-compatible'
        : providerGroup === 'ollamaApiModelKeys'
        ? 'local'
        : 'third-party',
    ],
  }
}

/**
 * @typedef {object} Model
 * @property {string} value
 * @property {string} desc
 */
/**
 * @type {Object.<string,Model>}
 */
export const Models = {
  grokWebFast: { value: 'grok-chat-fast', desc: 'Grok (Web, Fast)' },
  grokWebAuto: { value: 'grok-chat-auto', desc: 'Grok (Web, Auto)' },
  grokWebExpert: { value: 'grok-chat-expert', desc: 'Grok (Web, Expert)' },
  grokWebHeavy: { value: 'grok-chat-heavy', desc: 'Grok (Web, Heavy)' },

  chatgptWeb6Pro: { value: 'gpt-6-pro', desc: 'ChatGPT (Web, GPT-6 Pro)' },
  chatgptWeb56Thinking: { value: 'gpt-5-6-thinking', desc: 'ChatGPT (Web, GPT-5.6 Thinking)' },
  chatgptWeb56Auto: { value: 'gpt-5-6', desc: 'ChatGPT (Web, GPT-5.6)' },
  chatgptWeb56Instant: { value: 'gpt-5-6-instant', desc: 'ChatGPT (Web, GPT-5.6 Instant)' },
  chatgptWeb56Pro: { value: 'gpt-5-6-pro', desc: 'ChatGPT (Web, GPT-5.6 Pro)' },
  chatgptWeb56TMini: { value: 'gpt-5-6-t-mini', desc: 'ChatGPT (Web, GPT-5.6 Thinking Mini)' },
  chatgptWeb56Mini: { value: 'gpt-5-6-mini', desc: 'ChatGPT (Web, GPT-5.6 Mini)' },
  chatgptWeb55Thinking: { value: 'gpt-5-5-thinking', desc: 'ChatGPT (Web, GPT-5.5 Thinking)' },
  chatgptWeb55Auto: { value: 'gpt-5-5', desc: 'ChatGPT (Web, GPT-5.5)' },
  chatgptWeb55Instant: { value: 'gpt-5-5-instant', desc: 'ChatGPT (Web, GPT-5.5 Instant)' },
  chatgptWeb55Pro: { value: 'gpt-5-5-pro', desc: 'ChatGPT (Web, GPT-5.5 Pro)' },
  chatgptWeb55Mini: { value: 'gpt-5-5-mini', desc: 'ChatGPT (Web, GPT-5.5 Mini)' },
  chatgptWeb6AstraWork: { value: 'gpt-6-astra-wm', desc: 'ChatGPT (Web, Work, GPT-6 Astra)' },
  chatgptWeb56SolWork: { value: 'gpt-5.6-sol-wm', desc: 'ChatGPT (Web, Work, GPT-5.6 Sol)' },
  chatgptWeb56TerraWork: { value: 'gpt-5.6-terra-wm', desc: 'ChatGPT (Web, Work, GPT-5.6 Terra)' },
  chatgptWeb56LunaWork: { value: 'gpt-5.6-luna-wm', desc: 'ChatGPT (Web, Work, GPT-5.6 Luna)' },
  chatgptWeb55Work: { value: 'gpt-5.5-wm', desc: 'ChatGPT (Web, Work, GPT-5.5)' },
  chatgptWeb54Thinking: { value: 'gpt-5-4-thinking', desc: 'ChatGPT (Web, GPT-5.4 Thinking)' },
  chatgptWeb54Auto: { value: 'gpt-5-4', desc: 'ChatGPT (Web, GPT-5.4)' },
  chatgptWeb54Instant: { value: 'gpt-5-4-instant', desc: 'ChatGPT (Web, GPT-5.4 Instant)' },
  chatgptWeb54Pro: { value: 'gpt-5-4-pro', desc: 'ChatGPT (Web, GPT-5.4 Pro)' },
  chatgptWeb53Thinking: { value: 'gpt-5-3-thinking', desc: 'ChatGPT (Web, GPT-5.3 Thinking)' },
  chatgptWeb53Auto: { value: 'gpt-5-3', desc: 'ChatGPT (Web, GPT-5.3)' },
  chatgptWeb53Instant: { value: 'gpt-5-3-instant', desc: 'ChatGPT (Web, GPT-5.3 Instant)' },
  chatgptWeb52Thinking: { value: 'gpt-5-2-thinking', desc: 'ChatGPT (Web, GPT-5.2 Thinking)' },
  chatgptWeb52Auto: { value: 'gpt-5-2', desc: 'ChatGPT (Web, GPT-5.2)' },
  chatgptWeb52Instant: { value: 'gpt-5-2-instant', desc: 'ChatGPT (Web, GPT-5.2 Instant)' },
  chatgptWeb52Pro: { value: 'gpt-5-2-pro', desc: 'ChatGPT (Web, GPT-5.2 Pro)' },
  chatgptWeb51Thinking: { value: 'gpt-5-1-thinking', desc: 'ChatGPT (Web, GPT-5.1 Thinking)' },
  chatgptWeb51Auto: { value: 'gpt-5-1', desc: 'ChatGPT (Web, GPT-5.1)' },
  chatgptWeb51Instant: { value: 'gpt-5-1-instant', desc: 'ChatGPT (Web, GPT-5.1 Instant)' },
  chatgptWeb51Pro: { value: 'gpt-5-1-pro', desc: 'ChatGPT (Web, GPT-5.1 Pro)' },

  chatgptFree35: { value: 'auto', desc: 'ChatGPT (Web, Legacy Auto)' },
  chatgptFree4o: { value: 'gpt-4o', desc: 'ChatGPT (Web, Legacy GPT-4o)' },
  chatgptFree4oMini: { value: 'gpt-4o-mini', desc: 'ChatGPT (Web, Legacy GPT-4o mini)' },
  chatgptPlus4: { value: 'gpt-4', desc: 'ChatGPT (Web, Legacy GPT-4)' },
  chatgptPlus4Browsing: { value: 'gpt-4', desc: 'ChatGPT (Web, Legacy GPT-4)' }, // compatibility

  chatgptApi35: { value: 'gpt-3.5-turbo', desc: 'ChatGPT (GPT-3.5-turbo)' },
  chatgptApi35_16k: { value: 'gpt-3.5-turbo-16k', desc: 'ChatGPT (GPT-3.5-turbo-16k)' },

  chatgptApi4o_128k: { value: 'gpt-4o', desc: 'ChatGPT (GPT-4o, 128k)' },
  chatgptApi4oMini: { value: 'gpt-4o-mini', desc: 'ChatGPT (GPT-4o mini)' },
  chatgptApi4_8k: { value: 'gpt-4', desc: 'ChatGPT (GPT-4-8k)' },
  chatgptApi4_32k: { value: 'gpt-4-32k', desc: 'ChatGPT (GPT-4-32k)' },
  chatgptApi4_128k: {
    value: 'gpt-4-turbo',
    desc: 'ChatGPT (GPT-4-Turbo 128k)',
  },
  chatgptApi4_128k_preview: {
    value: 'gpt-4-turbo-preview',
    desc: 'ChatGPT (GPT-4-Turbo 128k Preview)',
  },
  chatgptApi4_128k_1106_preview: {
    value: 'gpt-4-1106-preview',
    desc: 'ChatGPT (GPT-4-Turbo 128k 1106 Preview)',
  },
  chatgptApi4_128k_0125_preview: {
    value: 'gpt-4-0125-preview',
    desc: 'ChatGPT (GPT-4-Turbo 128k 0125 Preview)',
  },
  chatgptApi4oLatest: { value: 'chatgpt-4o-latest', desc: 'ChatGPT (ChatGPT-4o latest)' },
  chatgptApi5Latest: { value: 'gpt-5-chat-latest', desc: 'ChatGPT (ChatGPT-5 latest)' },

  chatgptApi4_1: { value: 'gpt-4.1', desc: 'ChatGPT (GPT-4.1)' },
  chatgptApi4_1_mini: { value: 'gpt-4.1-mini', desc: 'ChatGPT (GPT-4.1 mini)' },
  chatgptApi4_1_nano: { value: 'gpt-4.1-nano', desc: 'ChatGPT (GPT-4.1 nano)' },

  chatgptApiO4Mini: { value: 'o4-mini', desc: 'ChatGPT (o4-mini)' },
  chatgptApiGpt5: { value: 'gpt-5', desc: 'ChatGPT (gpt-5)' },
  chatgptApiGpt5Mini: { value: 'gpt-5-mini', desc: 'ChatGPT (gpt-5-mini)' },
  chatgptApiGpt5Nano: { value: 'gpt-5-nano', desc: 'ChatGPT (gpt-5-nano)' },
  chatgptApi5_1Latest: { value: 'gpt-5.1-chat-latest', desc: 'ChatGPT (ChatGPT-5.1 latest)' },
  chatgptApi5_1: { value: 'gpt-5.1', desc: 'ChatGPT (GPT-5.1)' },
  chatgptApi5_2Latest: { value: 'gpt-5.2-chat-latest', desc: 'ChatGPT (ChatGPT-5.2 latest)' },
  chatgptApi5_2: { value: 'gpt-5.2', desc: 'ChatGPT (GPT-5.2)' },
  chatgptApi5_3Latest: { value: 'gpt-5.3-chat-latest', desc: 'ChatGPT (ChatGPT-5.3 latest)' },
  chatgptApi5_4: { value: 'gpt-5.4', desc: 'ChatGPT (GPT-5.4)' },
  chatgptApiGpt6Astra: { value: 'gpt-6-astra', desc: 'ChatGPT (GPT-6 Astra)' },

  claude12Api: { value: 'claude-instant-1.2', desc: 'Claude.ai (API, Claude Instant 1.2)' },
  claude2Api: { value: 'claude-2.0', desc: 'Claude.ai (API, Claude 2)' },
  claude21Api: { value: 'claude-2.1', desc: 'Claude.ai (API, Claude 2.1)' },
  claude3HaikuApi: {
    value: 'claude-3-haiku-20240307',
    desc: 'Claude.ai (API, Claude 3 Haiku)',
  },
  claude3SonnetApi: { value: 'claude-3-sonnet-20240229', desc: 'Claude.ai (API, Claude 3 Sonnet)' },
  claude3OpusApi: { value: 'claude-3-opus-20240229', desc: 'Claude.ai (API, Claude 3 Opus)' },
  claude35SonnetApi: {
    value: 'claude-3-5-sonnet-20241022',
    desc: 'Claude.ai (API, Claude 3.5 Sonnet)',
  },
  claude35HaikuApi: {
    value: 'claude-3-5-haiku-20241022',
    desc: 'Claude.ai (API, Claude 3.5 Haiku)',
  },
  claude37SonnetApi: {
    value: 'claude-3-7-sonnet-20250219',
    desc: 'Claude.ai (API, Claude 3.7 Sonnet)',
  },
  claudeOpus4Api: {
    value: 'claude-opus-4-20250514',
    desc: 'Claude.ai (API, Claude Opus 4)',
  },
  claudeOpus41Api: {
    value: 'claude-opus-4-1-20250805',
    desc: 'Claude.ai (API, Claude Opus 4.1)',
  },
  claudeSonnet4Api: {
    value: 'claude-sonnet-4-20250514',
    desc: 'Claude.ai (API, Claude Sonnet 4)',
  },
  claudeSonnet45Api: {
    value: 'claude-sonnet-4-5-20250929',
    desc: 'Claude.ai (API, Claude Sonnet 4.5)',
  },
  claudeHaiku45Api: {
    value: 'claude-haiku-4-5-20251001',
    desc: 'Claude.ai (API, Claude Haiku 4.5)',
  },
  claudeOpus45Api: {
    value: 'claude-opus-4-5',
    desc: 'Claude.ai (API, Claude Opus 4.5)',
  },
  claudeOpus46Api: {
    value: 'claude-opus-4-6',
    desc: 'Claude.ai (API, Claude Opus 4.6)',
  },

  moonshotWebFree: { value: 'k2', desc: 'Kimi.Moonshot (Web k2, 128K)' },
  moonshotWebFreeK15: { value: 'k1.5', desc: 'Kimi.Moonshot (Web k1.5, 128k)' },
  moonshotWebFreeK15Think: {
    value: 'k1.5-thinking',
    desc: 'Kimi.Moonshot (Web k1.5 Thinking, 128k)',
  },

  chatglmTurbo: { value: 'GLM-4-Air', desc: 'ChatGLM (GLM-4-Air, 128k)' },
  chatglm4: { value: 'GLM-4-0520', desc: 'ChatGLM (GLM-4-0520, 128k)' },
  chatglmEmohaa: { value: 'Emohaa', desc: 'ChatGLM (Emohaa)' },
  chatglmCharGLM3: { value: 'CharGLM-3', desc: 'ChatGLM (CharGLM-3)' },

  chatgptFree35Mobile: { value: 'text-davinci-002-render-sha-mobile', desc: 'ChatGPT (Mobile)' },
  chatgptPlus4Mobile: { value: 'gpt-4-mobile', desc: 'ChatGPT (Mobile, GPT-4)' },

  chatgptApi35_1106: { value: 'gpt-3.5-turbo-1106', desc: 'ChatGPT (GPT-3.5-turbo 1106)' },
  chatgptApi35_0125: { value: 'gpt-3.5-turbo-0125', desc: 'ChatGPT (GPT-3.5-turbo 0125)' },
  chatgptApi4_8k_0613: { value: 'gpt-4', desc: 'ChatGPT (GPT-4-8k 0613)' },
  chatgptApi4_32k_0613: { value: 'gpt-4-32k', desc: 'ChatGPT (GPT-4-32k 0613)' },

  gptApiInstruct: { value: 'gpt-3.5-turbo-instruct', desc: 'GPT-3.5-turbo Instruct' },
  gptApiDavinci: { value: 'text-davinci-003', desc: 'GPT-3.5' },

  customModel: { value: '', desc: 'Custom Model' },
  ollamaModel: { value: '', desc: 'Ollama API' },
  azureOpenAi: { value: '', desc: 'ChatGPT (Azure)' },
  dshHarnessAgent: { value: 'dsh', desc: 'DeepSeek Harness (agent)' },

  moonshot_k2: {
    value: 'kimi-k2-0711-preview',
    desc: 'Kimi.Moonshot (k2)',
  },
  moonshot_kimi_latest: {
    value: 'kimi-latest',
    desc: 'Kimi.Moonshot (kimi-latest)',
  },
  moonshot_v1_8k: {
    value: 'moonshot-v1-8k',
    desc: 'Kimi.Moonshot (8k)',
  },
  moonshot_v1_32k: {
    value: 'moonshot-v1-32k',
    desc: 'Kimi.Moonshot (32k)',
  },
  moonshot_v1_128k: {
    value: 'moonshot-v1-128k',
    desc: 'Kimi.Moonshot (128k)',
  },

  deepseek_chat: {
    value: 'deepseek-chat',
    desc: 'DeepSeek (Chat)',
  },
  deepseek_reasoner: {
    value: 'deepseek-reasoner',
    desc: 'DeepSeek (Reasoner)',
  },

  openRouter_anthropic_claude_sonnet4: {
    value: 'anthropic/claude-sonnet-4',
    desc: 'OpenRouter (Claude Sonnet 4)',
  },
  openRouter_anthropic_claude_sonnet4_5: {
    value: 'anthropic/claude-sonnet-4.5',
    desc: 'OpenRouter (Claude Sonnet 4.5)',
  },
  openRouter_anthropic_claude_haiku4_5: {
    value: 'anthropic/claude-haiku-4.5',
    desc: 'OpenRouter (Claude Haiku 4.5)',
  },
  openRouter_anthropic_claude_3_7_sonnet: {
    value: 'anthropic/claude-3.7-sonnet',
    desc: 'OpenRouter (Claude 3.7 Sonnet)',
  },
  openRouter_google_gemini_2_5_pro: {
    value: 'google/gemini-2.5-pro',
    desc: 'OpenRouter (Gemini 2.5 Pro)',
  },
  openRouter_google_gemini_2_5_flash: {
    value: 'google/gemini-2.5-flash',
    desc: 'OpenRouter (Gemini 2.5 Flash)',
  },
  openRouter_openai_o3: {
    value: 'openai/o3',
    desc: 'OpenRouter (GPT-o3)',
  },
  openRouter_openai_gpt_4_1_mini: {
    value: 'openai/gpt-4.1-mini',
    desc: 'OpenRouter (GPT-4.1 Mini)',
  },
  openRouter_deepseek_deepseek_chat_v3_0324_free: {
    value: 'deepseek/deepseek-chat-v3-0324:free',
    desc: 'OpenRouter (DeepSeek Chat v3 Free)',
  },
  openRouter_anthropic_claude_opus4_5: {
    value: 'anthropic/claude-opus-4.5',
    desc: 'OpenRouter (Claude Opus 4.5)',
  },
  openRouter_anthropic_claude_opus4_6: {
    value: 'anthropic/claude-opus-4.6',
    desc: 'OpenRouter (Claude Opus 4.6)',
  },
  openRouter_google_gemini_3_pro: {
    value: 'google/gemini-3-pro-preview',
    desc: 'OpenRouter (Gemini 3 Pro)',
  },
  openRouter_google_gemini_3_flash: {
    value: 'google/gemini-3-flash-preview',
    desc: 'OpenRouter (Gemini 3 Flash)',
  },
  openRouter_google_gemini_3_1_pro: {
    value: 'google/gemini-3.1-pro-preview',
    desc: 'OpenRouter (Gemini 3.1 Pro)',
  },

  aiml_anthropic_claude_opus_4: {
    value: 'anthropic/claude-opus-4',
    desc: 'AIML (Claude Opus 4)',
  },
  aiml_anthropic_claude_opus_4_1: {
    value: 'anthropic/claude-opus-4-1',
    desc: 'AIML (Claude Opus 4.1)',
  },
  aiml_anthropic_claude_sonnet_4: {
    value: 'anthropic/claude-sonnet-4',
    desc: 'AIML (Claude Sonnet 4)',
  },
  aiml_anthropic_claude_sonnet_4_5: {
    value: 'anthropic/claude-sonnet-4-5',
    desc: 'AIML (Claude Sonnet 4.5)',
  },
  aiml_claude_3_7_sonnet_20250219: {
    value: 'claude-3-7-sonnet-20250219',
    desc: 'AIML (Claude 3.7 Sonnet)',
  },
  aiml_google_gemini_2_5_pro_preview_05_06: {
    value: 'google/gemini-2.5-pro-preview-05-06',
    desc: 'AIML (Gemini 2.5 Pro)',
  },
  aiml_google_gemini_2_5_flash_preview: {
    value: 'google/gemini-2.5-flash-preview',
    desc: 'AIML (Gemini 2.5 Flash)',
  },
  aiml_openai_o3_2025_04_16: {
    value: 'openai/o3-2025-04-16',
    desc: 'AIML (GPT-o3)',
  },
  aiml_openai_gpt_4_1_2025_04_14: {
    value: 'openai/gpt-4.1-2025-04-14',
    desc: 'AIML (GPT-4.1)',
  },
  aiml_deepseek_deepseek_chat: {
    value: 'deepseek/deepseek-chat',
    desc: 'AIML (DeepSeek Chat)',
  },
  aiml_moonshot_kimi_k2_preview: {
    value: 'moonshot/kimi-k2-preview',
    desc: 'AIML (Kimi K2)',
  },
}
