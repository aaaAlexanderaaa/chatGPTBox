import { useEffect, useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { Settings, Palette, Cpu, Sliders, Wrench, Globe, ServerCog } from 'lucide-react'
import { defaultConfig, setUserConfig } from '../config/storage.mjs'
import { useSettingsConfig, useApplyAppearance } from '../hooks/use-settings-config.mjs'
import { downloadJsonFile, pickJsonFile } from '../popup/file-transfer.mjs'
import { cn } from '../utils/cn.mjs'

import { GeneralTab } from '../popup/components/GeneralTab.jsx'
import { AppearanceTab } from '../popup/components/AppearanceTab.jsx'
import { EnginesTab } from '../popup/components/EnginesTab.jsx'
import { BehaviorTab } from '../popup/components/BehaviorTab.jsx'
import { ToolsTab } from '../popup/components/ToolsTab.jsx'
import { FeaturesTab } from '../popup/components/FeaturesTab.jsx'
import { AdvancedTab } from '../popup/components/AdvancedTab.jsx'

// The settings center grows out of the product's feature domains: one
// section per thing the extension can do. Ids are stable because popup
// quick links and module cards deep-link with ?tab=<id>.
const SECTIONS = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    description: 'Language, triggers, and how you invoke the assistant',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    description: 'Theme, accent colors, and code highlighting',
  },
  {
    id: 'engines',
    label: 'Engines',
    icon: Cpu,
    description: 'Providers, credentials, and the default model',
  },
  {
    id: 'behavior',
    label: 'Behavior',
    icon: Sliders,
    description: 'Generation parameters and window behavior',
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: Wrench,
    description: 'Selection tools and prompt composition',
  },
  {
    id: 'sites',
    label: 'Sites',
    icon: Globe,
    description: 'Site adapters, per-site engines, and extractors',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: ServerCog,
    description: 'API Server Bridge, backups, and reset',
  },
]

// Legacy deep links (options.html?tab=features) keep working.
const SECTION_ALIASES = { features: 'sites' }

function resolveSectionId(requested) {
  if (!requested) return null
  const aliased = SECTION_ALIASES[requested] || requested
  return SECTIONS.some((section) => section.id === aliased) ? aliased : null
}

function SettingsCenter() {
  const { t } = useTranslation()
  const [config, updateConfig] = useSettingsConfig()
  useApplyAppearance(config)

  const [activeSection, setActiveSection] = useState(
    () => resolveSectionId(new URLSearchParams(window.location.search).get('tab')) || 'general',
  )

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeSection)
    window.history.replaceState(null, '', url)
  }, [activeSection])

  const version = useMemo(() => Browser.runtime.getManifest().version || '', [])

  const handleExport = () => {
    downloadJsonFile(config, 'chatgptbox-config.json')
  }

  const handleImport = () => {
    void pickJsonFile().then(async (file) => {
      if (!file) return
      const text = await file.text()
      try {
        const imported = JSON.parse(text)
        await setUserConfig(imported)
        window.location.reload()
      } catch (err) {
        console.error('Failed to import config:', err)
      }
    })
  }

  const handleReset = async () => {
    if (confirm(t('Are you sure you want to reset all settings?'))) {
      await setUserConfig(defaultConfig)
      window.location.reload()
    }
  }

  const active = SECTIONS.find((section) => section.id === activeSection) || SECTIONS[0]

  return (
    <div className="settings-center" data-settings-center>
      <nav className="settings-nav" aria-label={t('Settings sections')}>
        <div className="settings-nav-items">
          {SECTIONS.map((section) => {
            const Icon = section.icon
            const isActive = section.id === active.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                aria-current={isActive ? 'page' : undefined}
                title={t(section.description)}
                className={cn('settings-nav-item', isActive && 'settings-nav-item--active')}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="settings-nav-label">{t(section.label)}</span>
              </button>
            )
          })}
        </div>
        <div className="settings-nav-footer">
          <span className="text-xs text-muted-foreground">v{version}</span>
        </div>
      </nav>

      <div className="settings-content scrollbar-thin">
        <div className="settings-content-inner">
          <header className="settings-content-header">
            <h2 className="text-lg font-semibold text-foreground">{t(active.label)}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{t(active.description)}</p>
          </header>

          {active.id === 'general' && <GeneralTab config={config} updateConfig={updateConfig} />}
          {active.id === 'appearance' && (
            <AppearanceTab config={config} updateConfig={updateConfig} />
          )}
          {active.id === 'engines' && <EnginesTab config={config} updateConfig={updateConfig} />}
          {active.id === 'behavior' && <BehaviorTab config={config} updateConfig={updateConfig} />}
          {active.id === 'tools' && <ToolsTab config={config} updateConfig={updateConfig} />}
          {active.id === 'sites' && <FeaturesTab config={config} updateConfig={updateConfig} />}
          {active.id === 'advanced' && (
            <AdvancedTab
              config={config}
              updateConfig={updateConfig}
              onExport={handleExport}
              onImport={handleImport}
              onReset={handleReset}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsCenter
