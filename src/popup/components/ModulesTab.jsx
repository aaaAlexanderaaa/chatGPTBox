import { useState } from 'preact/hooks'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn.mjs'

// Reuse the fully-featured legacy editors (feature-parity) while the redesigned panels mature
import { ApiModes } from '../sections/ApiModes.jsx'
import { SelectionTools } from '../sections/SelectionTools.jsx'
import { SiteAdapters } from '../sections/SiteAdapters.jsx'
import { ContentExtractor } from '../sections/ContentExtractor.jsx'

/**
 * ModulesTab - API modes, selection tools, sites, and extractor
 * Matches the demo design with sub-tabs, but uses legacy editors for full CRUD.
 */
export function ModulesTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const [activeSubTab, setActiveSubTab] = useState('api')

  const subTabs = [
    { id: 'api', label: t('API Modes') },
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
        {activeSubTab === 'api' && (
          <div className="tools-section">
            <h3 className="section-title">{t('API Modes')}</h3>
            <ApiModes config={config} updateConfig={updateConfig} />
          </div>
        )}
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
