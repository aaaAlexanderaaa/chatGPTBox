import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSection, Divider } from './SettingComponents.jsx'
import { SelectField } from './SelectField.jsx'
import { ThemeSwitcher } from '../../components/ThemeSwitcher.jsx'
import { cn } from '../../utils/cn.mjs'

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

function AccentPicker({ value, strength, onPick, onStrength }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1">
        {ACCENT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            className={cn(
              'w-6 h-6 rounded-full transition-all',
              (value || 'teal') === opt.value
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
        value={strength || 'normal'}
        onChange={onStrength}
        options={ACCENT_STRENGTH_OPTIONS}
        minWidth="120px"
      />
    </div>
  )
}

AccentPicker.propTypes = {
  value: PropTypes.string,
  strength: PropTypes.string,
  onPick: PropTypes.func.isRequired,
  onStrength: PropTypes.func.isRequired,
}

/**
 * AppearanceTab - everything about how the product looks: theme mode,
 * accent color per theme, and code highlighting themes.
 */
export function AppearanceTab({ config, updateConfig }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <SettingSection title={t('Theme')} description={t('Appearance mode')}>
        <SettingRow label={t('Theme')} hint={t('Follow the system or lock a theme')}>
          <ThemeSwitcher
            value={config.themeMode}
            onChange={(value) => updateConfig({ themeMode: value })}
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Accent')}
        description={t('Bubble / highlight color, picked per theme')}
      >
        <SettingRow label={t('Accent (Light)')} hint={t('Used in light theme')}>
          <AccentPicker
            value={config.accentColorLight}
            strength={config.accentStrengthLight}
            onPick={(value) => updateConfig({ accentColorLight: value })}
            onStrength={(value) => updateConfig({ accentStrengthLight: value })}
          />
        </SettingRow>

        <SettingRow label={t('Accent (Dark)')} hint={t('Used in dark theme')}>
          <AccentPicker
            value={config.accentColorDark}
            strength={config.accentStrengthDark}
            onPick={(value) => updateConfig({ accentColorDark: value })}
            onStrength={(value) => updateConfig({ accentStrengthDark: value })}
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Code Theme')}
        description={t('Syntax highlighting for code blocks')}
      >
        <SettingRow label={t('Code Theme (Light)')} hint={t('Used in light theme')}>
          <SelectField
            value={config.codeThemeLight || 'github-light'}
            onChange={(value) => updateConfig({ codeThemeLight: value })}
            options={CODE_THEME_OPTIONS}
            minWidth="220px"
          />
        </SettingRow>

        <SettingRow label={t('Code Theme (Dark)')} hint={t('Used in dark theme')}>
          <SelectField
            value={config.codeThemeDark || 'github-dark'}
            onChange={(value) => updateConfig({ codeThemeDark: value })}
            options={CODE_THEME_OPTIONS}
            minWidth="220px"
          />
        </SettingRow>
      </SettingSection>
    </div>
  )
}

AppearanceTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
