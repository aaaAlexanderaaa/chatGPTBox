import { useState } from 'preact/hooks'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn.mjs'

// Reuse the fully-featured legacy editors (feature-parity) while the redesigned panels mature
import { SelectionTools } from '../sections/SelectionTools.jsx'
import { SiteAdapters } from '../sections/SiteAdapters.jsx'
import { ContentExtractor } from '../sections/ContentExtractor.jsx'

/**
 * ModulesTab - selection tools, sites, and extractor
 * (the API-modes sub-tab moved to the Engines tab — roadmap C2)
 */
export function ModulesTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const [activeSubTab, setActiveSubTab] = useState('tools')

  const subTabs = [
    { id: 'tools', label: t('Selection Tools') },
    { id: 'sites', label: t('Sites') },
    { id: 'extractor', label: t('Extractor') },
  ]

  return (
    <div className="space-y-4">
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
        {activeSubTab === 'tools' && <SelectionTools config={config} updateConfig={updateConfig} />}
        {activeSubTab === 'sites' && (
          <div className="tools-section">
            <h3 className="section-title">{t('Sites')}</h3>
            <SiteAdapters config={config} updateConfig={updateConfig} />
          </div>
        )}
        {activeSubTab === 'extractor' && (
          <ContentExtractor config={config} updateConfig={updateConfig} />
        )}
      </div>
    </div>
  )
}

ModulesTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
