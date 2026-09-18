import { useEffect, useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import {
  Settings,
  Palette,
  Cpu,
  Sliders,
  Wrench,
  Globe,
  ServerCog,
  Bot,
  Sparkles,
} from 'lucide-react'
import { defaultConfig, setUserConfig } from '../config/storage.mjs'
import { useSettingsConfig, useApplyAppearance } from '../hooks/use-settings-config.mjs'
import { downloadJsonFile, pickJsonFile } from '../popup/file-transfer.mjs'
import { cn } from '../utils/cn.mjs'

import { GeneralTab } from '../popup/components/GeneralTab.jsx'
import { AppearanceTab } from '../popup/components/AppearanceTab.jsx'
import { EnginesTab } from '../popup/components/EnginesTab.jsx'
import { ChatgptWebTab } from '../popup/components/ChatgptWebTab.jsx'
import { GrokWebTab } from '../popup/components/GrokWebTab.jsx'
import { DshEngineTab } from '../popup/components/DshEngineTab.jsx'
import { BehaviorTab } from '../popup/components/BehaviorTab.jsx'
import { ToolsTab } from '../popup/components/ToolsTab.jsx'
import { FeaturesTab } from '../popup/components/FeaturesTab.jsx'
import { AdvancedTab } from '../popup/components/AdvancedTab.jsx'

const BASE_SECTIONS = [
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

const ENGINE_SECTIONS = [
  {
    id: 'chatgptweb',
    label: 'ChatGPT Web',
    icon: Sparkles,
    description: 'ChatGPT Web account, models, history, and diagnostics',
    enabled: (config) => config.chatgptWebEnabled !== false,
    enableHint: 'Enable ChatGPT Web on the Engines tab first.',
  },
  {
    id: 'grokweb',
    label: 'Grok Web',
    icon: Bot,
    description: 'Grok Web account, models, and upcoming sync controls',
    enabled: (config) => config.grokWebEnabled === true,
    enableHint: 'Enable Grok Web on the Engines tab first.',
  },
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    icon: Bot,
    description: 'Local agent endpoint, diagnostics, and the full client',
    enabled: (config) => config.dshModuleEnabled === true,
    enableHint: 'Enable DeepSeek Harness on the Engines tab first.',
  },
]

const SECTION_ALIASES = { features: 'sites' }

function sectionsForConfig(config) {
  const engineTabs = ENGINE_SECTIONS.filter((section) => section.enabled(config))
  const enginesIndex = BASE_SECTIONS.findIndex((section) => section.id === 'engines')
  return [
    ...BASE_SECTIONS.slice(0, enginesIndex + 1),
    ...engineTabs,
    ...BASE_SECTIONS.slice(enginesIndex + 1),
  ]
}

function SettingsCenter() {
  const { t } = useTranslation()
  const [config, updateConfig] = useSettingsConfig()
  useApplyAppearance(config)

  const [enablePrompt, setEnablePrompt] = useState('')
  const requestedTab = new URLSearchParams(window.location.search).get('tab')

  const sections = useMemo(() => sectionsForConfig(config), [config])

  const [activeSection, setActiveSection] = useState(() => {
    const aliased = SECTION_ALIASES[requestedTab] || requestedTab
    return aliased || 'general'
  })

  useEffect(() => {
    const aliased = SECTION_ALIASES[requestedTab] || requestedTab
    if (!aliased) return
    const engineMeta = ENGINE_SECTIONS.find((section) => section.id === aliased)
    if (engineMeta && !engineMeta.enabled(config)) {
      setActiveSection('engines')
      setEnablePrompt(t(engineMeta.enableHint))
      return
    }
    if (sections.some((section) => section.id === aliased)) {
      setActiveSection(aliased)
    }
  }, [config.chatgptWebEnabled, config.grokWebEnabled, config.dshModuleEnabled])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeSection)
    if (activeSection !== 'advanced') url.hash = ''
    window.history.replaceState(null, '', url)
  }, [activeSection])

  useEffect(() => {
    if (activeSection !== 'advanced') return
    if (window.location.hash !== '#api-server-bridge') return
    const el = document.getElementById('api-server-bridge')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  const openEngineTab = (id) => {
    const engineMeta = ENGINE_SECTIONS.find((section) => section.id === id)
    if (engineMeta && !engineMeta.enabled(config)) {
      setActiveSection('engines')
      setEnablePrompt(t(engineMeta.enableHint))
      return
    }
    setEnablePrompt('')
    setActiveSection(id)
  }

  const active = sections.find((section) => section.id === activeSection) || sections[0]

  return (
    <div className="settings-center" data-settings-center>
      <nav className="settings-nav" aria-label={t('Settings sections')}>
        <div className="settings-nav-items">
          {sections.map((section) => {
            const Icon = section.icon
            const isActive = section.id === active.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  setEnablePrompt('')
                  setActiveSection(section.id)
                }}
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
          {active.id === 'engines' && (
            <EnginesTab
              config={config}
              updateConfig={updateConfig}
              onOpenEngineTab={openEngineTab}
              enablePrompt={enablePrompt}
            />
          )}
          {active.id === 'chatgptweb' && (
            <ChatgptWebTab config={config} updateConfig={updateConfig} />
          )}
          {active.id === 'grokweb' && <GrokWebTab config={config} updateConfig={updateConfig} />}
          {active.id === 'dsh' && <DshEngineTab config={config} updateConfig={updateConfig} />}
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
