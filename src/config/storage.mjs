import { defaults } from 'lodash-es'
import Browser from 'webextension-polyfill'
import { isMobile } from '../utils/is-mobile.mjs'
import { defaultExtractor } from './extractors.mjs'
import { clampNumericConfig } from './numeric-config.mjs'
import {
  CHATGPT_WEB_DEFAULT_MODEL_KEY,
  CHATGPT_WEB_DEFAULT_THINKING_EFFORT,
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  DEFAULT_MAX_CONVERSATION_CONTEXT_LENGTH,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
} from './limits.mjs'
import { DefaultActiveModelKeysByGroup, DefaultEnabledProviderGroups, Models } from './models.mjs'
import { isChatgptWebThinkingEffort } from '../services/clients/chatgpt-web/thinking.mjs'
import { migrateArrayField, normalizeStoredModelSelection } from './migrations.mjs'
import { getModuleConfigDefaults } from '../modules/index.mjs'
import {
  PROVIDER_SCHEMA_VERSION,
  coerceStoredEngineSelection,
  createDefaultL1Providers,
  getSelectionString,
  normalizeL1Providers,
  sanitizeSiteEngineOverrides,
  siteEngineOverridesDiffer,
} from './engine-selection.mjs'

export function getNavigatorLanguage() {
  const l =
    typeof navigator === 'object' && typeof navigator.language === 'string'
      ? navigator.language.toLowerCase()
      : 'en'
  if (['zh-hk', 'zh-mo', 'zh-tw', 'zh-cht', 'zh-hant'].includes(l)) return 'zhHant'
  return l.substring(0, 2)
}

/**
 * @typedef {typeof defaultConfig} UserConfig
 */
export const defaultConfig = {
  // general

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

  claudeApiKey: '',
  chatglmApiKey: '',
  moonshotApiKey: '',
  deepSeekApiKey: '',

  customApiKey: '',

  customModelApiUrl: 'http://localhost:8000/v1/chat/completions',
  customModelName: 'gpt-4.1',

  ollamaEndpoint: 'http://127.0.0.1:11434',
  ollamaModelName: 'llama4',
  ollamaApiKey: '',
  ollamaKeepAliveTime: '5m',

  openRouterApiKey: '',
  aimlApiKey: '',

  // advanced

  maxResponseTokenLength: DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  maxConversationContextLength: DEFAULT_MAX_CONVERSATION_CONTEXT_LENGTH,
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
  chatgptWebHistoryHydrateLimit: DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
  chatgptWebHistoryHydrateOffset: DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
  chatgptWebHistoryHydrateRetryCount: DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
  chatgptWebHistoryHydrateOrder: 'updated',
  chatgptWebHistoryHydrateIncludeArchived: false,
  chatgptWebHistoryHydrateRefreshListFirst: false,
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
  providerSchemaVersion: PROVIDER_SCHEMA_VERSION,
  l1Providers: createDefaultL1Providers(),
  chatgptWebEnabled: true,
  grokWebEnabled: false,
  chatgptWebEnabledModels: ['gpt-5-6-thinking'],
  grokWebEnabledModels: [],
  showLegacyProviderNotice: false,
  showDeprecatedModels: false,
  // Account-available ChatGPT Web slugs (D-15): written by the background
  // whenever the model catalog refreshes; empty = unknown, pickers filter
  // nothing.
  chatgptWebAccountModels: [],
  grokWebSignedIn: false,
  grokWebAccountTier: '',
  grokWebAccountModels: [],
  // Per-site engine assignment (D-14): site key -> { modelName, apiMode }.
  // An absent/empty entry means "follow the global default engine".
  siteEngineOverrides: {},

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
    'bing',
    'yahoo',
    'duckduckgo',
    'startpage',
    'baidu',
    'kagi',
    'yandex',
    'naver',
    'brave',
    'searx',
    'ecosia',
    'neeva',
    'presearch',
  ],
  accessToken: '',
  tokenSavedOn: 0,
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
    'bing',
    'yahoo',
    'duckduckgo',
    'startpage',
    'baidu',
    'kagi',
    'yandex',
    'naver',
    'brave',
    'searx',
    'ecosia',
    'neeva',
    'presearch',
  ],

  // Optional engine modules contribute their config keys through the module
  // seam (D-10: the settings skeleton ships first, domains migrate in).
  ...getModuleConfigDefaults(),
}

/**
 * get user config from local storage
 * @returns {Promise<UserConfig>}
 */
export async function getUserConfig() {
  const options = await Browser.storage.local.get(Object.keys(defaultConfig))
  const migrationMeta = await Browser.storage.local.get({
    customScriptMigrationDone: false,
  })
  if (options.customChatGptWebApiUrl === 'https://chat.openai.com')
    options.customChatGptWebApiUrl = 'https://chatgpt.com'
  const storedProviderSchemaVersion = options.providerSchemaVersion
  const config = defaults(options, defaultConfig)

  // Provider schema v2 is a cut, not a vendor-config migration. Old
  // enabledProviders / customApiModes / per-vendor API keys stay in storage
  // for Advanced export but are not read into l1Providers.
  if (storedProviderSchemaVersion !== PROVIDER_SCHEMA_VERSION) {
    const hadExistingConfig = Object.keys(options).length > 0
    config.providerSchemaVersion = PROVIDER_SCHEMA_VERSION
    config.l1Providers = createDefaultL1Providers()
    config.chatgptWebEnabled = true
    config.grokWebEnabled = false
    config.chatgptWebEnabledModels = ['gpt-5-6-thinking']
    config.grokWebEnabledModels = []
    config.apiMode = null
    config.modelName = defaultConfig.modelName
    config.siteEngineOverrides = sanitizeSiteEngineOverrides(config.siteEngineOverrides, config)
    const schemaPatch = {
      providerSchemaVersion: PROVIDER_SCHEMA_VERSION,
      l1Providers: config.l1Providers,
      chatgptWebEnabled: true,
      grokWebEnabled: false,
      chatgptWebEnabledModels: config.chatgptWebEnabledModels,
      grokWebEnabledModels: [],
      apiMode: null,
      modelName: config.modelName,
      siteEngineOverrides: config.siteEngineOverrides,
    }
    if (hadExistingConfig) {
      config.showLegacyProviderNotice = true
      schemaPatch.showLegacyProviderNotice = true
    }
    await Browser.storage.local.set(schemaPatch)
  } else {
    config.l1Providers = normalizeL1Providers(config.l1Providers)
  }
  const sanitizedSiteOverrides = sanitizeSiteEngineOverrides(config.siteEngineOverrides, config)
  if (siteEngineOverridesDiffer(config.siteEngineOverrides, sanitizedSiteOverrides)) {
    config.siteEngineOverrides = sanitizedSiteOverrides
    await Browser.storage.local.set({ siteEngineOverrides: sanitizedSiteOverrides })
  } else {
    config.siteEngineOverrides = sanitizedSiteOverrides
  }
  config.chatgptWebEnabled = config.chatgptWebEnabled !== false
  config.grokWebEnabled = config.grokWebEnabled === true
  if (!Array.isArray(config.chatgptWebEnabledModels)) {
    config.chatgptWebEnabledModels = ['gpt-5-6-thinking']
  }
  if (!Array.isArray(config.grokWebEnabledModels)) {
    config.grokWebEnabledModels = []
  }

  // Guard against invalid numeric values (e.g. NaN) persisted by user input/imports.
  // Table-driven: each numeric field is declared once in numeric-config.mjs;
  // the clamp, change-detection, and write-back are all derived from that one
  // table. Adding a numeric field means adding one row — no 3-place edit.
  const { clampedValues: numericFix, needsFix } = clampNumericConfig(config, defaultConfig)
  if (needsFix) {
    Object.assign(config, numericFix)
    await Browser.storage.local.set(numericFix)
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
  config.dshModuleEnabled = config.dshModuleEnabled === true
  config.apiServerEnabled = config.apiServerEnabled === true
  config.apiServerKeepHistory = config.apiServerKeepHistory === true
  config.chatgptWebHistorySyncEnabled = config.chatgptWebHistorySyncEnabled === true
  config.chatgptWebHistorySyncArchived = config.chatgptWebHistorySyncArchived === true
  config.chatgptWebHistorySyncOnlyWhenIdle = config.chatgptWebHistorySyncOnlyWhenIdle !== false
  config.chatgptWebHistoryHydrateIncludeArchived =
    config.chatgptWebHistoryHydrateIncludeArchived === true
  config.chatgptWebHistoryHydrateRefreshListFirst =
    config.chatgptWebHistoryHydrateRefreshListFirst === true
  if (
    !['updated', 'updated_asc', 'created', 'created_asc'].includes(
      config.chatgptWebHistoryHydrateOrder,
    )
  ) {
    config.chatgptWebHistoryHydrateOrder = 'updated'
    await Browser.storage.local.set({ chatgptWebHistoryHydrateOrder: 'updated' })
  }
  if (!['off', 'adaptive', 'fixed'].includes(config.chatgptWebHistoryAutoSyncMode)) {
    config.chatgptWebHistoryAutoSyncMode = 'off'
    await Browser.storage.local.set({ chatgptWebHistoryAutoSyncMode: 'off' })
  }

  const normalizedChatgptWebThinkingEffort = isChatgptWebThinkingEffort(
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

  const normalizedModelName = normalizeStoredModelSelection(config.modelName)
  if (normalizedModelName !== config.modelName) {
    config.modelName = normalizedModelName
    webModelMigrationNeedsFix = true
    webModelMigrationPatch.modelName = config.modelName
  }

  if (config.apiMode && typeof config.apiMode === 'object') {
    const nextItemName = normalizeStoredModelSelection(config.apiMode.itemName)
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
    const migratedActiveApiModes = config.activeApiModes.map(normalizeStoredModelSelection)
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
      const nextItemName = normalizeStoredModelSelection(apiMode.itemName)
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

  const coercedSelection = coerceStoredEngineSelection(getSelectionString(config), config)
  if (config.modelName !== coercedSelection || config.apiMode != null) {
    config.modelName = coercedSelection
    config.apiMode = null
    await Browser.storage.local.set({ modelName: coercedSelection, apiMode: null })
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
    await Browser.storage.local.set({
      siteAdapters: config.siteAdapters,
      activeSiteAdapters: config.activeSiteAdapters,
    })
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
