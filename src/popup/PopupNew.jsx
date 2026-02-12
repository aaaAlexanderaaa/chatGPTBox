import './styles.css'
import { useEffect, useState } from 'preact/hooks'
import { Settings, Layers, Puzzle, Sliders, ExternalLink, Bot } from 'lucide-react'
import Browser from 'webextension-polyfill'
import {
  defaultConfig,
  getPreferredLanguageKey,
  getUserConfig,
  setUserConfig,
} from '../config/index.mjs'
import { useWindowTheme } from '../hooks/use-window-theme.mjs'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn.mjs'
import { applyDocumentAppearance } from '../utils/appearance.mjs'

// Tab components
import { GeneralTab } from './components/GeneralTab.jsx'
import { FeaturesTab } from './components/FeaturesTab.jsx'
import { ModulesTab } from './components/ModulesTab.jsx'
import { AgentsTab } from './components/AgentsTab.jsx'
import { AdvancedTab } from './components/AdvancedTab.jsx'

// Tab configuration
const TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'features', label: 'Features', icon: Layers },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'modules', label: 'Modules', icon: Puzzle },
  { id: 'advanced', label: 'Advanced', icon: Sliders },
]

function Popup() {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState(defaultConfig)
  const [activeTab, setActiveTab] = useState('general')
  const [version, setVersion] = useState('')
  const theme = useWindowTheme()
  const resolvedTheme = config.themeMode === 'auto' ? theme : config.themeMode

  // Use functional setState to avoid closure issues
  const updateConfig = async (value) => {
    setConfig((prev) => ({ ...prev, ...value }))
    await setUserConfig(value)
  }

  useEffect(() => {
    getPreferredLanguageKey().then((lang) => {
      i18n.changeLanguage(lang)
    })
    getUserConfig().then((loadedConfig) => {
      setConfig(loadedConfig)
    })
    // Get version from manifest
    const manifest = Browser.runtime.getManifest()
    setVersion(manifest.version || '')
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    applyDocumentAppearance(document.documentElement, config, resolvedTheme)
  }, [
    resolvedTheme,
    config.accentColorLight,
    config.accentStrengthLight,
    config.accentColorDark,
    config.accentStrengthDark,
  ])

  const search = new URLSearchParams(window.location.search)
  // Popup mode is explicitly opt-in via query param so `popup.html` can also be opened as a full page.
  const isPopupMode = search.get('popup') === 'true'

  // Export config
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'chatgptbox-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import config
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (file) {
        const text = await file.text()
        try {
          const imported = JSON.parse(text)
          await setUserConfig(imported)
          setConfig((prev) => ({ ...prev, ...imported }))
        } catch (err) {
          console.error('Failed to import config:', err)
        }
      }
    }
    input.click()
  }

  // Reset config
  const handleReset = async () => {
    if (confirm(t('Are you sure you want to reset all settings?'))) {
      await setUserConfig(defaultConfig)
      setConfig(defaultConfig)
    }
  }

  return (
    <div
      className={cn(
        'bg-background text-foreground flex flex-col overflow-hidden',
        isPopupMode ? 'popup-container' : 'page-container',
      )}
      data-theme={resolvedTheme}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-card/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">ChatGPTBox Settings</h1>
            <p className="text-xs text-muted-foreground">{t('Configure your AI assistant')}</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-all',
                  activeTab === tab.id
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{t(tab.label)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
        {activeTab === 'general' && (
          <GeneralTab
            config={config}
            updateConfig={updateConfig}
            onNavigateToModules={() => setActiveTab('modules')}
            onNavigateToAgents={() => setActiveTab('agents')}
          />
        )}
        {activeTab === 'features' && <FeaturesTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'agents' && <AgentsTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'modules' && <ModulesTab config={config} updateConfig={updateConfig} />}
        {activeTab === 'advanced' && (
          <AdvancedTab
            config={config}
            updateConfig={updateConfig}
            onExport={handleExport}
            onImport={handleImport}
            onReset={handleReset}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border bg-card/50 flex items-center justify-between">
        <a
          href="https://github.com/aaaAlexanderaaa/chatGPTBox"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          {t('Documentation')}
        </a>
        <span className="text-xs text-muted-foreground">v{version}</span>
      </div>
    </div>
  )
}

export default Popup
