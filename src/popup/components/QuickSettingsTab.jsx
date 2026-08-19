import PropTypes from 'prop-types'
import { useMemo } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { Cpu, Globe, Wrench, Sliders, Palette, ChevronRight } from 'lucide-react'
import { SettingRow, SettingSection, Divider } from './SettingComponents.jsx'
import { SelectField } from './SelectField.jsx'
import { SearchableSelect } from './SearchableSelect.jsx'
import { ThemeSwitcher } from '../../components/ThemeSwitcher.jsx'
import { applyPreferredLanguage, buildLanguageOptions } from './preferred-language.mjs'
import { buildEngineOptions } from './engine-options.mjs'
import { apiModeToModelName } from '../../utils/index.mjs'
import { TriggerMode } from '../../config/constants.mjs'

/**
 * QuickSettingsTab - the popup's settings view. Only the controls people
 * reach for daily (engine, theme, trigger, language), plus a map of the
 * feature domains that deep-link into the full settings center. The popup
 * stays lean; depth lives in options.html.
 */
export function QuickSettingsTab({ config, updateConfig, openFullSettings }) {
  const { t, i18n } = useTranslation()

  const engineOptions = useMemo(() => buildEngineOptions(config, t), [config, t])
  const languageOptions = useMemo(() => buildLanguageOptions(), [])

  const selectedModelName = config.apiMode ? apiModeToModelName(config.apiMode) : config.modelName

  const handleModelChange = (modelName) => {
    if (modelName === 'customModel') {
      updateConfig({ modelName: 'customModel', apiMode: null })
      return
    }
    const found = engineOptions.find((o) => o.value === modelName)
    if (found?.apiMode) updateConfig({ apiMode: found.apiMode })
    else updateConfig({ modelName, apiMode: null })
  }

  const sections = [
    { id: 'engines', icon: Cpu, label: t('Engines'), hint: t('Providers, keys, models') },
    { id: 'behavior', icon: Sliders, label: t('Behavior'), hint: t('Generation, windows') },
    { id: 'tools', icon: Wrench, label: t('Tools'), hint: t('Selection tools') },
    { id: 'sites', icon: Globe, label: t('Sites'), hint: t('Adapters, extractors') },
    { id: 'appearance', icon: Palette, label: t('Appearance'), hint: t('Theme, accents') },
  ]

  return (
    <div className="space-y-4">
      <SettingSection title={t('Engine')}>
        <SettingRow label={t('API Mode')} hint={t('Select provider / model')}>
          <SearchableSelect
            value={selectedModelName || 'customModel'}
            onChange={handleModelChange}
            options={engineOptions}
            placeholder={t('Select…')}
            searchPlaceholder={t('Search…')}
            minWidth="220px"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('Preferences')}>
        <SettingRow label={t('Theme')} hint={t('Appearance mode')}>
          <ThemeSwitcher
            value={config.themeMode}
            onChange={(value) => updateConfig({ themeMode: value })}
            showLabels={false}
            size="sm"
          />
        </SettingRow>

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

        <SettingRow label={t('Preferred Language')} hint={t('Used for prompts and UI')}>
          <SelectField
            value={config.preferredLanguage || 'auto'}
            onChange={(key) => applyPreferredLanguage(key, { config, updateConfig, i18n })}
            options={languageOptions}
            minWidth="200px"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('All Settings')}>
        <div className="rounded-xl border border-border bg-card/60 divide-y divide-border/60 overflow-hidden">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => openFullSettings?.(section.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors"
              >
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{section.label}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {section.hint}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            )
          })}
        </div>
      </SettingSection>
    </div>
  )
}

QuickSettingsTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  openFullSettings: PropTypes.func,
}
