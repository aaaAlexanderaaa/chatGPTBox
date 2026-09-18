import PropTypes from 'prop-types'
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSection, ToggleSwitch, Divider } from './SettingComponents.jsx'
import { SearchableSelect } from './SearchableSelect.jsx'
import { buildEngineOptions, patchEngineSelection } from './engine-options.mjs'
import { cn } from '../../utils/cn.mjs'
import {
  deriveV1BaseUrlFromEndpoint,
  fetchOllamaTags,
  fetchV1Models,
} from '../../services/model-lists.mjs'
import {
  L1_FORMATS,
  L1_PROVIDER_PRESETS,
  createBlankL1Provider,
  createL1ProviderFromPreset,
  firstEnabledSelection,
  getSelectionString,
  keysUrlForL1Provider,
  normalizeL1Providers,
} from '../../config/engine-selection.mjs'

const inputClassName =
  'h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-foreground placeholder:text-muted-foreground'

const FORMAT_LABELS = {
  'openai-compat': 'OpenAI-compatible',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  completions: 'GPT Completions',
  azure: 'Azure',
}

function persistProviders(updateConfig, providers) {
  updateConfig({ l1Providers: normalizeL1Providers(providers) })
}

function mergeFetchedModels(existing, ids) {
  const next = new Map((existing || []).map((model) => [model.id, model]))
  for (const id of ids) {
    if (!id) continue
    if (!next.has(id)) next.set(id, { id, enabled: false, source: 'fetched' })
  }
  return [...next.values()]
}

function L1ProviderRow({ provider, expanded, onToggle, config, updateConfig, t }) {
  const [draftModel, setDraftModel] = useState('')
  const [fetchError, setFetchError] = useState('')
  const [fetching, setFetching] = useState(false)
  const keysUrl = keysUrlForL1Provider(provider)
  const models = Array.isArray(provider.models) ? provider.models : []

  const patchProvider = (partial) => {
    const next = (config.l1Providers || []).map((item) =>
      item.id === provider.id ? { ...item, ...partial } : item,
    )
    persistProviders(updateConfig, next)
  }

  const fetchModels = async () => {
    setFetching(true)
    setFetchError('')
    try {
      let ids = []
      if (provider.format === 'ollama') {
        ids = await fetchOllamaTags(provider.baseUrl)
      } else {
        const v1BaseUrl = deriveV1BaseUrlFromEndpoint(provider.baseUrl)
        ids = await fetchV1Models({ v1BaseUrl, apiKey: provider.apiKey })
      }
      patchProvider({ models: mergeFetchedModels(models, ids) })
    } catch {
      setFetchError(t('This endpoint has no standard model list. Type a model id.'))
    } finally {
      setFetching(false)
    }
  }

  const addModel = () => {
    const id = draftModel.trim()
    if (!id) return
    if (models.some((model) => model.id === id)) {
      setDraftModel('')
      return
    }
    patchProvider({
      models: [...models, { id, enabled: true, source: 'manual' }],
    })
    setDraftModel('')
  }

  const removeProvider = () => {
    const next = (config.l1Providers || []).filter((item) => item.id !== provider.id)
    const patch = { l1Providers: normalizeL1Providers(next) }
    const current = getSelectionString(config)
    if (current.startsWith(`${provider.id}/`)) {
      patch.modelName = firstEnabledSelection({ ...config, ...patch })
      patch.apiMode = null
    }
    updateConfig(patch)
  }

  return (
    <div className="rounded-xl border border-border bg-card/60">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="font-medium text-sm text-foreground">{provider.name || provider.id}</span>
        <span className="text-[11px] text-muted-foreground">
          {FORMAT_LABELS[provider.format] || provider.format}
        </span>
      </button>
      {!expanded && models.filter((model) => model.enabled !== false).length > 0 && (
        <ul className="px-10 pb-3 space-y-1">
          {models
            .filter((model) => model.enabled !== false)
            .map((model) => (
              <li key={model.id} className="text-xs text-muted-foreground font-mono">
                {provider.id}/{model.id}
              </li>
            ))}
        </ul>
      )}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/60 pt-3">
          <SettingRow label={t('Name')}>
            <input
              className={cn(inputClassName, 'w-[220px]')}
              value={provider.name || ''}
              onChange={(event) => patchProvider({ name: event.target.value })}
            />
          </SettingRow>
          <SettingRow label={t('Format')} hint={t('Request shape for this provider')}>
            <select
              className={cn(inputClassName, 'w-[220px]')}
              value={provider.format}
              onChange={(event) => patchProvider({ format: event.target.value })}
            >
              {L1_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            label={t('Base URL')}
            hint={t('Store the /v1 origin. Chat uses {base}/chat/completions.')}
          >
            <input
              className={cn(inputClassName, 'w-[320px]')}
              value={provider.baseUrl || ''}
              placeholder="https://api.example.com/v1"
              onChange={(event) => patchProvider({ baseUrl: event.target.value })}
            />
          </SettingRow>
          <SettingRow label={t('API Key')}>
            <div className="flex items-center gap-2">
              <input
                type="password"
                className={cn(inputClassName, 'w-[260px]')}
                value={provider.apiKey || ''}
                onChange={(event) => patchProvider({ apiKey: event.target.value })}
              />
              {keysUrl ? (
                <a
                  href={keysUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t('Get')}
                </a>
              ) : null}
            </div>
          </SettingRow>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{t('Models')}</p>
              <button
                type="button"
                className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
                onClick={() => void fetchModels()}
                disabled={fetching}
              >
                {fetching ? t('Fetching…') : t('Fetch models')}
              </button>
            </div>
            {fetchError ? <p className="text-xs text-destructive">{fetchError}</p> : null}
            <ul className="space-y-1">
              {models.map((model) => (
                <li key={model.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={model.enabled !== false}
                    onChange={(event) =>
                      patchProvider({
                        models: models.map((item) =>
                          item.id === model.id ? { ...item, enabled: event.target.checked } : item,
                        ),
                      })
                    }
                  />
                  <span className="font-mono text-xs">{model.id}</span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      patchProvider({ models: models.filter((item) => item.id !== model.id) })
                    }
                  >
                    {t('Remove')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input
                className={cn(inputClassName, 'flex-1')}
                value={draftModel}
                placeholder={t('Type a model id')}
                onChange={(event) => setDraftModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addModel()
                  }
                }}
              />
              <button
                type="button"
                className="h-9 px-3 text-xs font-medium bg-secondary rounded-lg"
                onClick={addModel}
              >
                {t('Add')}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-destructive"
            onClick={removeProvider}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('Remove provider')}
          </button>
        </div>
      )}
    </div>
  )
}

L1ProviderRow.propTypes = {
  provider: PropTypes.object.isRequired,
  expanded: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
}

function AddProviderForm({ config, updateConfig, onClose, t }) {
  const [presetId, setPresetId] = useState('')
  const [draft, setDraft] = useState(() => createBlankL1Provider())

  const applyPreset = (id) => {
    setPresetId(id)
    if (!id) {
      setDraft(createBlankL1Provider())
      return
    }
    const existingIds = (config.l1Providers || []).map((item) => item.id)
    setDraft(createL1ProviderFromPreset(id, existingIds))
  }

  const save = () => {
    const next = [...(config.l1Providers || []), draft]
    persistProviders(updateConfig, next)
    onClose()
  }

  return (
    <div className="rounded-xl border border-dashed border-border p-3 space-y-3">
      <SettingRow label={t('Preset')} hint={t('Prefills a common OpenAI-compatible URL')}>
        <select
          className={cn(inputClassName, 'w-[220px]')}
          value={presetId}
          onChange={(event) => applyPreset(event.target.value)}
        >
          <option value="">{t('Blank provider')}</option>
          {L1_PROVIDER_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('Name')}>
        <input
          className={cn(inputClassName, 'w-[220px]')}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </SettingRow>
      <SettingRow label={t('Format')}>
        <select
          className={cn(inputClassName, 'w-[220px]')}
          value={draft.format}
          onChange={(event) =>
            setDraft({
              ...createBlankL1Provider(event.target.value),
              name: draft.name,
              apiKey: draft.apiKey,
            })
          }
        >
          {L1_FORMATS.map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('Base URL')}>
        <input
          className={cn(inputClassName, 'w-[320px]')}
          value={draft.baseUrl}
          onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
        />
      </SettingRow>
      <div className="flex gap-2">
        <button
          type="button"
          className="h-9 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-lg"
          onClick={save}
        >
          {t('Add provider')}
        </button>
        <button
          type="button"
          className="h-9 px-3 text-xs font-medium bg-secondary rounded-lg"
          onClick={onClose}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

AddProviderForm.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
}

function WebEngineRow({ title, enabled, onToggle, onOpen, t }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-3">
      <span className="font-medium text-sm flex-1">{title}</span>
      <button type="button" className="text-xs text-primary hover:underline" onClick={onOpen}>
        {t('Open settings')}
      </button>
      <ToggleSwitch checked={enabled} onChange={onToggle} />
    </div>
  )
}

WebEngineRow.propTypes = {
  title: PropTypes.string.isRequired,
  enabled: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
}

export function EnginesTab({ config, updateConfig, onOpenEngineTab, enablePrompt }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const engineOptions = useMemo(() => buildEngineOptions(config, t), [config, t])
  const selectedModelName = getSelectionString(config)
  const providers = Array.isArray(config.l1Providers) ? config.l1Providers : []

  const setDefaultEngine = (value) => updateConfig(patchEngineSelection(value))

  const toggleWebEngine = (key, enabled, tabId) => {
    const patch = { [key]: enabled }
    const merged = { ...config, ...patch }
    const current = getSelectionString(merged)
    const stillEnabled = buildEngineOptions(merged, t).some((option) => option.value === current)
    if (!stillEnabled) {
      patch.modelName = firstEnabledSelection(merged)
      patch.apiMode = null
    }
    updateConfig(patch)
    if (enabled) onOpenEngineTab?.(tabId)
  }

  return (
    <div className="space-y-4">
      {enablePrompt ? (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          {enablePrompt}
        </p>
      ) : null}
      {config.showLegacyProviderNotice === true ? (
        <p className="text-xs text-muted-foreground bg-secondary/50 border border-border rounded-lg px-3 py-2">
          {t(
            'Old API provider config is not imported. Re-add providers here. Export is still in Advanced.',
          )}{' '}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => updateConfig({ showLegacyProviderNotice: false })}
          >
            {t('Dismiss')}
          </button>
        </p>
      ) : null}

      <SettingSection
        title={t('Default engine')}
        description={t('Answers everything unless a site overrides it')}
      >
        <SettingRow label={t('Default engine')} hint={t('Select provider / model')}>
          <SearchableSelect
            value={selectedModelName}
            onChange={setDefaultEngine}
            options={engineOptions}
            placeholder={t('Select…')}
            searchPlaceholder={t('Search…')}
            minWidth="260px"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('API providers')}
        description={t('Custom providers and enabled models')}
      >
        <div className="space-y-2">
          {providers.map((provider) => (
            <L1ProviderRow
              key={provider.id}
              provider={provider}
              expanded={expandedId === provider.id}
              onToggle={() => setExpandedId((id) => (id === provider.id ? null : provider.id))}
              config={config}
              updateConfig={updateConfig}
              t={t}
            />
          ))}
          {adding ? (
            <AddProviderForm
              config={config}
              updateConfig={updateConfig}
              onClose={() => setAdding(false)}
              t={t}
            />
          ) : (
            <button
              type="button"
              className="w-full h-10 rounded-xl border border-dashed border-border text-sm inline-flex items-center justify-center gap-1.5 hover:bg-secondary/60"
              onClick={() => setAdding(true)}
            >
              <Plus className="w-4 h-4" />
              {t('+ Provider')}
            </button>
          )}
        </div>
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Web engines')}
        description={t('Slide to enable; each engine has its own tab')}
      >
        <div className="space-y-2">
          <WebEngineRow
            title={t('ChatGPT Web')}
            enabled={config.chatgptWebEnabled !== false}
            onToggle={(value) => toggleWebEngine('chatgptWebEnabled', value, 'chatgptweb')}
            onOpen={() => onOpenEngineTab?.('chatgptweb')}
            t={t}
          />
          <WebEngineRow
            title={t('Grok Web')}
            enabled={config.grokWebEnabled === true}
            onToggle={(value) => toggleWebEngine('grokWebEnabled', value, 'grokweb')}
            onOpen={() => onOpenEngineTab?.('grokweb')}
            t={t}
          />
          <WebEngineRow
            title={t('DeepSeek Harness')}
            enabled={config.dshModuleEnabled === true}
            onToggle={(value) => toggleWebEngine('dshModuleEnabled', value, 'dsh')}
            onOpen={() => onOpenEngineTab?.('dsh')}
            t={t}
          />
        </div>
      </SettingSection>
    </div>
  )
}

EnginesTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  onOpenEngineTab: PropTypes.func,
  enablePrompt: PropTypes.string,
}
