import { useState } from 'preact/hooks'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn.mjs'
import { Assistants } from '../sections/Assistants.jsx'
import { SkillsCatalog } from '../sections/SkillsCatalog.jsx'
import { McpServers } from '../sections/McpServers.jsx'

export function AgentsTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const [activeSubTab, setActiveSubTab] = useState('assistants')
  const subTabs = [
    { id: 'assistants', label: t('Assistants') },
    { id: 'skills', label: t('Skills') },
    { id: 'mcp', label: t('MCP') },
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">{t('Agents')}</h3>
        <div className="text-xs text-muted-foreground">
          {t('Manage assistants, imported skills, and MCP servers')}
        </div>
      </div>
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={cn(
              'flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all',
              activeSubTab === tab.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="modules-legacy">
        {activeSubTab === 'assistants' && (
          <Assistants config={config} updateConfig={updateConfig} />
        )}
        {activeSubTab === 'skills' && <SkillsCatalog config={config} updateConfig={updateConfig} />}
        {activeSubTab === 'mcp' && <McpServers config={config} updateConfig={updateConfig} />}
      </div>
    </div>
  )
}

AgentsTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
