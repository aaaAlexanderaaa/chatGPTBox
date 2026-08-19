import PropTypes from 'prop-types'
import { useMemo } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSection, ToggleRow, Divider } from './SettingComponents.jsx'
import { SelectField } from './SelectField.jsx'
import { applyPreferredLanguage, buildLanguageOptions } from './preferred-language.mjs'
import { config as menuConfig } from '../../content-script/menu-tools/index.mjs'
import { TriggerMode } from '../../config/constants.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import Browser from 'webextension-polyfill'

/**
 * GeneralTab - the basics of invoking the assistant: when it appears, which
 * language it answers in, what the toolbar icon does, and whether the
 * context menu shows up. Appearance lives in its own section, conversation
 * knobs in Behavior, and the default engine in Engines.
 */
export function GeneralTab({ config, updateConfig }) {
  const { t, i18n } = useTranslation()

  const languageOptions = useMemo(() => buildLanguageOptions(), [])

  const clickActionOptions = useMemo(
    () => [
      { value: 'popup', label: t('Open Settings') },
      ...Object.entries(menuConfig).map(([value, v]) => ({ value, label: t(v.label) })),
    ],
    [t],
  )

  const handlePreferredLanguageChange = (preferredLanguageKey) =>
    applyPreferredLanguage(preferredLanguageKey, { config, updateConfig, i18n })

  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Basics')}
        description={t('How you reach the assistant and how it answers')}
      >
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

      <SettingSection title={t('Context Menu')}>
        <ToggleRow
          label={t('Hide context menu of this extension')}
          hint={t('Removes the ChatGPTBox entries from the browser right-click menu')}
          checked={config.hideContextMenu === true}
          onChange={async (value) => {
            await updateConfig({ hideContextMenu: value })
            Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu }).catch(() => {})
          }}
        />
      </SettingSection>
    </div>
  )
}

GeneralTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
