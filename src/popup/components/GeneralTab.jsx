import PropTypes from 'prop-types'
import { Sun, Moon, Monitor, Pencil, KeyRound } from 'lucide-react'
import { useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { changeLanguage } from 'i18next'
import { SettingRow, SettingSection, ToggleRow, Divider } from './SettingComponents.jsx'
import { SelectField } from './SelectField.jsx'
import { SearchableSelect } from './SearchableSelect.jsx'
import { QuickLinkCard } from './QuickLinkCard.jsx'
import { cn } from '../../utils/cn.mjs'
import { languageList } from '../../config/language.mjs'
import { config as menuConfig } from '../../content-script/menu-tools/index.mjs'
import { ThemeMode, TriggerMode } from '../../config/constants.mjs'
import { isUsingChatgptWebModel, isUsingOpenAiApiModel } from '../../config/predicates.mjs'
import { apiModeToModelName } from '../../utils/index.mjs'
import { buildEngineOptions, modelNameToSelectLabel } from './engine-options.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

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

/**
 * GeneralTab - General settings tab (redesigned)
 * Keeps functional parity with legacy GeneralPart while using the new styles.
 */
export function GeneralTab({
  config,
  updateConfig,
  isPopupMode,
  openFullSettings,
  onNavigateToEngines,
}) {
  const { t, i18n } = useTranslation()
  const [manualModelId, setManualModelId] = useState('')

  const engineOptions = useMemo(() => buildEngineOptions(config, t), [config, t])

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
    const found = engineOptions.find((o) => o.value === modelName)
    if (found?.apiMode) updateConfig({ apiMode: found.apiMode })
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
          type: RuntimeMessage.ChangeLang,
          data: { lang },
        })
        .catch(() => {})
    })
  }

  const usingOpenAiApi = isUsingOpenAiApiModel(config)
  const usingChatGptWeb = isUsingChatgptWebModel(config)
  const hasProviderSettings = usingOpenAiApi || usingChatGptWeb

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
            onNavigateToEngines && (
              <button
                onClick={onNavigateToEngines}
                className="text-muted-foreground hover:text-primary transition-colors"
                title={t('Configure engines')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )
          }
        >
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

      {isPopupMode && hasProviderSettings && (
        <>
          <Divider />

          <QuickLinkCard
            icon={KeyRound}
            title={t('Provider credentials live in Engines')}
            description={t(
              'API keys, custom endpoints, and engine toggles were unified into the Engines tab — one anatomy per engine.',
            )}
            stats={[
              selectedModelName ? modelNameToSelectLabel(selectedModelName, config, t) : null,
              usingChatGptWeb ? t('ChatGPT Web session') : t('API provider connection'),
            ]}
            actionLabel={t('Open Engines')}
            onAction={() => openFullSettings?.('engines')}
          />
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
        <ToggleRow
          label={t('Always Create New Conversation Window')}
          checked={config.alwaysCreateNewConversationWindow}
          onChange={(value) => updateConfig({ alwaysCreateNewConversationWindow: value })}
        />
        <ToggleRow
          label={t('Regenerate the answer after switching model')}
          checked={config.autoRegenAfterSwitchModel}
          onChange={(value) => updateConfig({ autoRegenAfterSwitchModel: value })}
        />
        <ToggleRow
          label={t("Crop Text to ensure the input tokens do not exceed the model's limit")}
          checked={config.cropText}
          onChange={(value) => updateConfig({ cropText: value })}
        />
      </SettingSection>
    </div>
  )
}

GeneralTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  isPopupMode: PropTypes.bool,
  openFullSettings: PropTypes.func,
  onNavigateToEngines: PropTypes.func,
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
