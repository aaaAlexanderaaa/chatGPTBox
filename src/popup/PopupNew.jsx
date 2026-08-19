import './styles.css'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { MessageSquare, Sliders, ArrowUpRight } from 'lucide-react'
import Browser from 'webextension-polyfill'
import { getPreferredLanguageKey } from '../config/storage.mjs'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn.mjs'
import { useSettingsConfig, useApplyAppearance } from '../hooks/use-settings-config.mjs'
import { SegmentedControl } from '../components/ui/SegmentedControl.jsx'
import { ChatPanel } from './ChatPanel.jsx'
import { QuickSettingsTab } from './components/QuickSettingsTab.jsx'

// The popup is the "quick" surface: conversation first, then the handful of
// controls people change daily. Depth lives in the options settings center,
// one tap away via deep links.

function openFullSettingsTab(tab) {
  const params = new URLSearchParams()
  if (tab) params.set('tab', tab)
  params.set('settings_only', 'true')
  const url = Browser.runtime.getURL(`options.html?${params.toString()}`)
  return Browser.tabs
    .query({ url: [Browser.runtime.getURL('options.html*')] })
    .then((existing) =>
      existing.length > 0
        ? Browser.tabs.update(existing[0].id, { url, active: true })
        : Browser.tabs.create({ url }),
    )
    .catch(() => Browser.runtime.openOptionsPage())
}

function Popup() {
  const search = new URLSearchParams(window.location.search)
  const isPopupMode = search.get('popup') === 'true'
  const { t, i18n } = useTranslation()
  const [config, updateConfig] = useSettingsConfig()
  useApplyAppearance(config)
  const [activeTab, setActiveTab] = useState('chat')

  useEffect(() => {
    getPreferredLanguageKey().then((lang) => {
      i18n.changeLanguage(lang)
    })
  }, [])

  // Standalone popup.html (no ?popup=true) was the old full-settings page;
  // that surface now lives in the options settings center.
  useEffect(() => {
    if (isPopupMode) return
    const params = new URLSearchParams(search)
    params.set('settings_only', 'true')
    window.location.replace(Browser.runtime.getURL(`options.html?${params.toString()}`))
  }, [])

  const tabs = useMemo(
    () => [
      { value: 'chat', label: t('Chat'), icon: MessageSquare },
      { value: 'settings', label: t('Settings'), icon: Sliders },
    ],
    [t],
  )

  if (!isPopupMode) return null

  return (
    <div className="bg-background text-foreground flex flex-col overflow-hidden popup-container">
      {/* Compact header: brand, tab switch, full-settings doorway */}
      <div className="px-3 py-2.5 border-b border-border bg-card/50 flex items-center gap-2">
        <img src="logo.png" alt="" className="w-6 h-6 rounded-md" />
        <SegmentedControl
          options={tabs}
          value={activeTab}
          onChange={setActiveTab}
          size="sm"
          className="flex-1"
          ariaLabel={t('Popup views')}
        />
        <button
          type="button"
          onClick={() => void openFullSettingsTab(activeTab === 'settings' ? 'general' : null)}
          title={t('Open full settings')}
          className={cn(
            'p-2 rounded-lg text-muted-foreground transition-colors',
            'hover:bg-secondary hover:text-foreground',
          )}
        >
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>

      {activeTab === 'chat' ? (
        <div className="flex-1 min-h-0">
          <ChatPanel />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          <QuickSettingsTab
            config={config}
            updateConfig={updateConfig}
            openFullSettings={(tab) => void openFullSettingsTab(tab)}
          />
        </div>
      )}
    </div>
  )
}

export default Popup
