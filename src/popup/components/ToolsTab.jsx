import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSection, Divider } from './SettingComponents.jsx'
import { SelectionTools } from '../sections/SelectionTools.jsx'

const TEXT_INPUT_CLASS =
  'w-56 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-foreground'

/**
 * ToolsTab - the instructions concept (指令): portable prompts and how they
 * trigger. Selection tools (built-in + custom) and search-engine query
 * composition live here (roadmap C4, pure relocation from Modules/Advanced).
 */
export function ToolsTab({ config, updateConfig }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <SelectionTools config={config} updateConfig={updateConfig} />

      <Divider />

      <SettingSection title={t('Search Engine Queries')}>
        <SettingRow
          label={t('Input Query')}
          hint={t('Selector used to read the search box of a matched site')}
        >
          <input
            type="text"
            value={config.inputQuery || ''}
            onChange={(e) => updateConfig({ inputQuery: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </SettingRow>

        <SettingRow label={t('Prepend Query')}>
          <input
            type="text"
            value={config.prependQuery || ''}
            onChange={(e) => updateConfig({ prependQuery: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </SettingRow>

        <SettingRow label={t('Append Query')}>
          <input
            type="text"
            value={config.appendQuery || ''}
            onChange={(e) => updateConfig({ appendQuery: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </SettingRow>
      </SettingSection>
    </div>
  )
}

ToolsTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
