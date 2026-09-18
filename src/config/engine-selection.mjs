// Engine selection: the only picker unit is `{providerId}/{modelId}`.
// L1 rows live in `l1Providers`. L2/L3 are fixed product engines.

import { CHATGPT_WEB_DEFAULT_MODEL_SLUG } from './limits.mjs'
import { Models } from './models.mjs'

export const PROVIDER_SCHEMA_VERSION = 2

export const L2_CHATGPT_WEB = 'chatgptweb'
export const L2_GROK_WEB = 'grokweb'
export const L3_DSH = 'dsh'

export const L1_FORMATS = Object.freeze([
  'openai-compat',
  'anthropic',
  'ollama',
  'completions',
  'azure',
])

export const TOKENDANCE_KEYS_URL = 'https://tokendance.space/keys'

export const DEFAULT_ENGINE_SELECTION = `${L2_CHATGPT_WEB}/${CHATGPT_WEB_DEFAULT_MODEL_SLUG}`
export const DSH_ENGINE_SELECTION = `${L3_DSH}/agent`

export const L1_PROVIDER_PRESETS = Object.freeze([
  {
    id: 'tokendance',
    name: 'TokenDance',
    format: 'openai-compat',
    baseUrl: 'https://tokendance.space/gateway/v1',
    keysUrl: TOKENDANCE_KEYS_URL,
    modelId: 'deepseek-v4.1-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    format: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    keysUrl: 'https://platform.openai.com/api-keys',
    modelId: '',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    format: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/keys',
    modelId: '',
  },
])

const RESERVED_PROVIDER_IDS = new Set([L2_CHATGPT_WEB, L2_GROK_WEB, L3_DSH])

export function createDefaultL1Providers() {
  return [
    {
      id: 'tokendance',
      name: 'TokenDance',
      format: 'openai-compat',
      preset: 'tokendance',
      baseUrl: 'https://tokendance.space/gateway/v1',
      apiKey: '',
      models: [{ id: 'deepseek-v4.1-flash', enabled: true, source: 'manual' }],
    },
  ]
}

export function parseEngineSelection(selection) {
  if (typeof selection !== 'string' || !selection) return null
  const slash = selection.indexOf('/')
  if (slash <= 0) return null
  const providerId = selection.slice(0, slash).trim()
  const modelId = selection.slice(slash + 1).trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

export function formatEngineSelection(providerId, modelId) {
  return `${providerId}/${modelId}`
}

function canonicalizeEngineSelection(value) {
  if (typeof value !== 'string' || !value) return value
  if (parseEngineSelection(value)) return value
  if (value === 'dshHarnessAgent') return DSH_ENGINE_SELECTION
  const meta = Models[value]
  if (meta && typeof meta.value === 'string' && meta.value) {
    if (value.startsWith('chatgptWeb')) return formatEngineSelection(L2_CHATGPT_WEB, meta.value)
    if (value.startsWith('grokWeb')) return formatEngineSelection(L2_GROK_WEB, meta.value)
  }
  return value
}

export function getSelectionString(configOrSession) {
  if (!configOrSession || typeof configOrSession !== 'object') return ''
  if (typeof configOrSession.apiMode?.engineSelection === 'string') {
    return canonicalizeEngineSelection(configOrSession.apiMode.engineSelection)
  }
  if (typeof configOrSession.modelName === 'string') {
    return canonicalizeEngineSelection(configOrSession.modelName)
  }
  return ''
}

export function isEngineSelection(value) {
  return Boolean(parseEngineSelection(value))
}

export function isStaleEngineSelection(value) {
  return typeof value === 'string' && value.length > 0 && !parseEngineSelection(value)
}

export function findL1Provider(config, providerId) {
  const list = Array.isArray(config?.l1Providers) ? config.l1Providers : []
  return list.find((provider) => provider && provider.id === providerId) || null
}

function l1FormatOf(provider) {
  return L1_FORMATS.includes(provider?.format) ? provider.format : 'openai-compat'
}

/**
 * Classify a session/config selection for routing.
 * @returns {{ kind: string, providerId?: string, modelId?: string, format?: string, provider?: object }}
 */
export function resolveEngine(configOrSession, config) {
  const selection = getSelectionString(configOrSession)
  const parsed = parseEngineSelection(selection)
  if (!parsed) return { kind: 'unknown', selection }
  const { providerId, modelId } = parsed
  if (providerId === L2_CHATGPT_WEB) {
    return { kind: 'chatgpt-web', providerId, modelId, selection }
  }
  if (providerId === L2_GROK_WEB) {
    return { kind: 'grok-web', providerId, modelId, selection }
  }
  if (providerId === L3_DSH) {
    return { kind: 'dsh-bridge', providerId, modelId, selection }
  }
  const cfg = config && typeof config === 'object' ? config : configOrSession
  const provider = findL1Provider(cfg, providerId)
  return {
    kind: 'l1',
    providerId,
    modelId,
    format: l1FormatOf(provider),
    provider,
    selection,
  }
}

export function isUsingChatgptWebEngine(configOrSession) {
  return resolveEngine(configOrSession).kind === 'chatgpt-web'
}

export function isUsingGrokWebEngine(configOrSession) {
  return resolveEngine(configOrSession).kind === 'grok-web'
}

export function isUsingDshEngine(configOrSession) {
  return resolveEngine(configOrSession).kind === 'dsh-bridge'
}

export function isUsingL1Engine(configOrSession, config) {
  const resolved = resolveEngine(configOrSession, config)
  return resolved.kind === 'l1' && Boolean(resolved.provider)
}

export function isUsingL1Format(configOrSession, format, config) {
  const resolved = resolveEngine(configOrSession, config)
  return resolved.kind === 'l1' && Boolean(resolved.provider) && resolved.format === format
}

export function resolveL1Credentials(session, config) {
  const resolved = resolveEngine(session, config)
  if (resolved.kind !== 'l1' || !resolved.provider) return null
  return {
    format: resolved.format,
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    name: resolved.provider.name,
    baseUrl: typeof resolved.provider.baseUrl === 'string' ? resolved.provider.baseUrl.trim() : '',
    apiKey: typeof resolved.provider.apiKey === 'string' ? resolved.provider.apiKey : '',
  }
}

export function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '')
}

export function stripTrailingV1(url) {
  return stripTrailingSlash(url).replace(/\/v1$/i, '')
}

function normalizeModelEntry(entry) {
  if (typeof entry === 'string' && entry.trim()) {
    return { id: entry.trim(), enabled: true, source: 'manual' }
  }
  if (!entry || typeof entry !== 'object') return null
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (!id) return null
  return {
    id,
    enabled: entry.enabled !== false,
    source: entry.source === 'fetched' ? 'fetched' : 'manual',
  }
}

export function normalizeL1Provider(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const format = l1FormatOf(raw)
  let id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id || RESERVED_PROVIDER_IDS.has(id)) {
    id = `provider-${index + 1}`
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
  const models = Array.isArray(raw.models)
    ? raw.models.map(normalizeModelEntry).filter(Boolean)
    : []
  return {
    id,
    name,
    format,
    preset: typeof raw.preset === 'string' ? raw.preset : null,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    models,
  }
}

export function normalizeL1Providers(list) {
  if (!Array.isArray(list) || list.length === 0) return createDefaultL1Providers()
  const seen = new Set()
  const next = []
  list.forEach((raw, index) => {
    const provider = normalizeL1Provider(raw, index)
    if (!provider) return
    let id = provider.id
    let suffix = 2
    while (seen.has(id) || RESERVED_PROVIDER_IDS.has(id)) {
      id = `${provider.id}-${suffix}`
      suffix += 1
    }
    seen.add(id)
    next.push({ ...provider, id })
  })
  return next.length > 0 ? next : createDefaultL1Providers()
}

export function enabledL1Selections(config) {
  const list = Array.isArray(config?.l1Providers) ? config.l1Providers : []
  const out = []
  for (const provider of list) {
    if (!provider?.id) continue
    const models = Array.isArray(provider.models) ? provider.models : []
    for (const model of models) {
      if (!model?.id || model.enabled === false) continue
      out.push({
        value: formatEngineSelection(provider.id, model.id),
        providerId: provider.id,
        modelId: model.id,
        providerName: provider.name || provider.id,
        format: l1FormatOf(provider),
      })
    }
  }
  return out
}

export function enabledChatgptWebSelections(config) {
  if (config?.chatgptWebEnabled === false) return []
  const catalog = Array.isArray(config?.chatgptWebAccountModels)
    ? config.chatgptWebAccountModels.filter(Boolean)
    : []
  let enabled = Array.isArray(config?.chatgptWebEnabledModels)
    ? config.chatgptWebEnabledModels.filter(Boolean)
    : []
  if (enabled.length === 0) {
    enabled = catalog.includes(CHATGPT_WEB_DEFAULT_MODEL_SLUG)
      ? [CHATGPT_WEB_DEFAULT_MODEL_SLUG]
      : catalog.length > 0
      ? [catalog[0]]
      : [CHATGPT_WEB_DEFAULT_MODEL_SLUG]
  }
  const catalogSet = new Set(catalog)
  return enabled
    .filter((slug) => catalog.length === 0 || catalogSet.has(slug))
    .map((slug) => ({
      value: formatEngineSelection(L2_CHATGPT_WEB, slug),
      providerId: L2_CHATGPT_WEB,
      modelId: slug,
      providerName: 'ChatGPT Web',
    }))
}

export function enabledGrokWebSelections(config) {
  if (config?.grokWebEnabled !== true) return []
  const catalog = Array.isArray(config?.grokWebAccountModels)
    ? config.grokWebAccountModels.filter(Boolean)
    : []
  let enabled = Array.isArray(config?.grokWebEnabledModels)
    ? config.grokWebEnabledModels.filter(Boolean)
    : []
  if (enabled.length === 0) enabled = catalog
  const catalogSet = new Set(catalog)
  return enabled
    .filter((slug) => catalog.length === 0 || catalogSet.has(slug))
    .map((slug) => ({
      value: formatEngineSelection(L2_GROK_WEB, slug),
      providerId: L2_GROK_WEB,
      modelId: slug,
      providerName: 'Grok Web',
    }))
}

export function enabledDshSelections(config) {
  if (config?.dshModuleEnabled !== true) return []
  return [
    {
      value: DSH_ENGINE_SELECTION,
      providerId: L3_DSH,
      modelId: 'agent',
      providerName: 'DeepSeek Harness',
    },
  ]
}

/**
 * Enabled picker rows in product order: L1 → ChatGPT Web → Grok Web → DSH.
 */
export function listEnabledEngineSelections(config) {
  return [
    ...enabledL1Selections(config),
    ...enabledChatgptWebSelections(config),
    ...enabledGrokWebSelections(config),
    ...enabledDshSelections(config),
  ]
}

export function isEnabledEngineSelection(selection, config) {
  return listEnabledEngineSelections(config).some((item) => item.value === selection)
}

export function keysUrlForL1Provider(provider) {
  if (provider?.preset === 'tokendance' || provider?.id === 'tokendance') return TOKENDANCE_KEYS_URL
  const preset = L1_PROVIDER_PRESETS.find((item) => item.id === provider?.preset)
  return preset?.keysUrl || ''
}

export function newL1ProviderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createL1ProviderFromPreset(presetId, existingIds = []) {
  const preset = L1_PROVIDER_PRESETS.find((item) => item.id === presetId)
  if (preset) {
    const wantFixedId = preset.id === 'tokendance' && !existingIds.includes('tokendance')
    return {
      id: wantFixedId ? 'tokendance' : newL1ProviderId(),
      name: preset.name,
      format: preset.format,
      preset: preset.id,
      baseUrl: preset.baseUrl,
      apiKey: '',
      models: preset.modelId ? [{ id: preset.modelId, enabled: true, source: 'manual' }] : [],
    }
  }
  return createBlankL1Provider()
}

export function engineSelectionLabel(selection, t = (value) => value) {
  const parsed = parseEngineSelection(selection)
  if (parsed) return selection
  if (!selection) return t('Default engine')
  return `${t('Stale engine')}: ${selection}`
}

export function applyEngineSelectionPatch(selection) {
  return { modelName: selection, apiMode: null }
}

export function firstEnabledSelection(config) {
  return listEnabledEngineSelections(config)[0]?.value || DEFAULT_ENGINE_SELECTION
}

export function createBlankL1Provider(format = 'openai-compat') {
  const resolvedFormat = L1_FORMATS.includes(format) ? format : 'openai-compat'
  const baseUrl =
    resolvedFormat === 'ollama'
      ? 'http://127.0.0.1:11434'
      : resolvedFormat === 'anthropic'
      ? 'https://api.anthropic.com'
      : resolvedFormat === 'completions'
      ? 'https://api.openai.com'
      : ''
  return {
    id: newL1ProviderId(),
    name: 'Custom provider',
    format: resolvedFormat,
    preset: null,
    baseUrl,
    apiKey: '',
    models: [],
  }
}
