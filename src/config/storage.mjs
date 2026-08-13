import { defaults } from 'lodash-es'
import Browser from 'webextension-polyfill'
import { isMobile } from '../utils/is-mobile.mjs'
import { defaultExtractor } from './extractors.mjs'
import { clampNumericConfig } from './numeric-config.mjs'
import {
  AgentProtocol,
  BuiltInIds,
  ENABLE_AGENT_FEATURES,
  RuntimeMode,
  normalizeAgentProtocol,
} from './constants.mjs'
import {
  CHATGPT_WEB_DEFAULT_MODEL_KEY,
  CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
} from './limits.mjs'
import { DefaultActiveModelKeysByGroup, DefaultEnabledProviderGroups, Models } from './models.mjs'
import {
  AgentDefaultsMigrationVersion,
  migrateArrayField,
  normalizeLegacyChatgptWebModelName,
} from './migrations.mjs'

const BuiltInSkillIds = BuiltInIds.skill
const BuiltInAssistantIds = BuiltInIds.assistant
const BuiltInMcpServerIds = BuiltInIds.mcpServer

const defaultBuiltInSkills = ENABLE_AGENT_FEATURES
  ? [
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
  : []

const defaultBuiltInMcpServers = ENABLE_AGENT_FEATURES
  ? [
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
  : []

const defaultBuiltInAssistants = ENABLE_AGENT_FEATURES
  ? [
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
  : []

export function getNavigatorLanguage() {
  const l = navigator.language.toLowerCase()
  if (['zh-hk', 'zh-mo', 'zh-tw', 'zh-cht', 'zh-hant'].includes(l)) return 'zhHant'
  return l.substring(0, 2)
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
  enableSkills: ENABLE_AGENT_FEATURES,
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

  maxResponseTokenLength: DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  maxConversationContextLength: 9,
  temperature: 1,
  apiServerEnabled: false,
  apiServerPort: 18080,
  // Shared secret printed by scripts/api-server.mjs on startup; without it the
  // gateway refuses the bridge connection.
  apiServerBridgeToken: '',
  apiServerKeepHistory: false,
  apiServerRequestTimeoutSeconds: DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  apiServerThinkingTimeoutSeconds: DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  customChatGptWebApiUrl: 'https://chatgpt.com',
  customChatGptWebApiPath: '/backend-api/f/conversation',
  chatgptWebThinkingEffort: CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
  chatgptWebConversationPollTimeoutSeconds: DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  chatgptWebConversationPollIntervalSeconds: DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  chatgptWebHistorySyncEnabled: false,
  chatgptWebHistoryAutoSyncMode: 'off',
  chatgptWebHistorySyncRpm: DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  chatgptWebHistorySyncIntervalHours: DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  chatgptWebHistorySyncArchived: false,
  chatgptWebHistorySyncOnlyWhenIdle: true,
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
  customContentExtractors: [{ ...defaultExtractor }],
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
  // Observed from chatgpt.com requests for Team/Enterprise account scoping.
  chatgptAccountId: '',
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

/**
 * get user config from local storage
 * @returns {Promise<UserConfig>}
 */
export async function getUserConfig() {
  const options = await Browser.storage.local.get(Object.keys(defaultConfig))
  const migrationMeta = await Browser.storage.local.get({
    agentDefaultsMigrationVersion: 0,
    customScriptMigrationDone: false,
  })
  const agentDefaultsMigrationVersion = Number(migrationMeta.agentDefaultsMigrationVersion) || 0
  if (options.customChatGptWebApiUrl === 'https://chat.openai.com')
    options.customChatGptWebApiUrl = 'https://chatgpt.com'
  const config = defaults(options, defaultConfig)

  // Guard against invalid numeric values (e.g. NaN) persisted by user input/imports.
  // Table-driven: each numeric field is declared once in numeric-config.mjs;
  // the clamp, change-detection, and write-back are all derived from that one
  // table. Adding a numeric field means adding one row — no 3-place edit.
  const { clampedValues: numericFix, needsFix } = clampNumericConfig(config, defaultConfig)
  if (needsFix) {
    Object.assign(config, numericFix)
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
  config.apiServerEnabled = config.apiServerEnabled === true
  config.apiServerKeepHistory = config.apiServerKeepHistory === true
  config.chatgptWebHistorySyncEnabled = config.chatgptWebHistorySyncEnabled === true
  config.chatgptWebHistorySyncArchived = config.chatgptWebHistorySyncArchived === true
  config.chatgptWebHistorySyncOnlyWhenIdle = config.chatgptWebHistorySyncOnlyWhenIdle !== false
  if (!['off', 'adaptive', 'fixed'].includes(config.chatgptWebHistoryAutoSyncMode)) {
    config.chatgptWebHistoryAutoSyncMode = 'off'
    await Browser.storage.local.set({ chatgptWebHistoryAutoSyncMode: 'off' })
  }
  config.enableSkills = ENABLE_AGENT_FEATURES && config.enableSkills === true

  const normalizedChatgptWebThinkingEffort = ['standard', 'max'].includes(
    config.chatgptWebThinkingEffort,
  )
    ? config.chatgptWebThinkingEffort
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

  if (Array.isArray(config.customApiModes)) {
    await migrateArrayField(config, 'customApiModes', (apiMode) => {
      if (!apiMode || typeof apiMode !== 'object') return apiMode
      if (typeof apiMode.displayName === 'string') return apiMode
      return { ...apiMode, displayName: '' }
    })
  }

  if (apiModeNeedsFix) {
    await Browser.storage.local.set({ apiMode: config.apiMode })
  }

  // Strip the removed 'custom script' extractor field and coerce its method to 'auto'.
  // The dynamic-script extraction path was unsafe and has been removed.
  // Gated behind a one-shot flag so we don't re-walk the array on every load.
  if (!migrationMeta.customScriptMigrationDone) {
    await migrateArrayField(config, 'customContentExtractors', (ex) => {
      if (!ex || typeof ex !== 'object') return ex
      const hasCustomScript = 'customScript' in ex
      const hasCustomMethod = ex.method === 'custom'
      if (!hasCustomScript && !hasCustomMethod) return ex
      // eslint-disable-next-line no-unused-vars
      const { customScript, ...rest } = ex
      return hasCustomMethod ? { ...rest, method: 'auto' } : rest
    })
    await Browser.storage.local.set({ customScriptMigrationDone: true })
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
          const transport =
            normalizeString(server.transport).trim().toLowerCase() === 'builtin'
              ? 'builtin'
              : 'http'
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
    const fixedDefaultMcpServerIds = normalizeStringArray(assistant.defaultMcpServerIds).filter(
      (id) => validMcpServerIds.has(id),
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

  if (!ENABLE_AGENT_FEATURES) {
    config.assistants = []
    config.defaultAssistantId = ''
    config.installedSkills = []
    config.defaultSkillIds = []
    config.mcpServers = []
    config.defaultMcpServerIds = []
    config.enableSkills = false
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

export async function getPreferredLanguageKey() {
  const config = await getUserConfig()
  if (config.preferredLanguage === 'auto') return config.userLanguage
  return config.preferredLanguage
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
