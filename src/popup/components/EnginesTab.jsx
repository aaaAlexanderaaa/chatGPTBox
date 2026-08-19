import PropTypes from 'prop-types'
import { ExternalLink, CircleDot } from 'lucide-react'
import { useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import {
  SettingRow,
  SettingSection,
  ToggleRow,
  ToggleSwitch,
  Divider,
} from './SettingComponents.jsx'
import { SearchableSelect } from './SearchableSelect.jsx'
import { ApiModes } from '../sections/ApiModes.jsx'
import { buildModuleKit } from './module-kit.mjs'
import { buildEngineOptions } from './engine-options.mjs'
import { cn } from '../../utils/cn.mjs'
import { apiModeToModelName, getApiModesFromConfig } from '../../utils/index.mjs'
import {
  DefaultActiveModelKeysByGroup,
  ModelGroups,
  isModelDeprecated,
} from '../../config/models.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from '../../config/limits.mjs'
import { isUsingChatgptWebModel, isUsingOpenAiApiModel } from '../../config/predicates.mjs'
import { getSettingsCards } from '../../modules/api.mjs'

const inputClassName =
  'h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-foreground placeholder:text-muted-foreground'

// Unified engine anatomy (roadmap C2, definition.md "三个用户概念 · 引擎"):
// every engine gets the same card skeleton — name, capability badges,
// enable toggle, credentials/endpoint, diagnostics — instead of provider
// settings that only appear for the currently selected engine scattered
// between General and Advanced.

const ENGINE_LEVEL_LABELS = {
  1: 'Q&A',
  2: 'Session',
  3: 'Agent',
}

const ENGINE_CARDS = [
  { group: 'chatgptWebModelKeys', level: 2, defaultModel: CHATGPT_WEB_DEFAULT_MODEL_KEY },
  { group: 'chatgptApiModelKeys', level: 1, fields: ['openai-key', 'openai-url'] },
  { group: 'gptApiModelKeys', level: 1, fields: ['openai-key'] },
  {
    group: 'azureOpenAiApiModelKeys',
    level: 1,
    fields: ['azure-endpoint', 'azure-deployment', 'azure-key'],
  },
  { group: 'claudeApiModelKeys', level: 1, fields: ['claude-key', 'claude-url'] },
  { group: 'moonshotApiModelKeys', level: 1, fields: ['moonshot-key'] },
  { group: 'moonshotWebModelKeys', level: 2 },
  { group: 'openRouterApiModelKeys', level: 1, fields: ['openrouter-key'] },
  { group: 'deepSeekApiModelKeys', level: 1, fields: ['deepseek-key'] },
  { group: 'aimlModelKeys', level: 1, fields: ['aiml-key'] },
  {
    group: 'ollamaApiModelKeys',
    level: 1,
    fields: ['ollama-endpoint', 'ollama-model', 'ollama-key', 'ollama-keepalive'],
  },
  { group: 'chatglmApiModelKeys', level: 1, fields: ['chatglm-key'] },
  { group: 'customApiModelKeys', level: 1, fields: ['custom-url', 'custom-key', 'custom-model'] },
]

function EngineFields({ field, config, updateConfig, t }) {
  switch (field) {
    case 'openai-key':
      return (
        <SettingRow label={t('OpenAI API Key')} hint={t('Used for OpenAI API models')}>
          <div className="flex items-center gap-2">
            <input
              type="password"
              placeholder="sk-..."
              value={config.apiKey || ''}
              onChange={(e) => updateConfig({ apiKey: e.target.value })}
              className={cn(inputClassName, 'w-[260px]')}
            />
            <a
              href="https://platform.openai.com/account/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t('Get')}
            </a>
          </div>
        </SettingRow>
      )
    case 'openai-url':
      return (
        <SettingRow label={t('OpenAI Base URL')} hint={t('For proxies / custom domains')}>
          <input
            type="text"
            value={config.customOpenAiApiUrl || ''}
            onChange={(e) => updateConfig({ customOpenAiApiUrl: e.target.value })}
            placeholder="https://api.openai.com"
            className={cn(inputClassName, 'w-[320px]')}
          />
        </SettingRow>
      )
    case 'azure-endpoint':
      return (
        <SettingRow label={t('Azure Endpoint')} hint={t('e.g. https://xxx.openai.azure.com')}>
          <input
            type="text"
            value={config.azureEndpoint || ''}
            onChange={(e) => updateConfig({ azureEndpoint: e.target.value })}
            placeholder="https://..."
            className={cn(inputClassName, 'w-[320px]')}
          />
        </SettingRow>
      )
    case 'azure-deployment':
      return (
        <SettingRow label={t('Azure Deployment Name')} hint={t('Used to build model ID')}>
          <input
            type="text"
            value={config.azureDeploymentName || ''}
            onChange={(e) => updateConfig({ azureDeploymentName: e.target.value })}
            placeholder={t('Deployment name')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'azure-key':
      return (
        <SettingRow label={t('Azure API Key')} hint={t('Credential for Azure OpenAI')}>
          <input
            type="password"
            value={config.azureApiKey || ''}
            onChange={(e) => updateConfig({ azureApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'openrouter-key':
      return (
        <SettingRow label={t('OpenRouter API Key')} hint={t('Used for OpenRouter models')}>
          <input
            type="password"
            value={config.openRouterApiKey || ''}
            onChange={(e) => updateConfig({ openRouterApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'aiml-key':
      return (
        <SettingRow label={t('AIML API Key')} hint={t('Used for AIML models')}>
          <input
            type="password"
            value={config.aimlApiKey || ''}
            onChange={(e) => updateConfig({ aimlApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'claude-key':
      return (
        <SettingRow label={t('Claude API Key')} hint={t('Used for Anthropic API models')}>
          <input
            type="password"
            value={config.claudeApiKey || ''}
            onChange={(e) => updateConfig({ claudeApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'claude-url':
      return (
        <SettingRow label={t('Claude Base URL')} hint={t('For proxies / custom domains')}>
          <input
            type="text"
            value={config.customClaudeApiUrl || ''}
            onChange={(e) => updateConfig({ customClaudeApiUrl: e.target.value })}
            placeholder="https://api.anthropic.com"
            className={cn(inputClassName, 'w-[320px]')}
          />
        </SettingRow>
      )
    case 'moonshot-key':
      return (
        <SettingRow label={t('Moonshot API Key')} hint={t('Used for Moonshot API models')}>
          <input
            type="password"
            value={config.moonshotApiKey || ''}
            onChange={(e) => updateConfig({ moonshotApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'deepseek-key':
      return (
        <SettingRow label={t('DeepSeek API Key')} hint={t('Used for DeepSeek API models')}>
          <input
            type="password"
            value={config.deepSeekApiKey || ''}
            onChange={(e) => updateConfig({ deepSeekApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'chatglm-key':
      return (
        <SettingRow label={t('ChatGLM API Key')} hint={t('Used for ChatGLM API models')}>
          <input
            type="password"
            value={config.chatglmApiKey || ''}
            onChange={(e) => updateConfig({ chatglmApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'ollama-endpoint':
      return (
        <SettingRow label={t('Ollama Endpoint')} hint={t('Local Ollama server')}>
          <input
            type="text"
            value={config.ollamaEndpoint || ''}
            onChange={(e) => updateConfig({ ollamaEndpoint: e.target.value })}
            placeholder="http://127.0.0.1:11434"
            className={cn(inputClassName, 'w-[320px]')}
          />
        </SettingRow>
      )
    case 'ollama-model':
      return (
        <SettingRow label={t('Ollama Model Name')} hint={t('e.g. llama3.1')}>
          <input
            type="text"
            value={config.ollamaModelName || ''}
            onChange={(e) => updateConfig({ ollamaModelName: e.target.value })}
            placeholder="llama3.1"
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'ollama-key':
      return (
        <SettingRow label={t('Ollama API Key')} hint={t('Optional (for proxies)')}>
          <input
            type="password"
            value={config.ollamaApiKey || ''}
            onChange={(e) => updateConfig({ ollamaApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'ollama-keepalive':
      return (
        <SettingRow label={t('Keep Alive')} hint={t('e.g. 5m / 0')}>
          <input
            type="text"
            value={config.ollamaKeepAliveTime || ''}
            onChange={(e) => updateConfig({ ollamaKeepAliveTime: e.target.value })}
            placeholder="5m"
            className={cn(inputClassName, 'w-[140px]')}
          />
        </SettingRow>
      )
    case 'custom-url':
      return (
        <SettingRow label={t('Custom API URL')} hint={t('OpenAI-compatible chat/completions')}>
          <input
            type="text"
            value={config.customModelApiUrl || ''}
            onChange={(e) => updateConfig({ customModelApiUrl: e.target.value })}
            placeholder="http://localhost:8000/v1/chat/completions"
            className={cn(inputClassName, 'w-[360px]')}
          />
        </SettingRow>
      )
    case 'custom-key':
      return (
        <SettingRow label={t('Custom API Key')} hint={t('Optional')}>
          <input
            type="password"
            value={config.customApiKey || ''}
            onChange={(e) => updateConfig({ customApiKey: e.target.value })}
            placeholder={t('API Key')}
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    case 'custom-model':
      return (
        <SettingRow label={t('Custom Model Name')} hint={t('Sent as model field')}>
          <input
            type="text"
            value={config.customModelName || ''}
            onChange={(e) => updateConfig({ customModelName: e.target.value })}
            placeholder="gpt-4.1"
            className={cn(inputClassName, 'w-[260px]')}
          />
        </SettingRow>
      )
    default:
      return null
  }
}

EngineFields.propTypes = {
  field: PropTypes.string.isRequired,
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
}

function EngineCard({ engine, config, updateConfig, selectedGroup }) {
  const { t } = useTranslation()
  const { group, level, fields, defaultModel } = engine
  const meta = ModelGroups[group] || { desc: group, value: [] }
  const enabledProviders = config.enabledProviders || {}
  const enabled = enabledProviders[group] === true
  const inUse = selectedGroup === group

  const setAsDefault = () => {
    const items = meta.value || []
    const modelName =
      defaultModel ||
      DefaultActiveModelKeysByGroup[group]?.[0] ||
      items.find((item) => !isModelDeprecated(item)) ||
      items[0]
    if (!modelName) return
    const found = getApiModesFromConfig(config, true).find(
      (apiMode) => apiModeToModelName(apiMode) === modelName,
    )
    if (found) updateConfig({ apiMode: found })
    else updateConfig({ modelName, apiMode: null })
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-4 space-y-3 transition-colors',
        inUse ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm">{t(meta.desc)}</span>
        <span
          className="text-[10px] font-medium rounded-full px-2 py-0.5 border border-border text-muted-foreground"
          title={t('Engine capability level')}
        >
          L{level} · {t(ENGINE_LEVEL_LABELS[level])}
        </span>
        {inUse && (
          <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-primary/10 text-primary inline-flex items-center gap-1">
            <CircleDot size={10} /> {t('Default engine')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {!inUse && meta.value?.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
              onClick={setAsDefault}
            >
              {t('Set as default')}
            </button>
          )}
          <label className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground">
            <ToggleSwitch
              checked={enabled}
              onChange={(value) =>
                updateConfig({
                  enabledProviders: { ...enabledProviders, [group]: value },
                })
              }
            />
            {enabled ? t('Enabled') : t('Disabled')}
          </label>
        </div>
      </div>
      {enabled && fields && (
        <div className="space-y-1 pt-1 border-t border-border/60">
          {fields.map((field) => (
            <EngineFields
              key={field}
              field={field}
              config={config}
              updateConfig={updateConfig}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

EngineCard.propTypes = {
  engine: PropTypes.shape({
    group: PropTypes.string.isRequired,
    level: PropTypes.number.isRequired,
    fields: PropTypes.arrayOf(PropTypes.string),
    defaultModel: PropTypes.string,
  }).isRequired,
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  selectedGroup: PropTypes.string,
}

/**
 * EnginesTab - the unified engine anatomy (roadmap C2).
 *
 * All engines, one dissection: name / capability badge / enable toggle /
 * credentials / diagnostics. Absorbs Provider Settings (GeneralTab) and the
 * Providers & Models matrix (AdvancedTab); module engine cards (dsh,
 * chatgptweb) render through the module seam.
 */
export function EnginesTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const moduleKit = useMemo(() => buildModuleKit(), [])
  const [manualModelId, setManualModelId] = useState('')

  const engineOptions = useMemo(() => buildEngineOptions(config, t), [config, t])

  const selectedModelName = config.apiMode ? apiModeToModelName(config.apiMode) : config.modelName

  const selectedGroup = useMemo(() => {
    if (config.apiMode?.groupName) return config.apiMode.groupName
    for (const [group, { value }] of Object.entries(ModelGroups)) {
      if (value?.includes(config.modelName)) return group
    }
    return null
  }, [config.apiMode, config.modelName])

  const usingOpenAiApi = isUsingOpenAiApiModel(config)
  const usingChatGptWeb = isUsingChatgptWebModel(config)

  const handleModelChange = (modelName) => {
    if (modelName === 'customModel') {
      updateConfig({ modelName: 'customModel', apiMode: null })
      return
    }
    const found = engineOptions.find((o) => o.value === modelName)
    if (found?.apiMode) updateConfig({ apiMode: found.apiMode })
    else updateConfig({ modelName, apiMode: null })
  }

  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Default Engine')}
        description={t('Answers everything unless a site overrides it')}
      >
        <SettingRow label={t('API Mode')} hint={t('Select provider / model')}>
          <SearchableSelect
            value={selectedModelName || 'customModel'}
            onChange={handleModelChange}
            options={engineOptions}
            placeholder={t('Select…')}
            searchPlaceholder={t('Search…')}
            minWidth="260px"
          />
        </SettingRow>

        {(usingChatGptWeb || usingOpenAiApi) && (
          <SettingRow label={t('Manual Model ID')} hint={t('Use when model list refresh fails')}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={manualModelId}
                onChange={(e) => setManualModelId(e.target.value)}
                placeholder={usingChatGptWeb ? 'gpt-5-6-thinking' : 'gpt-5'}
                className={cn(inputClassName, 'w-[260px]')}
              />
              <button
                type="button"
                onClick={() => {
                  const value = manualModelId.trim()
                  if (!value) return
                  const groupName = usingChatGptWeb ? 'chatgptWebModelKeys' : 'chatgptApiModelKeys'
                  updateConfig({ modelName: `${groupName}-${value}`, apiMode: null })
                  setManualModelId('')
                }}
                className="h-9 px-3 inline-flex items-center text-xs font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
              >
                {t('Use')}
              </button>
            </div>
          </SettingRow>
        )}
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Engines')}
        description={t(
          'Every engine in one anatomy: capability level, credentials, and diagnostics.',
        )}
      >
        <div className="space-y-3">
          {ENGINE_CARDS.map((engine) => (
            <EngineCard
              key={engine.group}
              engine={engine}
              config={config}
              updateConfig={updateConfig}
              selectedGroup={selectedGroup}
            />
          ))}
        </div>
      </SettingSection>

      {/* Module engine cards (dsh, chatgptweb) through the seam */}
      {getSettingsCards('engines').map(({ id, Component }) =>
        id === 'chatgptweb' ? (
          <Component key={id} config={config} updateConfig={updateConfig} kit={moduleKit} />
        ) : (
          <Component key={id} config={config} updateConfig={updateConfig} />
        ),
      )}

      <Divider />

      <SettingSection
        title={t('Model Directory')}
        description={t('Which modes appear in pickers, and under what display name.')}
      >
        <ToggleRow
          label={t('Show deprecated models')}
          checked={config.showDeprecatedModels === true}
          onChange={(value) => updateConfig({ showDeprecatedModels: value })}
        />
        <ApiModes config={config} updateConfig={updateConfig} />
      </SettingSection>
    </div>
  )
}

EnginesTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
