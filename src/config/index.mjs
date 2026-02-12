import { defaults } from 'lodash-es'
import Browser from 'webextension-polyfill'
import { isMobile } from '../utils/is-mobile.mjs'
import { parseFloatWithClamp } from '../utils/parse-float-with-clamp.mjs'
import { parseIntWithClamp } from '../utils/parse-int-with-clamp.mjs'
import {
  isInApiModeGroup,
  isUsingModelName,
  modelNameToDesc,
} from '../utils/model-name-convert.mjs'
import { t } from 'i18next'
import { AgentProtocol, normalizeAgentProtocol } from '../services/agent/protocols.mjs'

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

const BuiltInSkillIds = {
  analyzeWebDesignPatterns: 'builtin-skill-analyze-web-design-patterns',
}

export const BUILTIN_DESIGN_ASSISTANT_ID = 'builtin-assistant-design-analyst'

const BuiltInAssistantIds = {
  designAssistant: BUILTIN_DESIGN_ASSISTANT_ID,
}

const BuiltInMcpServerIds = {
  skillLibrary: 'mcp-builtin-skill-library',
  browserContextToolkit: 'mcp-builtin-browser-context-toolkit',
}

const AgentDefaultsMigrationVersion = {
  clearLegacyDesignDefaults: 1,
}

export const CHATGPT_WEB_DEFAULT_MODEL_KEY = 'chatgptWeb51Thinking'
export const CHATGPT_WEB_DEFAULT_MODEL_SLUG = 'gpt-5-1-thinking'
export const CHATGPT_WEB_DEFAULT_THINKING_EFFORT = 'extended'
export const CHATGPT_WEB_DEBUG_LOG_KEY = 'chatgptWebDebugLog'

const LegacyChatgptWebModelKeyMap = {
  chatgptFree35: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptFree4o: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptFree4oMini: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptPlus4: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptPlus4Browsing: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptFree35Mobile: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptPlus4Mobile: CHATGPT_WEB_DEFAULT_MODEL_KEY,
}

const LegacyChatgptWebModelSlugSet = new Set([
  'auto',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'text-davinci-002-render-sha-mobile',
  'gpt-4-mobile',
])

function normalizeLegacyChatgptWebModelName(modelName) {
  if (typeof modelName !== 'string' || !modelName) return modelName
  if (Object.prototype.hasOwnProperty.call(LegacyChatgptWebModelKeyMap, modelName)) {
    return LegacyChatgptWebModelKeyMap[modelName]
  }
  if (!modelName.startsWith('chatgptWebModelKeys-')) return modelName
  const slug = modelName.replace('chatgptWebModelKeys-', '').trim()
  if (LegacyChatgptWebModelSlugSet.has(slug)) return CHATGPT_WEB_DEFAULT_MODEL_KEY
  return modelName
}

const defaultBuiltInSkills = [
  {
    id: BuiltInSkillIds.analyzeWebDesignPatterns,
    name: 'Analyze Current Web Design Patterns',
    description:
      'Review the current page UI for hierarchy, typography, spacing, color, interaction clarity, and accessibility.',
    version: 'builtin-v1',
    sourceName: 'Built-in',
    sourceHash: 'builtin:analyze-web-design-patterns:v1',
    entryPath: 'builtin://skills/analyze-current-web-design-patterns',
    instructions: `Goal:
Audit the current webpage design and produce a practical UX/UI review.

Checklist:
- Visual hierarchy and scanability
- Typography consistency (sizes/weights/line-height)
- Layout rhythm and spacing balance
- Color contrast and state clarity
- Interaction affordances and form usability
- Mobile responsiveness indicators

Output format:
1) Strengths
2) Top issues (ordered by impact)
3) Concrete fixes with implementation hints`,
    resources: [
      {
        path: 'references/design-review-checklist.md',
        content: `Design review checklist:
- Identify information scent and primary call-to-action clarity.
- Validate spacing system consistency (vertical rhythm).
- Check color contrast for body text and interactive controls.
- Verify heading hierarchy and semantic grouping.`,
      },
    ],
    active: true,
    importedAt: 0,
    builtIn: true,
  },
]

const defaultBuiltInMcpServers = [
  {
    id: BuiltInMcpServerIds.skillLibrary,
    name: 'Skill Library (Built-in)',
    transport: 'builtin',
    httpUrl: '',
    apiKey: '',
    active: true,
    builtIn: true,
  },
  {
    id: BuiltInMcpServerIds.browserContextToolkit,
    name: 'Browser Context Toolkit (Built-in)',
    transport: 'builtin',
    httpUrl: '',
    apiKey: '',
    active: false,
    builtIn: true,
  },
]

const defaultBuiltInAssistants = [
  {
    id: BuiltInAssistantIds.designAssistant,
    name: 'Design Pattern Analyst',
    systemPrompt:
      'You are a practical web UI/UX analyst. Focus on concrete, high-impact recommendations and cite specific page evidence whenever possible.',
    defaultSkillIds: [BuiltInSkillIds.analyzeWebDesignPatterns],
    defaultMcpServerIds: [BuiltInMcpServerIds.skillLibrary],
    active: true,
    builtIn: true,
  },
]

export const chatgptWebModelKeys = [
  'chatgptWeb51Thinking',
  'chatgptWeb52Auto',
  'chatgptWeb52Instant',
  'chatgptWeb52Thinking',
  'chatgptWeb52Pro',
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
export const bingWebModelKeys = ['bingFree4', 'bingFreeSydney']
export const bardWebModelKeys = ['bardWebFree']
export const claudeWebModelKeys = ['claude2WebFree']
export const moonshotWebModelKeys = [
  'moonshotWebFree',
  'moonshotWebFreeK15',
  'moonshotWebFreeK15Think',
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
]
export const chatglmApiModelKeys = ['chatglmTurbo', 'chatglm4', 'chatglmEmohaa', 'chatglmCharGLM3']
export const githubThirdPartyApiModelKeys = ['waylaidwandererApi']
export const poeWebModelKeys = [
  'poeAiWebSage', //poe.com/Assistant
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
]
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
  claudeWebModelKeys: {
    value: claudeWebModelKeys,
    desc: 'Claude.ai (Web)',
  },
  moonshotWebModelKeys: {
    value: moonshotWebModelKeys,
    desc: 'Kimi.Moonshot (Web)',
  },
  bingWebModelKeys: {
    value: bingWebModelKeys,
    desc: 'Bing (Web)',
  },
  bardWebModelKeys: {
    value: bardWebModelKeys,
    desc: 'Gemini (Web)',
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
  githubThirdPartyApiModelKeys: {
    value: githubThirdPartyApiModelKeys,
    desc: 'Github Third Party Waylaidwanderer (API)',
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
}

export const DefaultEnabledProviderGroups = {
  chatgptWebModelKeys: true,
  chatgptApiModelKeys: true,
  customApiModelKeys: true,

  // Everything else is Advanced-only by default.
  claudeWebModelKeys: false,
  moonshotWebModelKeys: false,
  bingWebModelKeys: false,
  bardWebModelKeys: false,
  claudeApiModelKeys: false,
  moonshotApiModelKeys: false,
  chatglmApiModelKeys: false,
  ollamaApiModelKeys: false,
  azureOpenAiApiModelKeys: false,
  gptApiModelKeys: false,
  githubThirdPartyApiModelKeys: false,
  deepSeekApiModelKeys: false,
  openRouterApiModelKeys: false,
  aimlModelKeys: false,
}

export const DefaultActiveModelKeysByGroup = {
  chatgptWebModelKeys: [CHATGPT_WEB_DEFAULT_MODEL_KEY],
  chatgptApiModelKeys: ['chatgptApi5Latest'],
}

export const DeprecatedModelKeys = [
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
  chatgptWeb51Thinking: { value: 'gpt-5-1-thinking', desc: 'ChatGPT (Web, GPT-5.1 Thinking)' },
  chatgptWeb52Auto: { value: 'gpt-5-2', desc: 'ChatGPT (Web, GPT-5.2)' },
  chatgptWeb52Instant: { value: 'gpt-5-2-instant', desc: 'ChatGPT (Web, GPT-5.2 Instant)' },
  chatgptWeb52Thinking: { value: 'gpt-5-2-thinking', desc: 'ChatGPT (Web, GPT-5.2 Thinking)' },
  chatgptWeb52Pro: { value: 'gpt-5-2-pro', desc: 'ChatGPT (Web, GPT-5.2 Pro)' },
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

  claude2WebFree: { value: '', desc: 'Claude.ai (Web)' },
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

  bingFree4: { value: '', desc: 'Bing (Web, GPT-4)' },
  bingFreeSydney: { value: '', desc: 'Bing (Web, GPT-4, Sydney)' },

  moonshotWebFree: { value: 'k2', desc: 'Kimi.Moonshot (Web k2, 128K)' },
  moonshotWebFreeK15: { value: 'k1.5', desc: 'Kimi.Moonshot (Web k1.5, 128k)' },
  moonshotWebFreeK15Think: {
    value: 'k1.5-thinking',
    desc: 'Kimi.Moonshot (Web k1.5 Thinking, 128k)',
  },

  bardWebFree: { value: '', desc: 'Gemini (Web)' },

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
  waylaidwandererApi: { value: '', desc: 'Waylaidwanderer API (Github)' },

  poeAiWebSage: { value: 'Assistant', desc: 'Poe AI (Web, Assistant)' },
  poeAiWebGPT4: { value: 'gpt-4', desc: 'Poe AI (Web, GPT-4)' },
  poeAiWebGPT4_32k: { value: 'gpt-4-32k', desc: 'Poe AI (Web, GPT-4-32k)' },
  poeAiWebClaudePlus: { value: 'claude-2-100k', desc: 'Poe AI (Web, Claude 2 100k)' },
  poeAiWebClaude: { value: 'claude-instant', desc: 'Poe AI (Web, Claude instant)' },
  poeAiWebClaude100k: { value: 'claude-instant-100k', desc: 'Poe AI (Web, Claude instant 100k)' },
  poeAiWebGooglePaLM: { value: 'Google-PaLM', desc: 'Poe AI (Web, Google-PaLM)' },
  poeAiWeb_Llama_2_7b: { value: 'Llama-2-7b', desc: 'Poe AI (Web, Llama-2-7b)' },
  poeAiWeb_Llama_2_13b: { value: 'Llama-2-13b', desc: 'Poe AI (Web, Llama-2-13b)' },
  poeAiWeb_Llama_2_70b: { value: 'Llama-2-70b', desc: 'Poe AI (Web, Llama-2-70b)' },
  poeAiWebChatGpt: { value: 'chatgpt', desc: 'Poe AI (Web, ChatGPT)' },
  poeAiWebChatGpt_16k: { value: 'chatgpt-16k', desc: 'Poe AI (Web, ChatGPT-16k)' },
  poeAiWebCustom: { value: '', desc: 'Poe AI (Web, Custom)' },

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

for (const modelName in Models) {
  if (isUsingMultiModeModel({ modelName }))
    for (const mode in ModelMode) {
      const key = `${modelName}-${mode}`
      Models[key] = {
        value: mode,
        desc: modelNameToDesc(key, t),
      }
    }
}

/**
 * @typedef {typeof defaultConfig} UserConfig
 */
export const defaultConfig = {
  // general

  // additive agent runtime controls (legacy behavior remains default when unused)
  /** @type {keyof RuntimeMode} */
  runtimeMode: 'safe',
  agentProtocol: AgentProtocol.auto,
  agentPreloadContextTokenCap: 64000,
  agentContextTokenCap: 128000,
  agentMaxSteps: 8,
  agentNoProgressLimit: 2,
  agentToolEventLimit: 50,
  assistants: defaultBuiltInAssistants,
  defaultAssistantId: '',
  installedSkills: defaultBuiltInSkills,
  defaultSkillIds: [],
  mcpServers: defaultBuiltInMcpServers,
  defaultMcpServerIds: [],

  /** @type {keyof TriggerMode}*/
  triggerMode: 'manually',
  /** @type {keyof ThemeMode}*/
  themeMode: 'auto',
  /**
   * Accent (bubble / highlight) color settings.
   * Stored separately for light/dark so users can tune both.
   */
  accentColorLight: 'teal',
  accentStrengthLight: 'normal',
  accentColorDark: 'teal',
  accentStrengthDark: 'normal',
  /**
   * Code block syntax highlight theme (light/dark).
   * These map to the themes defined in frontend_redesign.
   */
  codeThemeLight: 'github-light',
  codeThemeDark: 'github-dark',
  /** @type {keyof Models}*/
  modelName: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  apiMode: null,

  preferredLanguage: getNavigatorLanguage(),
  clickIconAction: 'popup',
  insertAtTop: isMobile(),
  alwaysFloatingSidebar: false,
  allowEscToCloseAll: false,
  lockWhenAnswer: true,
  answerScrollMargin: 200,
  autoRegenAfterSwitchModel: false,
  selectionToolsNextToInputBox: false,
  alwaysPinWindow: false,
  focusAfterAnswer: true,

  apiKey: '', // openai ApiKey

  azureApiKey: '',
  azureEndpoint: '',
  azureDeploymentName: '',

  poeCustomBotName: '',

  claudeApiKey: '',
  chatglmApiKey: '',
  moonshotApiKey: '',
  deepSeekApiKey: '',

  customApiKey: '',

  /** @type {keyof ModelMode}*/
  modelMode: 'balanced',

  customModelApiUrl: 'http://localhost:8000/v1/chat/completions',
  customModelName: 'gpt-4.1',
  githubThirdPartyUrl: 'http://127.0.0.1:3000/conversation',

  ollamaEndpoint: 'http://127.0.0.1:11434',
  ollamaModelName: 'llama4',
  ollamaApiKey: '',
  ollamaKeepAliveTime: '5m',

  openRouterApiKey: '',
  aimlApiKey: '',

  // advanced

  maxResponseTokenLength: 2000,
  maxConversationContextLength: 9,
  temperature: 1,
  customChatGptWebApiUrl: 'https://chatgpt.com',
  customChatGptWebApiPath: '/backend-api/conversation',
  chatgptWebThinkingEffort: CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
  customOpenAiApiUrl: 'https://api.openai.com',
  customClaudeApiUrl: 'https://api.anthropic.com',
  disableWebModeHistory: true,
  debugChatgptWebRequests: false,
  hideContextMenu: false,
  cropText: true,
  siteRegex: 'match nothing',
  useSiteRegexOnly: false,
  inputQuery: '',
  appendQuery: '',
  prependQuery: '',
  enabledProviders: { ...DefaultEnabledProviderGroups },
  showDeprecatedModels: false,

  // others

  alwaysCreateNewConversationWindow: false,
  independentPanelSidebarCollapsed: false,
  // The handling of activeApiModes and customApiModes is somewhat complex.
  // It does not directly convert activeApiModes into customApiModes, which is for compatibility considerations.
  // It allows the content of activeApiModes to change with version updates when the user has not customized ApiModes.
  // If it were directly written into customApiModes, the value would become fixed, even if the user has not made any customizations.
  activeApiModes: [
    ...DefaultActiveModelKeysByGroup.chatgptWebModelKeys,
    ...DefaultActiveModelKeysByGroup.chatgptApiModelKeys,
  ],
  customApiModes: [
    {
      groupName: '',
      itemName: '',
      isCustom: false,
      displayName: '',
      customName: '',
      customUrl: '',
      apiKey: '',
      active: false,
    },
  ],
  activeSelectionTools: ['translate', 'translateToEn', 'summary', 'polish', 'code', 'ask'],
  customSelectionTools: [
    {
      name: '',
      iconKey: 'explain',
      prompt: 'sample prompt: {{selection}}',
      active: false,
      usePageContext: false,
    },
  ],
  customContentExtractors: [
    {
      name: '',
      urlPattern: '',
      method: 'auto',
      selectors: '',
      excludeSelectors: '',
      customScript: '',
      active: true,
    },
  ],
  activeSiteAdapters: [
    'google',
    'bilibili',
    'github',
    'gitlab',
    'quora',
    'reddit',
    'youtube',
    'zhihu',
    'stackoverflow',
    'juejin',
    'mp.weixin.qq',
    'followin',
    'arxiv',
  ],
  accessToken: '',
  tokenSavedOn: 0,
  bingAccessToken: '',
  notificationJumpBackTabId: 0,
  chatgptTabId: 0,
  chatgptArkoseReqUrl: '',
  chatgptArkoseReqForm: '',
  kimiMoonShotRefreshToken: '',
  kimiMoonShotAccessToken: '',

  // unchangeable

  userLanguage: getNavigatorLanguage(),
  apiModes: Object.keys(Models),
  chatgptArkoseReqParams: 'cgb=vhwi',
  selectionTools: [
    'explain',
    'translate',
    'translateToEn',
    'summary',
    'polish',
    'sentiment',
    'divide',
    'code',
    'ask',
  ],
  selectionToolsDesc: [
    'Explain',
    'Translate',
    'Translate (To English)',
    'Summary',
    'Polish',
    'Sentiment Analysis',
    'Divide Paragraphs',
    'Code Explain',
    'Ask',
  ],
  // importing configuration will result in gpt-3-encoder being packaged into the output file
  siteAdapters: [
    'google',
    'bilibili',
    'github',
    'gitlab',
    'quora',
    'reddit',
    'youtube',
    'zhihu',
    'stackoverflow',
    'juejin',
    'mp.weixin.qq',
    'followin',
    'arxiv',
  ],
}

export function getNavigatorLanguage() {
  const l = navigator.language.toLowerCase()
  if (['zh-hk', 'zh-mo', 'zh-tw', 'zh-cht', 'zh-hant'].includes(l)) return 'zhHant'
  return navigator.language.substring(0, 2)
}

export function isUsingChatgptWebModel(configOrSession) {
  return isInApiModeGroup(chatgptWebModelKeys, configOrSession)
}

export function isUsingClaudeWebModel(configOrSession) {
  return isInApiModeGroup(claudeWebModelKeys, configOrSession)
}

export function isUsingMoonshotWebModel(configOrSession) {
  return isInApiModeGroup(moonshotWebModelKeys, configOrSession)
}

export function isUsingBingWebModel(configOrSession) {
  return isInApiModeGroup(bingWebModelKeys, configOrSession)
}

export function isUsingMultiModeModel(configOrSession) {
  return isInApiModeGroup(bingWebModelKeys, configOrSession)
}

export function isUsingGeminiWebModel(configOrSession) {
  return isInApiModeGroup(bardWebModelKeys, configOrSession)
}

export function isUsingChatgptApiModel(configOrSession) {
  return isInApiModeGroup(chatgptApiModelKeys, configOrSession)
}

export function isUsingGptCompletionApiModel(configOrSession) {
  return isInApiModeGroup(gptApiModelKeys, configOrSession)
}

export function isUsingOpenAiApiModel(configOrSession) {
  return isUsingChatgptApiModel(configOrSession) || isUsingGptCompletionApiModel(configOrSession)
}

export function isUsingClaudeApiModel(configOrSession) {
  return isInApiModeGroup(claudeApiModelKeys, configOrSession)
}

export function isUsingMoonshotApiModel(configOrSession) {
  return isInApiModeGroup(moonshotApiModelKeys, configOrSession)
}

export function isUsingDeepSeekApiModel(configOrSession) {
  return isInApiModeGroup(deepSeekApiModelKeys, configOrSession)
}

export function isUsingOpenRouterApiModel(configOrSession) {
  return isInApiModeGroup(openRouterApiModelKeys, configOrSession)
}

export function isUsingAimlApiModel(configOrSession) {
  return isInApiModeGroup(aimlApiModelKeys, configOrSession)
}

export function isUsingChatGLMApiModel(configOrSession) {
  return isInApiModeGroup(chatglmApiModelKeys, configOrSession)
}

export function isUsingOllamaApiModel(configOrSession) {
  return isInApiModeGroup(ollamaApiModelKeys, configOrSession)
}

export function isUsingAzureOpenAiApiModel(configOrSession) {
  return isInApiModeGroup(azureOpenAiApiModelKeys, configOrSession)
}

export function isUsingGithubThirdPartyApiModel(configOrSession) {
  return isInApiModeGroup(githubThirdPartyApiModelKeys, configOrSession)
}

export function isUsingCustomModel(configOrSession) {
  return isInApiModeGroup(customApiModelKeys, configOrSession)
}

/**
 * @deprecated
 */
export function isUsingCustomNameOnlyModel(configOrSession) {
  return isUsingModelName('poeAiWebCustom', configOrSession)
}

export async function getPreferredLanguageKey() {
  const config = await getUserConfig()
  if (config.preferredLanguage === 'auto') return config.userLanguage
  return config.preferredLanguage
}

/**
 * get user config from local storage
 * @returns {Promise<UserConfig>}
 */
export async function getUserConfig() {
  const options = await Browser.storage.local.get(Object.keys(defaultConfig))
  const migrationMeta = await Browser.storage.local.get({
    agentDefaultsMigrationVersion: 0,
  })
  const agentDefaultsMigrationVersion = Number(migrationMeta.agentDefaultsMigrationVersion) || 0
  if (options.customChatGptWebApiUrl === 'https://chat.openai.com')
    options.customChatGptWebApiUrl = 'https://chatgpt.com'
  const config = defaults(options, defaultConfig)

  // Guard against invalid numeric values (e.g. NaN) persisted by user input/imports.
  const numericFix = {
    maxResponseTokenLength: parseIntWithClamp(
      config.maxResponseTokenLength,
      defaultConfig.maxResponseTokenLength,
      100,
      40000,
    ),
    maxConversationContextLength: parseIntWithClamp(
      config.maxConversationContextLength,
      defaultConfig.maxConversationContextLength,
      0,
      100,
    ),
    temperature: parseFloatWithClamp(config.temperature, defaultConfig.temperature, 0, 2),
    agentPreloadContextTokenCap: parseIntWithClamp(
      config.agentPreloadContextTokenCap,
      defaultConfig.agentPreloadContextTokenCap,
      1000,
      256000,
    ),
    agentContextTokenCap: parseIntWithClamp(
      config.agentContextTokenCap,
      defaultConfig.agentContextTokenCap,
      1000,
      256000,
    ),
    agentMaxSteps: parseIntWithClamp(config.agentMaxSteps, defaultConfig.agentMaxSteps, 1, 32),
    agentNoProgressLimit: parseIntWithClamp(
      config.agentNoProgressLimit,
      defaultConfig.agentNoProgressLimit,
      1,
      10,
    ),
    agentToolEventLimit: parseIntWithClamp(
      config.agentToolEventLimit,
      defaultConfig.agentToolEventLimit,
      10,
      300,
    ),
  }
  const needsFix =
    numericFix.maxResponseTokenLength !== config.maxResponseTokenLength ||
    numericFix.maxConversationContextLength !== config.maxConversationContextLength ||
    numericFix.temperature !== config.temperature ||
    numericFix.agentPreloadContextTokenCap !== config.agentPreloadContextTokenCap ||
    numericFix.agentContextTokenCap !== config.agentContextTokenCap ||
    numericFix.agentMaxSteps !== config.agentMaxSteps ||
    numericFix.agentNoProgressLimit !== config.agentNoProgressLimit ||
    numericFix.agentToolEventLimit !== config.agentToolEventLimit
  if (needsFix) {
    config.maxResponseTokenLength = numericFix.maxResponseTokenLength
    config.maxConversationContextLength = numericFix.maxConversationContextLength
    config.temperature = numericFix.temperature
    config.agentPreloadContextTokenCap = numericFix.agentPreloadContextTokenCap
    config.agentContextTokenCap = numericFix.agentContextTokenCap
    config.agentMaxSteps = numericFix.agentMaxSteps
    config.agentNoProgressLimit = numericFix.agentNoProgressLimit
    config.agentToolEventLimit = numericFix.agentToolEventLimit
    await Browser.storage.local.set(numericFix)
  }
  if (config.agentPreloadContextTokenCap > config.agentContextTokenCap) {
    config.agentPreloadContextTokenCap = config.agentContextTokenCap
    await Browser.storage.local.set({
      agentPreloadContextTokenCap: config.agentPreloadContextTokenCap,
    })
  }

  // Keep provider gating config forward-compatible with newly added provider groups.
  const storedEnabledProviders =
    config.enabledProviders && typeof config.enabledProviders === 'object'
      ? config.enabledProviders
      : {}
  const enabledProviders = { ...DefaultEnabledProviderGroups, ...storedEnabledProviders }
  const enabledNeedsFix =
    !config.enabledProviders ||
    Object.keys(DefaultEnabledProviderGroups).some(
      (key) => storedEnabledProviders[key] === undefined,
    )
  config.enabledProviders = enabledProviders
  if (enabledNeedsFix) {
    await Browser.storage.local.set({ enabledProviders })
  }

  // Only treat an explicit boolean `true` as enabled.
  config.showDeprecatedModels = config.showDeprecatedModels === true
  config.debugChatgptWebRequests = config.debugChatgptWebRequests === true

  const normalizedChatgptWebThinkingEffort =
    config.chatgptWebThinkingEffort === 'standard'
      ? 'standard'
      : CHATGPT_WEB_DEFAULT_THINKING_EFFORT
  if (normalizedChatgptWebThinkingEffort !== config.chatgptWebThinkingEffort) {
    config.chatgptWebThinkingEffort = normalizedChatgptWebThinkingEffort
    await Browser.storage.local.set({ chatgptWebThinkingEffort: config.chatgptWebThinkingEffort })
  }

  // Ensure newly-added apiMode fields exist on persisted objects (upgrade compatibility).
  let apiModeNeedsFix = false
  if (config.apiMode && typeof config.apiMode === 'object') {
    if (typeof config.apiMode.displayName !== 'string') {
      config.apiMode.displayName = ''
      apiModeNeedsFix = true
    }
  }

  let customApiModesNeedsFix = false
  if (Array.isArray(config.customApiModes)) {
    const fixedCustomApiModes = config.customApiModes.map((apiMode) => {
      if (!apiMode || typeof apiMode !== 'object') return apiMode
      if (typeof apiMode.displayName === 'string') return apiMode
      customApiModesNeedsFix = true
      return { ...apiMode, displayName: '' }
    })
    if (customApiModesNeedsFix) {
      config.customApiModes = fixedCustomApiModes
    }
  }

  if (apiModeNeedsFix) {
    await Browser.storage.local.set({ apiMode: config.apiMode })
  }
  if (customApiModesNeedsFix) {
    await Browser.storage.local.set({ customApiModes: config.customApiModes })
  }

  let webModelMigrationNeedsFix = false
  const webModelMigrationPatch = {}

  const normalizedModelName = normalizeLegacyChatgptWebModelName(config.modelName)
  if (normalizedModelName !== config.modelName) {
    config.modelName = normalizedModelName
    webModelMigrationNeedsFix = true
    webModelMigrationPatch.modelName = config.modelName
  }

  if (config.apiMode && typeof config.apiMode === 'object') {
    const nextItemName = normalizeLegacyChatgptWebModelName(config.apiMode.itemName)
    if (nextItemName !== config.apiMode.itemName) {
      config.apiMode = {
        ...config.apiMode,
        itemName: nextItemName,
        isCustom: false,
      }
      webModelMigrationNeedsFix = true
      webModelMigrationPatch.apiMode = config.apiMode
    }
  }

  if (Array.isArray(config.activeApiModes)) {
    const migratedActiveApiModes = config.activeApiModes.map(normalizeLegacyChatgptWebModelName)
    if (JSON.stringify(migratedActiveApiModes) !== JSON.stringify(config.activeApiModes)) {
      config.activeApiModes = migratedActiveApiModes
      webModelMigrationNeedsFix = true
      webModelMigrationPatch.activeApiModes = config.activeApiModes
    }
  }

  if (Array.isArray(config.customApiModes)) {
    let migratedCustomModesChanged = false
    const migratedCustomApiModes = config.customApiModes.map((apiMode) => {
      if (!apiMode || typeof apiMode !== 'object') return apiMode
      if (apiMode.groupName !== 'chatgptWebModelKeys') return apiMode
      const nextItemName = normalizeLegacyChatgptWebModelName(apiMode.itemName)
      if (nextItemName === apiMode.itemName) return apiMode
      migratedCustomModesChanged = true
      return {
        ...apiMode,
        itemName: nextItemName,
        isCustom: false,
      }
    })
    if (migratedCustomModesChanged) {
      config.customApiModes = migratedCustomApiModes
      webModelMigrationNeedsFix = true
      webModelMigrationPatch.customApiModes = config.customApiModes
    }
  }

  if (webModelMigrationNeedsFix) {
    await Browser.storage.local.set(webModelMigrationPatch)
  }

  // Validate runtime mode (safe by default for backwards-compatible security posture).
  if (!Object.prototype.hasOwnProperty.call(RuntimeMode, config.runtimeMode)) {
    config.runtimeMode = defaultConfig.runtimeMode
    await Browser.storage.local.set({ runtimeMode: config.runtimeMode })
  }
  const normalizedAgentProtocol = normalizeAgentProtocol(config.agentProtocol, AgentProtocol.auto)
  if (normalizedAgentProtocol !== config.agentProtocol) {
    config.agentProtocol = normalizedAgentProtocol
    await Browser.storage.local.set({ agentProtocol: config.agentProtocol })
  }

  const normalizeString = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
  const normalizeStringArray = (value) =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : []
  const ensureObjectId = (obj, prefix) => {
    if (obj.id && typeof obj.id === 'string' && obj.id.trim()) return obj.id
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  }

  let assistantsNeedsFix = false
  const normalizedAssistants = Array.isArray(config.assistants)
    ? config.assistants
        .map((assistant) => {
          if (!assistant || typeof assistant !== 'object') {
            assistantsNeedsFix = true
            return null
          }
          const normalized = {
            id: ensureObjectId(assistant, 'assistant'),
            name: normalizeString(assistant.name),
            systemPrompt: normalizeString(assistant.systemPrompt),
            defaultSkillIds: normalizeStringArray(assistant.defaultSkillIds),
            defaultMcpServerIds: normalizeStringArray(assistant.defaultMcpServerIds),
            active: assistant.active !== false,
          }
          if (JSON.stringify(normalized) !== JSON.stringify(assistant)) assistantsNeedsFix = true
          return normalized.name ? normalized : null
        })
        .filter(Boolean)
    : []
  if (!Array.isArray(config.assistants)) assistantsNeedsFix = true
  if (assistantsNeedsFix) {
    config.assistants = normalizedAssistants
    await Browser.storage.local.set({ assistants: config.assistants })
  }

  let skillsNeedsFix = false
  const normalizeSkillResource = (resource) => {
    if (!resource || typeof resource !== 'object') return null
    const path = normalizeString(resource.path).trim()
    const content = normalizeString(resource.content)
    if (!path || !content) return null
    return { path, content }
  }
  const normalizedInstalledSkills = Array.isArray(config.installedSkills)
    ? config.installedSkills
        .map((skill) => {
          if (!skill || typeof skill !== 'object') {
            skillsNeedsFix = true
            return null
          }
          const normalized = {
            id: ensureObjectId(skill, 'skill'),
            name: normalizeString(skill.name),
            description: normalizeString(skill.description),
            version: normalizeString(skill.version),
            sourceName: normalizeString(skill.sourceName),
            sourceHash: normalizeString(skill.sourceHash),
            entryPath: normalizeString(skill.entryPath || skill.mainPath),
            instructions: normalizeString(skill.instructions),
            resources: Array.isArray(skill.resources)
              ? skill.resources.map(normalizeSkillResource).filter(Boolean)
              : [],
            active: skill.active !== false,
            importedAt:
              Number.isFinite(skill.importedAt) && Number(skill.importedAt) > 0
                ? Number(skill.importedAt)
                : Date.now(),
          }
          if (JSON.stringify(normalized) !== JSON.stringify(skill)) skillsNeedsFix = true
          return normalized.name && normalized.instructions ? normalized : null
        })
        .filter(Boolean)
    : []
  if (!Array.isArray(config.installedSkills)) skillsNeedsFix = true
  if (skillsNeedsFix) {
    config.installedSkills = normalizedInstalledSkills
    await Browser.storage.local.set({ installedSkills: config.installedSkills })
  }

  let mcpServersNeedsFix = false
  const normalizedMcpServers = Array.isArray(config.mcpServers)
    ? config.mcpServers
        .map((server) => {
          if (!server || typeof server !== 'object') {
            mcpServersNeedsFix = true
            return null
          }
          const transport = normalizeString(server.transport).trim().toLowerCase() === 'builtin' ? 'builtin' : 'http'
          const normalized = {
            id: ensureObjectId(server, 'mcp'),
            name: normalizeString(server.name),
            transport,
            httpUrl: transport === 'http' ? normalizeString(server.httpUrl) : '',
            apiKey: transport === 'http' ? normalizeString(server.apiKey) : '',
            active: server.active !== false,
          }
          if (JSON.stringify(normalized) !== JSON.stringify(server)) mcpServersNeedsFix = true
          return normalized.name ? normalized : null
        })
        .filter(Boolean)
    : []
  if (!Array.isArray(config.mcpServers)) mcpServersNeedsFix = true
  if (mcpServersNeedsFix) {
    config.mcpServers = normalizedMcpServers
    await Browser.storage.local.set({ mcpServers: config.mcpServers })
  }

  const validAssistantIds = new Set((config.assistants || []).map((a) => a.id))
  const validSkillIds = new Set((config.installedSkills || []).map((s) => s.id))
  const validMcpServerIds = new Set((config.mcpServers || []).map((s) => s.id))

  let assistantRefsNeedFix = false
  const fixedAssistants = (config.assistants || []).map((assistant) => {
    if (!assistant || typeof assistant !== 'object') return assistant
    const fixedDefaultSkillIds = normalizeStringArray(assistant.defaultSkillIds).filter((id) =>
      validSkillIds.has(id),
    )
    const fixedDefaultMcpServerIds = normalizeStringArray(assistant.defaultMcpServerIds).filter((id) =>
      validMcpServerIds.has(id),
    )
    if (
      !Array.isArray(assistant.defaultSkillIds) ||
      !Array.isArray(assistant.defaultMcpServerIds) ||
      fixedDefaultSkillIds.length !== assistant.defaultSkillIds.length ||
      fixedDefaultMcpServerIds.length !== assistant.defaultMcpServerIds.length
    ) {
      assistantRefsNeedFix = true
      return {
        ...assistant,
        defaultSkillIds: fixedDefaultSkillIds,
        defaultMcpServerIds: fixedDefaultMcpServerIds,
      }
    }
    return assistant
  })
  if (assistantRefsNeedFix) {
    config.assistants = fixedAssistants
    await Browser.storage.local.set({ assistants: config.assistants })
  }

  let defaultSelectionNeedsFix = false
  const defaultMigrationNeedsPersist =
    agentDefaultsMigrationVersion < AgentDefaultsMigrationVersion.clearLegacyDesignDefaults
  const normalizedDefaultAssistantId = normalizeString(config.defaultAssistantId)
  if (normalizedDefaultAssistantId !== config.defaultAssistantId) {
    config.defaultAssistantId = normalizedDefaultAssistantId
    defaultSelectionNeedsFix = true
  }
  if (config.defaultAssistantId && !validAssistantIds.has(config.defaultAssistantId)) {
    config.defaultAssistantId = ''
    defaultSelectionNeedsFix = true
  }

  const fixedDefaultSkillIds = normalizeStringArray(config.defaultSkillIds).filter((id) =>
    validSkillIds.has(id),
  )
  if (
    !Array.isArray(config.defaultSkillIds) ||
    fixedDefaultSkillIds.length !== config.defaultSkillIds.length
  ) {
    config.defaultSkillIds = fixedDefaultSkillIds
    defaultSelectionNeedsFix = true
  }

  const fixedDefaultMcpServerIds = normalizeStringArray(config.defaultMcpServerIds).filter((id) =>
    validMcpServerIds.has(id),
  )
  if (
    !Array.isArray(config.defaultMcpServerIds) ||
    fixedDefaultMcpServerIds.length !== config.defaultMcpServerIds.length
  ) {
    config.defaultMcpServerIds = fixedDefaultMcpServerIds
    defaultSelectionNeedsFix = true
  }

  if (defaultMigrationNeedsPersist) {
    const isLegacyDesignDefaultProfile =
      config.defaultAssistantId === BuiltInAssistantIds.designAssistant &&
      config.defaultSkillIds.length === 1 &&
      config.defaultSkillIds[0] === BuiltInSkillIds.analyzeWebDesignPatterns &&
      config.defaultMcpServerIds.length === 1 &&
      config.defaultMcpServerIds[0] === BuiltInMcpServerIds.skillLibrary
    if (isLegacyDesignDefaultProfile) {
      config.defaultAssistantId = ''
      config.defaultSkillIds = []
      config.defaultMcpServerIds = []
      defaultSelectionNeedsFix = true
    }
  }

  if (defaultSelectionNeedsFix || defaultMigrationNeedsPersist) {
    const storagePatch = {}
    if (defaultSelectionNeedsFix) {
      Object.assign(storagePatch, {
        defaultAssistantId: config.defaultAssistantId,
        defaultSkillIds: config.defaultSkillIds,
        defaultMcpServerIds: config.defaultMcpServerIds,
      })
    }
    if (defaultMigrationNeedsPersist) {
      storagePatch.agentDefaultsMigrationVersion =
        AgentDefaultsMigrationVersion.clearLegacyDesignDefaults
    }
    await Browser.storage.local.set(storagePatch)
  }

  const storedSiteAdapters = Array.isArray(options.siteAdapters)
    ? options.siteAdapters
    : config.siteAdapters
  const newSiteAdapters = defaultConfig.siteAdapters.filter(
    (key) => !storedSiteAdapters.includes(key),
  )
  if (newSiteAdapters.length > 0) {
    config.siteAdapters = [...storedSiteAdapters, ...newSiteAdapters]
    const storedActive = Array.isArray(options.activeSiteAdapters)
      ? options.activeSiteAdapters
      : config.activeSiteAdapters
    const newActive = defaultConfig.activeSiteAdapters.filter((key) =>
      newSiteAdapters.includes(key),
    )
    config.activeSiteAdapters = Array.from(new Set([...storedActive, ...newActive]))
  }

  return config
}

/**
 * set user config to local storage
 * @param {Partial<UserConfig>} value
 */
export async function setUserConfig(value) {
  await Browser.storage.local.set(value)
}

export async function setAccessToken(accessToken) {
  await setUserConfig({ accessToken, tokenSavedOn: Date.now() })
}

const TOKEN_DURATION = 30 * 24 * 3600 * 1000

export async function clearOldAccessToken() {
  const duration = Date.now() - (await getUserConfig()).tokenSavedOn
  if (duration > TOKEN_DURATION) {
    await setAccessToken('')
  }
}
