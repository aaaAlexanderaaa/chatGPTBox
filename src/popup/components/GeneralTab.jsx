import PropTypes from 'prop-types'
import { Sun, Moon, Monitor, Pencil, ExternalLink } from 'lucide-react'
import { useMemo } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { changeLanguage } from 'i18next'
import { SettingRow, SettingSection, ToggleRow, Divider } from './SettingComponents.jsx'
import { SelectField } from './SelectField.jsx'
import { cn } from '../../utils/cn.mjs'
import { languageList } from '../../config/language.mjs'
import { config as menuConfig } from '../../content-script/menu-tools/index.mjs'
import {
  ModelMode,
  ThemeMode,
  TriggerMode,
  isUsingAimlApiModel,
  isUsingAzureOpenAiApiModel,
  isUsingChatGLMApiModel,
  isUsingClaudeApiModel,
  isUsingCustomModel,
  isUsingDeepSeekApiModel,
  isUsingGithubThirdPartyApiModel,
  isUsingMoonshotApiModel,
  isUsingMultiModeModel,
  isUsingOllamaApiModel,
  isUsingOpenAiApiModel,
  isUsingOpenRouterApiModel,
} from '../../config/index.mjs'
import { apiModeToModelName, getApiModesFromConfig, modelNameToDesc } from '../../utils/index.mjs'

const inputClassName =
  'h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-foreground placeholder:text-muted-foreground'

const CODE_THEME_OPTIONS = [
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
]

const ACCENT_OPTIONS = [
  { value: 'teal', label: 'Teal', swatch: '#2dd4bf' },
  { value: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { value: 'purple', label: 'Purple', swatch: '#a855f7' },
  { value: 'green', label: 'Green', swatch: '#22c55e' },
  { value: 'orange', label: 'Orange', swatch: '#f97316' },
  { value: 'rose', label: 'Rose', swatch: '#f43f5e' },
]

const ACCENT_STRENGTH_OPTIONS = [
  { value: 'soft', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'vivid', label: 'Deep' },
]

function getSelectedModelName(config) {
  if (config.apiMode) return apiModeToModelName(config.apiMode)
  return config.modelName
}

function modelNameToSelectLabel(modelName, config, t) {
  if (modelName === 'customModel') return modelNameToDesc(modelName, t, config.customModelName)
  if (modelName.startsWith('azureOpenAi-') && modelName.endsWith('-'))
    return modelNameToDesc('azureOpenAi', t)
  if (modelName.startsWith('ollama-') && modelName.endsWith('-'))
    return modelNameToDesc('ollama', t)
  return modelNameToDesc(modelName, t)
}

/**
 * GeneralTab - General settings tab (redesigned)
 * Keeps functional parity with legacy GeneralPart while using the new styles.
 */
export function GeneralTab({ config, updateConfig, onNavigateToModules }) {
  const { t, i18n } = useTranslation()

  const apiModes = useMemo(() => getApiModesFromConfig(config, true), [config])

  const apiModeOptions = useMemo(() => {
    const opts = apiModes
      .map((apiMode) => {
        const modelName = apiModeToModelName(apiMode)
        if (!modelName) return null
        return {
          value: modelName,
          label: modelNameToSelectLabel(modelName, config, t),
        }
      })
      .filter(Boolean)

    opts.push({
      value: 'customModel',
      label: modelNameToSelectLabel('customModel', config, t),
    })

    const current = getSelectedModelName(config)
    if (current && !opts.some((o) => o.value === current)) {
      opts.unshift({
        value: current,
        label: modelNameToSelectLabel(current, config, t),
      })
    }

    const deduped = []
    const seen = new Set()
    for (const opt of opts) {
      if (seen.has(opt.value)) continue
      seen.add(opt.value)
      deduped.push(opt)
    }
    return deduped
  }, [apiModes, config, t])

  const languageOptions = useMemo(() => {
    const opts = Object.entries(languageList).map(([value, v]) => ({
      value,
      label: v.native || v.name || value,
    }))
    opts.sort((a, b) => {
      if (a.value === 'auto') return -1
      if (b.value === 'auto') return 1
      return a.label.localeCompare(b.label)
    })
    return opts
  }, [])

  const clickActionOptions = useMemo(
    () => [
      { value: 'popup', label: t('Open Settings') },
      ...Object.entries(menuConfig).map(([value, v]) => ({ value, label: t(v.label) })),
    ],
    [t],
  )

  const selectedModelName = getSelectedModelName(config)

  const handleModelChange = (modelName) => {
    if (modelName === 'customModel') {
      updateConfig({ modelName: 'customModel', apiMode: null })
      return
    }
    const found = apiModes.find((m) => apiModeToModelName(m) === modelName)
    if (found) updateConfig({ apiMode: found })
    else updateConfig({ modelName, apiMode: null })
  }

  const handlePreferredLanguageChange = async (preferredLanguageKey) => {
    await updateConfig({ preferredLanguage: preferredLanguageKey })

    const lang = preferredLanguageKey === 'auto' ? config.userLanguage : preferredLanguageKey
    i18n.changeLanguage(lang)
    changeLanguage(lang)

    const tabs = await Browser.tabs.query({})
    tabs.forEach((tab) => {
      Browser.tabs
        .sendMessage(tab.id, {
          type: 'CHANGE_LANG',
          data: { lang },
        })
        .catch(() => {})
    })
  }

  const usingMultiMode = isUsingMultiModeModel(config)
  const usingOpenAiApi = isUsingOpenAiApiModel(config)
  const usingAzureOpenAi = isUsingAzureOpenAiApiModel(config)
  const usingOpenRouter = isUsingOpenRouterApiModel(config)
  const usingAiml = isUsingAimlApiModel(config)
  const usingClaudeApi = isUsingClaudeApiModel(config)
  const usingMoonshotApi = isUsingMoonshotApiModel(config)
  const usingDeepSeekApi = isUsingDeepSeekApiModel(config)
  const usingChatGLMApi = isUsingChatGLMApiModel(config)
  const usingOllamaApi = isUsingOllamaApiModel(config)
  const usingGithubThirdParty = isUsingGithubThirdPartyApiModel(config)
  const usingCustomApi = isUsingCustomModel(config)

  return (
    <div className="space-y-4">
      <SettingSection title={t('Basics')}>
        <SettingRow label={t('Trigger Mode')} hint={t('When to show AI response')}>
          <SelectField
            value={config.triggerMode}
            onChange={(value) => updateConfig({ triggerMode: value })}
            options={Object.entries(TriggerMode).map(([value, desc]) => ({
              value,
              label: t(desc),
            }))}
          />
        </SettingRow>

        <SettingRow label={t('Theme')} hint={t('Appearance mode')}>
          <ThemeSwitcher
            value={config.themeMode}
            onChange={(value) => updateConfig({ themeMode: value })}
          />
        </SettingRow>

        <SettingRow label={t('Preferred Language')} hint={t('Used for prompts and UI')}>
          <SelectField
            value={config.preferredLanguage || 'auto'}
            onChange={handlePreferredLanguageChange}
            options={languageOptions}
            minWidth="220px"
          />
        </SettingRow>

        <SettingRow label={t('When Icon Clicked')} hint={t('Default action')}>
          <SelectField
            value={config.clickIconAction || 'popup'}
            onChange={(value) => updateConfig({ clickIconAction: value })}
            options={clickActionOptions}
            minWidth="220px"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('Appearance')}>
        <SettingRow label={t('Accent (Light)')} hint={t('Bubble / highlight color in light theme')}>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateConfig({ accentColorLight: opt.value })}
                  className={cn(
                    'w-6 h-6 rounded-full transition-all',
                    (config.accentColorLight || 'teal') === opt.value
                      ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/50'
                      : 'ring-1 ring-transparent hover:ring-border',
                  )}
                  style={{ backgroundColor: opt.swatch }}
                  title={opt.label}
                  aria-label={opt.label}
                />
              ))}
            </div>
            <SelectField
              value={config.accentStrengthLight || 'normal'}
              onChange={(value) => updateConfig({ accentStrengthLight: value })}
              options={ACCENT_STRENGTH_OPTIONS}
              minWidth="120px"
            />
          </div>
        </SettingRow>

        <SettingRow label={t('Accent (Dark)')} hint={t('Bubble / highlight color in dark theme')}>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {ACCENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateConfig({ accentColorDark: opt.value })}
                  className={cn(
                    'w-6 h-6 rounded-full transition-all',
                    (config.accentColorDark || 'teal') === opt.value
                      ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/50'
                      : 'ring-1 ring-transparent hover:ring-border',
                  )}
                  style={{ backgroundColor: opt.swatch }}
                  title={opt.label}
                  aria-label={opt.label}
                />
              ))}
            </div>
            <SelectField
              value={config.accentStrengthDark || 'normal'}
              onChange={(value) => updateConfig({ accentStrengthDark: value })}
              options={ACCENT_STRENGTH_OPTIONS}
              minWidth="120px"
            />
          </div>
        </SettingRow>

        <SettingRow label={t('Code Theme (Light)')} hint={t('Syntax highlighting for code blocks')}>
          <SelectField
            value={config.codeThemeLight || 'github-light'}
            onChange={(value) => updateConfig({ codeThemeLight: value })}
            options={CODE_THEME_OPTIONS}
            minWidth="220px"
          />
        </SettingRow>

        <SettingRow label={t('Code Theme (Dark)')} hint={t('Syntax highlighting for code blocks')}>
          <SelectField
            value={config.codeThemeDark || 'github-dark'}
            onChange={(value) => updateConfig({ codeThemeDark: value })}
            options={CODE_THEME_OPTIONS}
            minWidth="220px"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('Model')}>
        <SettingRow
          label={t('API Mode')}
          hint={t('Select provider / model')}
          action={
            onNavigateToModules && (
              <button
                onClick={onNavigateToModules}
                className="text-muted-foreground hover:text-primary transition-colors"
                title={t('Configure API modes')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )
          }
        >
          <SelectField
            value={selectedModelName || 'customModel'}
            onChange={handleModelChange}
            options={apiModeOptions}
            minWidth="260px"
          />
        </SettingRow>

        {usingMultiMode && (
          <SettingRow label={t('Model Mode')} hint={t('Speed vs quality')}>
            <SelectField
              value={config.modelMode}
              onChange={(value) => updateConfig({ modelMode: value })}
              options={Object.entries(ModelMode).map(([value, desc]) => ({
                value,
                label: t(desc),
              }))}
            />
          </SettingRow>
        )}
      </SettingSection>

      {(usingOpenAiApi ||
        usingAzureOpenAi ||
        usingOpenRouter ||
        usingAiml ||
        usingClaudeApi ||
        usingMoonshotApi ||
        usingDeepSeekApi ||
        usingChatGLMApi ||
        usingOllamaApi ||
        usingGithubThirdParty ||
        usingCustomApi) && (
        <>
          <Divider />

          <SettingSection title={t('Provider Settings')}>
            {usingOpenAiApi && (
              <>
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

                <SettingRow label={t('OpenAI Base URL')} hint={t('For proxies / custom domains')}>
                  <input
                    type="text"
                    value={config.customOpenAiApiUrl || ''}
                    onChange={(e) => updateConfig({ customOpenAiApiUrl: e.target.value })}
                    placeholder="https://api.openai.com"
                    className={cn(inputClassName, 'w-[320px]')}
                  />
                </SettingRow>
              </>
            )}

            {usingAzureOpenAi && (
              <>
                <SettingRow
                  label={t('Azure Endpoint')}
                  hint={t('e.g. https://xxx.openai.azure.com')}
                >
                  <input
                    type="text"
                    value={config.azureEndpoint || ''}
                    onChange={(e) => updateConfig({ azureEndpoint: e.target.value })}
                    placeholder="https://..."
                    className={cn(inputClassName, 'w-[320px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Azure Deployment Name')} hint={t('Used to build model ID')}>
                  <input
                    type="text"
                    value={config.azureDeploymentName || ''}
                    onChange={(e) => updateConfig({ azureDeploymentName: e.target.value })}
                    placeholder={t('Deployment name')}
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Azure API Key')} hint={t('Credential for Azure OpenAI')}>
                  <input
                    type="password"
                    value={config.azureApiKey || ''}
                    onChange={(e) => updateConfig({ azureApiKey: e.target.value })}
                    placeholder={t('API Key')}
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
              </>
            )}

            {usingOpenRouter && (
              <SettingRow label={t('OpenRouter API Key')} hint={t('Used for OpenRouter models')}>
                <input
                  type="password"
                  value={config.openRouterApiKey || ''}
                  onChange={(e) => updateConfig({ openRouterApiKey: e.target.value })}
                  placeholder={t('API Key')}
                  className={cn(inputClassName, 'w-[260px]')}
                />
              </SettingRow>
            )}

            {usingAiml && (
              <SettingRow label={t('AIML API Key')} hint={t('Used for AIML models')}>
                <input
                  type="password"
                  value={config.aimlApiKey || ''}
                  onChange={(e) => updateConfig({ aimlApiKey: e.target.value })}
                  placeholder={t('API Key')}
                  className={cn(inputClassName, 'w-[260px]')}
                />
              </SettingRow>
            )}

            {usingClaudeApi && (
              <>
                <SettingRow label={t('Claude API Key')} hint={t('Used for Anthropic API models')}>
                  <input
                    type="password"
                    value={config.claudeApiKey || ''}
                    onChange={(e) => updateConfig({ claudeApiKey: e.target.value })}
                    placeholder={t('API Key')}
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Claude Base URL')} hint={t('For proxies / custom domains')}>
                  <input
                    type="text"
                    value={config.customClaudeApiUrl || ''}
                    onChange={(e) => updateConfig({ customClaudeApiUrl: e.target.value })}
                    placeholder="https://api.anthropic.com"
                    className={cn(inputClassName, 'w-[320px]')}
                  />
                </SettingRow>
              </>
            )}

            {usingMoonshotApi && (
              <SettingRow label={t('Moonshot API Key')} hint={t('Used for Moonshot API models')}>
                <input
                  type="password"
                  value={config.moonshotApiKey || ''}
                  onChange={(e) => updateConfig({ moonshotApiKey: e.target.value })}
                  placeholder={t('API Key')}
                  className={cn(inputClassName, 'w-[260px]')}
                />
              </SettingRow>
            )}

            {usingDeepSeekApi && (
              <SettingRow label={t('DeepSeek API Key')} hint={t('Used for DeepSeek API models')}>
                <input
                  type="password"
                  value={config.deepSeekApiKey || ''}
                  onChange={(e) => updateConfig({ deepSeekApiKey: e.target.value })}
                  placeholder={t('API Key')}
                  className={cn(inputClassName, 'w-[260px]')}
                />
              </SettingRow>
            )}

            {usingChatGLMApi && (
              <SettingRow label={t('ChatGLM API Key')} hint={t('Used for ChatGLM API models')}>
                <input
                  type="password"
                  value={config.chatglmApiKey || ''}
                  onChange={(e) => updateConfig({ chatglmApiKey: e.target.value })}
                  placeholder={t('API Key')}
                  className={cn(inputClassName, 'w-[260px]')}
                />
              </SettingRow>
            )}

            {usingOllamaApi && (
              <>
                <SettingRow label={t('Ollama Endpoint')} hint={t('Local Ollama server')}>
                  <input
                    type="text"
                    value={config.ollamaEndpoint || ''}
                    onChange={(e) => updateConfig({ ollamaEndpoint: e.target.value })}
                    placeholder="http://127.0.0.1:11434"
                    className={cn(inputClassName, 'w-[320px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Ollama Model Name')} hint={t('e.g. llama3.1')}>
                  <input
                    type="text"
                    value={config.ollamaModelName || ''}
                    onChange={(e) => updateConfig({ ollamaModelName: e.target.value })}
                    placeholder="llama3.1"
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Ollama API Key')} hint={t('Optional (for proxies)')}>
                  <input
                    type="password"
                    value={config.ollamaApiKey || ''}
                    onChange={(e) => updateConfig({ ollamaApiKey: e.target.value })}
                    placeholder={t('API Key')}
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Keep Alive')} hint={t('e.g. 5m / 0')}>
                  <input
                    type="text"
                    value={config.ollamaKeepAliveTime || ''}
                    onChange={(e) => updateConfig({ ollamaKeepAliveTime: e.target.value })}
                    placeholder="5m"
                    className={cn(inputClassName, 'w-[140px]')}
                  />
                </SettingRow>
              </>
            )}

            {usingCustomApi && (
              <>
                <SettingRow
                  label={t('Custom API URL')}
                  hint={t('OpenAI-compatible chat/completions')}
                >
                  <input
                    type="text"
                    value={config.customModelApiUrl || ''}
                    onChange={(e) => updateConfig({ customModelApiUrl: e.target.value })}
                    placeholder="http://localhost:8000/v1/chat/completions"
                    className={cn(inputClassName, 'w-[360px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Custom API Key')} hint={t('Optional')}>
                  <input
                    type="password"
                    value={config.customApiKey || ''}
                    onChange={(e) => updateConfig({ customApiKey: e.target.value })}
                    placeholder={t('API Key')}
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
                <SettingRow label={t('Custom Model Name')} hint={t('Sent as model field')}>
                  <input
                    type="text"
                    value={config.customModelName || ''}
                    onChange={(e) => updateConfig({ customModelName: e.target.value })}
                    placeholder="gpt-4.1"
                    className={cn(inputClassName, 'w-[260px]')}
                  />
                </SettingRow>
              </>
            )}

            {usingGithubThirdParty && (
              <SettingRow label={t('API Url')} hint={t('GitHub third-party server')}>
                <input
                  type="text"
                  value={config.githubThirdPartyUrl || ''}
                  onChange={(e) => updateConfig({ githubThirdPartyUrl: e.target.value })}
                  placeholder="http://127.0.0.1:3000/conversation"
                  className={cn(inputClassName, 'w-[360px]')}
                />
              </SettingRow>
            )}
          </SettingSection>
        </>
      )}

      <Divider />

      <SettingSection title={t('Options')}>
        <ToggleRow
          label={t('Insert ChatGPT at the top of search results')}
          checked={config.insertAtTop}
          onChange={(value) => updateConfig({ insertAtTop: value })}
        />
        <ToggleRow
          label={t('Always display floating window, disable sidebar for all site adapters')}
          checked={config.alwaysFloatingSidebar}
          onChange={(value) => updateConfig({ alwaysFloatingSidebar: value })}
        />
        <ToggleRow
          label={t('Lock scrollbar while answering')}
          checked={config.lockWhenAnswer}
          onChange={(value) => updateConfig({ lockWhenAnswer: value })}
        />
        <ToggleRow
          label={t('Focus input after answer')}
          checked={config.focusAfterAnswer}
          onChange={(value) => updateConfig({ focusAfterAnswer: value })}
        />
        <ToggleRow
          label={t('Allow ESC to close windows')}
          checked={config.allowEscToCloseAll}
          onChange={(value) => updateConfig({ allowEscToCloseAll: value })}
        />
        <ToggleRow
          label={t('Always pin floating window')}
          checked={config.alwaysPinWindow}
          onChange={(value) => updateConfig({ alwaysPinWindow: value })}
        />
        <ToggleRow
          label={t('Selection tools next to input box')}
          checked={config.selectionToolsNextToInputBox}
          onChange={(value) => updateConfig({ selectionToolsNextToInputBox: value })}
        />
      </SettingSection>
    </div>
  )
}

GeneralTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  onNavigateToModules: PropTypes.func,
}

/**
 * ThemeSwitcher - Theme mode toggle buttons
 */
function ThemeSwitcher({ value, onChange }) {
  const { t } = useTranslation()

  const options = [
    { value: 'light', icon: Sun, label: t(ThemeMode.light) },
    { value: 'auto', icon: Monitor, label: t(ThemeMode.auto) },
    { value: 'dark', icon: Moon, label: t(ThemeMode.dark) },
  ]

  return (
    <div className="flex gap-1 p-1 bg-secondary rounded-lg">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              value === option.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

ThemeSwitcher.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
}
