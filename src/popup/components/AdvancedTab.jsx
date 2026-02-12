import PropTypes from 'prop-types'
import { Download, Upload, RotateCcw, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { SettingRow, SettingSection, ToggleRow, Divider } from './SettingComponents.jsx'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import { CHATGPT_WEB_DEBUG_LOG_KEY, ModelGroups } from '../../config/index.mjs'

/**
 * AdvancedTab - Advanced settings and data management
 * Matches the demo design
 */
export function AdvancedTab({ config, updateConfig, onExport, onImport, onReset }) {
  const { t } = useTranslation()
  const [webDebugLogs, setWebDebugLogs] = useState([])
  const [webDebugLoading, setWebDebugLoading] = useState(false)
  const [webDebugError, setWebDebugError] = useState('')
  const [selectedWebDebugIndex, setSelectedWebDebugIndex] = useState(-1)

  const loadWebDebugLogs = useCallback(async () => {
    setWebDebugLoading(true)
    setWebDebugError('')
    try {
      const data = await Browser.storage.local.get({ [CHATGPT_WEB_DEBUG_LOG_KEY]: [] })
      const logs = Array.isArray(data[CHATGPT_WEB_DEBUG_LOG_KEY])
        ? data[CHATGPT_WEB_DEBUG_LOG_KEY]
        : []
      setWebDebugLogs(logs)
    } catch (error) {
      setWebDebugError(error?.message || String(error))
    } finally {
      setWebDebugLoading(false)
    }
  }, [])

  const clearWebDebugLogs = useCallback(async () => {
    setWebDebugError('')
    try {
      await Browser.storage.local.set({ [CHATGPT_WEB_DEBUG_LOG_KEY]: [] })
      setWebDebugLogs([])
      setSelectedWebDebugIndex(-1)
    } catch (error) {
      setWebDebugError(error?.message || String(error))
    }
  }, [])

  useEffect(() => {
    void loadWebDebugLogs()
  }, [loadWebDebugLogs])

  useEffect(() => {
    if (config.debugChatgptWebRequests !== true) return
    const timer = setInterval(() => {
      void loadWebDebugLogs()
    }, 1500)
    return () => clearInterval(timer)
  }, [config.debugChatgptWebRequests, loadWebDebugLogs])

  useEffect(() => {
    if (webDebugLogs.length === 0) {
      if (selectedWebDebugIndex !== -1) setSelectedWebDebugIndex(-1)
      return
    }
    if (selectedWebDebugIndex < 0 || selectedWebDebugIndex >= webDebugLogs.length) {
      setSelectedWebDebugIndex(webDebugLogs.length - 1)
    }
  }, [webDebugLogs, selectedWebDebugIndex])

  const selectedWebDebugEntry = useMemo(() => {
    if (selectedWebDebugIndex < 0 || selectedWebDebugIndex >= webDebugLogs.length) return null
    return webDebugLogs[selectedWebDebugIndex]
  }, [webDebugLogs, selectedWebDebugIndex])

  const orderedWebDebugIndexes = useMemo(
    () => webDebugLogs.map((_, index) => index).sort((a, b) => b - a),
    [webDebugLogs],
  )

  const maxResponseTokenLengthValue = parseIntWithClamp(
    config.maxResponseTokenLength,
    2000,
    100,
    40000,
  )
  const maxConversationContextLengthValue = parseIntWithClamp(
    config.maxConversationContextLength,
    9,
    0,
    100,
  )
  const temperatureValue = parseFloatWithClamp(config.temperature, 1, 0, 2)
  const enabledProviders = config.enabledProviders || {}

  const providerEntries = Object.entries(ModelGroups)
  const providerOrder = [
    'chatgptWebModelKeys',
    'chatgptApiModelKeys',
    'customApiModelKeys',
    'azureOpenAiApiModelKeys',
    'claudeApiModelKeys',
    'claudeWebModelKeys',
    'moonshotApiModelKeys',
    'moonshotWebModelKeys',
    'openRouterApiModelKeys',
    'deepSeekApiModelKeys',
    'aimlModelKeys',
    'ollamaApiModelKeys',
    'chatglmApiModelKeys',
    'gptApiModelKeys',
    'githubThirdPartyApiModelKeys',
    'bingWebModelKeys',
    'bardWebModelKeys',
  ]
  providerEntries.sort(([a], [b]) => {
    const ia = providerOrder.indexOf(a)
    const ib = providerOrder.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const updateProvider = (groupName, enabled) => {
    updateConfig({
      enabledProviders: {
        ...enabledProviders,
        [groupName]: enabled,
      },
    })
  }

  return (
    <div className="space-y-4">
      {/* Model Parameters */}
      <SettingSection title={t('Model Parameters')}>
        <SettingRow label={t('Max Response Tokens')} hint={t('Maximum tokens in response')}>
          <input
            type="number"
            min={100}
            max={40000}
            step={100}
            value={maxResponseTokenLengthValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                maxResponseTokenLengthValue,
                100,
                40000,
              )
              updateConfig({ maxResponseTokenLength: value })
            }}
            className="w-24 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow label={t('Context Length')} hint={t('Conversation history')}>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={maxConversationContextLengthValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                maxConversationContextLengthValue,
                0,
                100,
              )
              updateConfig({ maxConversationContextLength: value })
            }}
            className="w-24 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow label={t('Temperature')} hint={t('Response randomness (0-2)')}>
          <input
            type="number"
            value={temperatureValue}
            step={0.1}
            min={0}
            max={2}
            onChange={(e) => {
              const value = parseFloatWithClamp(e.target.value, temperatureValue, 0, 2)
              updateConfig({ temperature: value })
            }}
            className="w-24 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('Providers & Models')}>
        <ToggleRow
          label={t('Show deprecated models')}
          checked={config.showDeprecatedModels === true}
          onChange={(value) => updateConfig({ showDeprecatedModels: value })}
        />
        <ToggleRow
          label={t('Debug ChatGPT Web Requests')}
          checked={config.debugChatgptWebRequests === true}
          onChange={(value) => updateConfig({ debugChatgptWebRequests: value })}
        />

        <div className="pt-2 space-y-2">
          {providerEntries.map(([groupName, { desc }]) => (
            <ToggleRow
              key={groupName}
              label={t(desc)}
              checked={enabledProviders[groupName] === true}
              onChange={(value) => updateProvider(groupName, value)}
            />
          ))}
        </div>
      </SettingSection>

      <Divider />

      <SettingSection title={t('ChatGPT Web Debug Viewer')}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadWebDebugLogs()}
            className="px-3 py-1.5 text-xs font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
          >
            {t('Refresh Logs')}
          </button>
          <button
            onClick={() => void clearWebDebugLogs()}
            className="px-3 py-1.5 text-xs font-medium text-destructive bg-destructive/10 rounded-lg hover:bg-destructive/20 transition-colors"
          >
            {t('Clear Logs')}
          </button>
          <span className="text-xs text-muted-foreground">
            {webDebugLoading ? t('Loading...') : `${webDebugLogs.length} ${t('entries')}`}
          </span>
        </div>

        {webDebugError && <div className="text-xs text-destructive">{webDebugError}</div>}

        <div className="space-y-2">
          <div className="max-h-40 overflow-auto border border-border rounded-lg bg-card">
            {orderedWebDebugIndexes.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {t('No debug logs yet')}
              </div>
            )}
            {orderedWebDebugIndexes.map((entryIndex) => {
              const entry = webDebugLogs[entryIndex]
              const selected = entryIndex === selectedWebDebugIndex
              const stage = entry?.stage || 'unknown'
              const at = typeof entry?.at === 'string' ? entry.at : ''
              return (
                <button
                  key={`${entryIndex}-${at}`}
                  type="button"
                  onClick={() => setSelectedWebDebugIndex(entryIndex)}
                  className={`w-full px-3 py-2 text-left text-xs border-b border-border/50 last:border-b-0 ${
                    selected
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50'
                  }`}
                >
                  <div className="font-medium">{stage}</div>
                  <div className="truncate">{at}</div>
                </button>
              )
            })}
          </div>

          <textarea
            readOnly
            rows={10}
            value={selectedWebDebugEntry ? JSON.stringify(selectedWebDebugEntry, null, 2) : ''}
            placeholder={t('Select a debug entry to inspect request/response details')}
            className="w-full px-3 py-2 text-xs font-mono bg-input border border-border rounded-lg focus:outline-none text-foreground"
          />
        </div>
      </SettingSection>

      <Divider />

      {/* Data Management */}
      <SettingSection title={t('Data')}>
        <div className="flex gap-3">
          <button
            onClick={onExport}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('Export Config')}
          </button>
          <button
            onClick={onImport}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t('Import Config')}
          </button>
        </div>

        <button
          onClick={onReset}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-destructive bg-destructive/10 rounded-lg hover:bg-destructive/20 transition-colors mt-3"
        >
          <RotateCcw className="w-4 h-4" />
          {t('Reset to Defaults')}
        </button>
      </SettingSection>

      {/* Warning */}
      <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {t('Resetting will clear all your settings and conversation history.')}
          </p>
        </div>
      </div>
    </div>
  )
}

AdvancedTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  onExport: PropTypes.func,
  onImport: PropTypes.func,
  onReset: PropTypes.func,
}
