import PropTypes from 'prop-types'
import { Download, Upload, RotateCcw, AlertTriangle, ExternalLink, Sliders } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import {
  SettingRow,
  SettingSection,
  ToggleRow,
  ToggleSwitch,
  Divider,
} from './SettingComponents.jsx'
import { QuickLinkCard } from './QuickLinkCard.jsx'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import {
  CHATGPT_WEB_DEBUG_LOG_KEY,
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
} from '../../config/limits.mjs'
import { ModelGroups } from '../../config/models.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import { CHATGPT_WEB_CONVERSATION_META_KEY } from '../../services/clients/chatgpt-web/conversation-cache.mjs'

const TEXT_INPUT_CLASS =
  'w-56 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-foreground'

/**
 * AdvancedTab - Advanced settings and data management
 * Matches the demo design
 */
export function AdvancedTab({
  config,
  updateConfig,
  isPopupMode,
  openFullSettings,
  onExport,
  onImport,
  onExportChatgptHistory,
  onImportChatgptHistory,
  onReset,
}) {
  const { t } = useTranslation()
  const [webDebugLogs, setWebDebugLogs] = useState([])
  const [webDebugLoading, setWebDebugLoading] = useState(false)
  const [webDebugError, setWebDebugError] = useState('')
  const [selectedWebDebugIndex, setSelectedWebDebugIndex] = useState(-1)
  const [historyTransferBusy, setHistoryTransferBusy] = useState(false)
  const [historyTransferMessage, setHistoryTransferMessage] = useState('')
  const [historyTransferError, setHistoryTransferError] = useState('')
  const [historySyncMeta, setHistorySyncMeta] = useState({})
  const [historySyncBusy, setHistorySyncBusy] = useState(false)
  const [historySyncError, setHistorySyncError] = useState('')

  const loadHistorySyncMeta = useCallback(async () => {
    const data = await Browser.storage.local.get({ [CHATGPT_WEB_CONVERSATION_META_KEY]: {} })
    setHistorySyncMeta(data[CHATGPT_WEB_CONVERSATION_META_KEY] || {})
  }, [])

  useEffect(() => {
    void loadHistorySyncMeta()
    const listener = (changes) => {
      if (changes?.[CHATGPT_WEB_CONVERSATION_META_KEY]) {
        setHistorySyncMeta(changes[CHATGPT_WEB_CONVERSATION_META_KEY].newValue || {})
      }
    }
    const storageChanges = Browser.storage.onChanged || Browser.storage.local.onChanged
    storageChanges.addListener(listener)
    return () => storageChanges.removeListener(listener)
  }, [loadHistorySyncMeta])

  const runHistorySync = useCallback(
    async (resume = false) => {
      const rpm = Number(config.chatgptWebHistorySyncRpm) || DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM
      const includeArchived = config.chatgptWebHistorySyncArchived === true
      const knownConversationCount =
        Number(historySyncMeta?.lastSyncItemCount) ||
        Number(historySyncMeta?.syncState?.expectedTotal) ||
        0
      const estimatedRequestCount = knownConversationCount
        ? Math.ceil(knownConversationCount / 100) + (includeArchived ? 1 : 0)
        : null
      const prompt = t(
        'This will synchronize the complete ChatGPT conversation list at up to {{rpm}} requests per minute, with 100 conversations per request. Estimated list requests: {{requests}}. Conversation contents will not be downloaded. Continue?',
        { rpm, requests: estimatedRequestCount || t('unknown') },
      )
      if (!window.confirm(prompt)) return
      setHistorySyncBusy(true)
      setHistorySyncError('')
      try {
        await Browser.runtime.sendMessage({
          type: RuntimeMessage.ChatgptWebSyncConversations,
          data: {
            mode: 'full',
            automatic: false,
            reason: resume ? 'manual_resume' : 'manual_full_sync',
            includeArchived,
            resume,
          },
        })
      } catch (error) {
        setHistorySyncError(error?.message || String(error))
      } finally {
        setHistorySyncBusy(false)
        void loadHistorySyncMeta()
      }
    },
    [config, historySyncMeta, loadHistorySyncMeta, t],
  )

  const stopHistorySync = useCallback(async () => {
    setHistorySyncError('')
    try {
      await Browser.runtime.sendMessage({ type: RuntimeMessage.ChatgptWebStopConversationSync })
    } catch (error) {
      setHistorySyncError(error?.message || String(error))
    }
  }, [])

  const unlockHistorySync = useCallback(async () => {
    setHistorySyncError('')
    try {
      await Browser.runtime.sendMessage({ type: RuntimeMessage.ChatgptWebUnlockConversationSync })
      void loadHistorySyncMeta()
    } catch (error) {
      setHistorySyncError(error?.message || String(error))
    }
  }, [loadHistorySyncMeta])

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

  const exportWebDebugLogs = useCallback(() => {
    try {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              entries: webDebugLogs,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json;charset=utf-8' },
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `chatgpt-web-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setWebDebugError(error?.message || String(error))
    }
  }, [webDebugLogs])

  useEffect(() => {
    if (isPopupMode) return
    void loadWebDebugLogs()
  }, [isPopupMode, loadWebDebugLogs])

  useEffect(() => {
    if (isPopupMode) return
    if (config.debugChatgptWebRequests !== true) return
    const timer = setInterval(() => {
      void loadWebDebugLogs()
    }, 1500)
    return () => clearInterval(timer)
  }, [config.debugChatgptWebRequests, isPopupMode, loadWebDebugLogs])

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
    DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
    100,
    MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  )
  const maxConversationContextLengthValue = parseIntWithClamp(
    config.maxConversationContextLength,
    9,
    0,
    MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  )
  const temperatureValue = parseFloatWithClamp(config.temperature, 1, 0, 2)
  const chatgptWebConversationPollTimeoutValue = parseIntWithClamp(
    config.chatgptWebConversationPollTimeoutSeconds,
    DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
    MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
    MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  )
  const chatgptWebConversationPollIntervalValue = parseIntWithClamp(
    config.chatgptWebConversationPollIntervalSeconds,
    DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
    MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
    MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  )
  const chatgptWebHistorySyncRpmValue = parseIntWithClamp(
    config.chatgptWebHistorySyncRpm,
    DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
    MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
    MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
  )
  const chatgptWebHistorySyncIntervalHoursValue = parseIntWithClamp(
    config.chatgptWebHistorySyncIntervalHours,
    DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
    MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
    MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  )
  const historyRequestStats = historySyncMeta?.requestStats || {}
  const historyRecentRequests = Array.isArray(historyRequestStats.recent)
    ? historyRequestStats.recent
    : []
  const historyRequestCutoffMinute = Date.now() - 60_000
  const historyRequestsLastMinute = historyRecentRequests.filter(
    (entry) => Date.parse(entry?.at || '') >= historyRequestCutoffMinute,
  ).length
  const historyRequestsLastDay = Object.values(historyRequestStats.hourly || {}).reduce(
    (total, count) => total + (Number(count) || 0),
    0,
  )
  const currentHistorySyncRequestCount = Math.max(
    0,
    (Number(historyRequestStats.total) || 0) -
      (Number(historySyncMeta?.syncState?.requestCountAtStart) || 0),
  )
  const apiServerRequestTimeoutValue = parseIntWithClamp(
    config.apiServerRequestTimeoutSeconds,
    DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
    MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
    MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  )
  const apiServerThinkingTimeoutValue = parseIntWithClamp(
    config.apiServerThinkingTimeoutSeconds,
    DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
    MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
    MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  )
  const enabledProviders = config.enabledProviders || {}
  const enabledProviderCount = Object.values(enabledProviders).filter(Boolean).length

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

  const handleExportChatgptHistory = useCallback(async () => {
    if (!onExportChatgptHistory) return
    setHistoryTransferBusy(true)
    setHistoryTransferMessage('')
    setHistoryTransferError('')
    try {
      const summary = await onExportChatgptHistory()
      if (summary) {
        setHistoryTransferMessage(
          t(
            'Exported ChatGPT history: {{conversationCount}} conversations, {{snapshotCount}} raw snapshots, {{sessionSnapshotCount}} session snapshots, {{apiThreadCount}} continuation threads',
            summary,
          ),
        )
      } else {
        setHistoryTransferMessage(t('ChatGPT history export completed'))
      }
    } catch (error) {
      setHistoryTransferError(error?.message || String(error))
    } finally {
      setHistoryTransferBusy(false)
    }
  }, [onExportChatgptHistory, t])

  const handleImportChatgptHistory = useCallback(async () => {
    if (!onImportChatgptHistory) return
    setHistoryTransferBusy(true)
    setHistoryTransferMessage('')
    setHistoryTransferError('')
    try {
      const result = await onImportChatgptHistory()
      if (!result) return
      setHistoryTransferMessage(
        t(
          'Imported ChatGPT history: wrote {{keysWritten}} storage keys; now holding {{conversationCount}} conversations, {{snapshotCount}} raw snapshots, {{sessionSnapshotCount}} session snapshots, and {{apiThreadCount}} continuation threads',
          {
            keysWritten: result.keysWritten,
            conversationCount: result.after?.conversationCount || 0,
            snapshotCount: result.after?.snapshotCount || 0,
            sessionSnapshotCount: result.after?.sessionSnapshotCount || 0,
            apiThreadCount: result.after?.apiThreadCount || 0,
          },
        ),
      )
    } catch (error) {
      setHistoryTransferError(error?.message || String(error))
    } finally {
      setHistoryTransferBusy(false)
    }
  }, [onImportChatgptHistory, t])

  return (
    <div className="space-y-4">
      {/* Model Parameters */}
      <SettingSection title={t('Model Parameters')}>
        <SettingRow
          label={t('Max Response Tokens')}
          hint={t('Maximum tokens in response (actual model/provider limits still apply)')}
        >
          <input
            type="number"
            min={100}
            max={MAX_RESPONSE_TOKEN_LENGTH_LIMIT}
            step={100}
            value={maxResponseTokenLengthValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                maxResponseTokenLengthValue,
                100,
                MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
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
            max={MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT}
            step={1}
            value={maxConversationContextLengthValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                maxConversationContextLengthValue,
                0,
                MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
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

        {!isPopupMode && (
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
        )}
      </SettingSection>

      <Divider />

      <SettingSection title={t('ChatGPT Web History')}>
        <SettingRow
          label={t('Keep ChatGPTBox chats in ChatGPT history')}
          hint={t(
            'When enabled, ChatGPTBox conversations stay visible in your official ChatGPT conversation list',
          )}
        >
          <button
            type="button"
            role="switch"
            aria-checked={config.disableWebModeHistory !== true}
            onClick={() =>
              updateConfig({ disableWebModeHistory: config.disableWebModeHistory !== true })
            }
            className={`relative w-10 h-6 rounded-full transition-colors ${
              config.disableWebModeHistory !== true ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                config.disableWebModeHistory !== true ? 'left-5' : 'left-1'
              }`}
            />
          </button>
        </SettingRow>

        <SettingRow
          label={t('ChatGPT Web poll interval (s)')}
          hint={t(
            'How often ChatGPTBox checks the official conversation state while waiting for high-effort thinking results',
          )}
        >
          <input
            type="number"
            min={MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS}
            max={MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS}
            step={1}
            value={chatgptWebConversationPollIntervalValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                chatgptWebConversationPollIntervalValue,
                MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
                MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
              )
              updateConfig({ chatgptWebConversationPollIntervalSeconds: value })
            }}
            className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow
          label={t('ChatGPT Web result timeout (s)')}
          hint={t(
            'How long ChatGPTBox waits for a final result when thinking sessions finish streaming before the official conversation state is ready',
          )}
        >
          <input
            type="number"
            min={MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS}
            max={MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS}
            step={15}
            value={chatgptWebConversationPollTimeoutValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                chatgptWebConversationPollTimeoutValue,
                MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
                MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
              )
              updateConfig({ chatgptWebConversationPollTimeoutSeconds: value })
            }}
            className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <Divider />

        <SettingRow
          label={t('Enable ChatGPT history synchronization')}
          hint={t('Disabled by default. Enabling it does not start a full synchronization.')}
        >
          <ToggleSwitch
            checked={config.chatgptWebHistorySyncEnabled === true}
            onChange={(value) => updateConfig({ chatgptWebHistorySyncEnabled: value })}
          />
        </SettingRow>

        {config.chatgptWebHistorySyncEnabled === true && (
          <>
            <SettingRow
              label={t('Automatic history synchronization')}
              hint={t('Automatic synchronization fetches only the newest 100 conversations.')}
            >
              <select
                value={config.chatgptWebHistoryAutoSyncMode || 'off'}
                onChange={(event) =>
                  updateConfig({ chatgptWebHistoryAutoSyncMode: event.target.value })
                }
                className={TEXT_INPUT_CLASS}
              >
                <option value="off">{t('Off')}</option>
                <option value="adaptive">{t('Adaptive (6–24 hours)')}</option>
                <option value="fixed">{t('Fixed interval')}</option>
              </select>
            </SettingRow>

            {config.chatgptWebHistoryAutoSyncMode === 'fixed' && (
              <SettingRow
                label={t('Automatic sync interval (hours)')}
                hint={t('Each automatic synchronization requests one page only.')}
              >
                <input
                  type="number"
                  min={MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS}
                  max={MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS}
                  step={1}
                  value={chatgptWebHistorySyncIntervalHoursValue}
                  onChange={(event) => {
                    const value = parseIntWithClamp(
                      event.target.value,
                      chatgptWebHistorySyncIntervalHoursValue,
                      MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
                      MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
                    )
                    updateConfig({ chatgptWebHistorySyncIntervalHours: value })
                  }}
                  className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
                />
              </SettingRow>
            )}

            <SettingRow
              label={t('Automatic and bulk history RPM')}
              hint={t('Limits background and bulk history requests, not normal chats.')}
            >
              <input
                type="number"
                min={MIN_CHATGPT_WEB_HISTORY_SYNC_RPM}
                max={MAX_CHATGPT_WEB_HISTORY_SYNC_RPM}
                step={1}
                value={chatgptWebHistorySyncRpmValue}
                onChange={(event) => {
                  const value = parseIntWithClamp(
                    event.target.value,
                    chatgptWebHistorySyncRpmValue,
                    MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
                    MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
                  )
                  updateConfig({ chatgptWebHistorySyncRpm: value })
                }}
                className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
              />
            </SettingRow>
            {chatgptWebHistorySyncRpmValue > 20 && (
              <div className="text-xs text-amber-700 dark:text-amber-300">
                {t('RPM values above 20 may increase the risk of account rate limiting.')}
              </div>
            )}

            <SettingRow
              label={t('Include archived conversations in full sync')}
              hint={t('Archived conversations are never fetched by automatic synchronization.')}
            >
              <ToggleSwitch
                checked={config.chatgptWebHistorySyncArchived === true}
                onChange={(value) => updateConfig({ chatgptWebHistorySyncArchived: value })}
              />
            </SettingRow>

            <SettingRow
              label={t('Synchronize only while idle')}
              hint={t('Defers automatic history requests while a ChatGPTBox chat is active.')}
            >
              <ToggleSwitch
                checked={config.chatgptWebHistorySyncOnlyWhenIdle !== false}
                onChange={(value) => updateConfig({ chatgptWebHistorySyncOnlyWhenIdle: value })}
              />
            </SettingRow>

            <div
              className={`rounded-lg border p-3 text-xs space-y-2 ${
                historySyncMeta?.safetyLock?.reason === 'rate_limited'
                  ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'border-border bg-secondary/30 text-muted-foreground'
              }`}
            >
              {historySyncMeta?.safetyLock?.reason === 'rate_limited' && (
                <div className="font-medium">
                  {t(
                    'Automatic history requests were stopped after HTTP 429. They will remain disabled until you unlock them manually.',
                  )}
                </div>
              )}
              <div>
                {t('Status')}: {t(historySyncMeta?.syncState?.status || 'idle')}
              </div>
              <div>
                {t('Progress')}: {historySyncMeta?.syncState?.itemsFetched || 0}{' '}
                {historySyncMeta?.syncState?.expectedTotal
                  ? `/ ${historySyncMeta.syncState.expectedTotal} `
                  : ''}
                {t('conversations')}, {historySyncMeta?.syncState?.pagesCompleted || 0} {t('pages')}
              </div>
              <div>
                {t('Requests')}: {historySyncMeta?.requestStats?.total || 0} {t('total')},{' '}
                {historySyncMeta?.requestStats?.list || 0} {t('list')},{' '}
                {historySyncMeta?.requestStats?.detail || 0} {t('detail')},{' '}
                {historySyncMeta?.requestStats?.rateLimited || 0} HTTP 429
              </div>
              <div>
                {t('Current sync')}: {currentHistorySyncRequestCount}; {t('last minute')}:{' '}
                {historyRequestsLastMinute} / {chatgptWebHistorySyncRpmValue}; {t('last 24 hours')}:{' '}
                {historyRequestsLastDay}
              </div>
              {historySyncMeta?.lastSyncError && <div>{historySyncMeta.lastSyncError}</div>}
              {historySyncError && <div>{historySyncError}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                {historySyncMeta?.safetyLock?.reason === 'rate_limited' ? (
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                    onClick={unlockHistorySync}
                  >
                    {t('Unlock after reviewing settings')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={historySyncBusy || historySyncMeta?.syncState?.status === 'running'}
                      className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                      onClick={() => runHistorySync(false)}
                    >
                      {t('Start full list sync')}
                    </button>
                    {['paused', 'failed', 'pause_requested'].includes(
                      historySyncMeta?.syncState?.status,
                    ) && (
                      <button
                        type="button"
                        disabled={historySyncBusy}
                        className="px-3 py-1.5 rounded-md border border-border disabled:opacity-50"
                        onClick={() => runHistorySync(true)}
                      >
                        {t('Resume')}
                      </button>
                    )}
                    {historySyncMeta?.syncState?.status === 'running' && (
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-md border border-border"
                        onClick={stopHistorySync}
                      >
                        {t('Stop')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </SettingSection>

      <Divider />

      <SettingSection title={t('API Server Bridge')}>
        <SettingRow
          label={t('Keep API Server chats in ChatGPT history')}
          hint={t(
            'When enabled, bridge requests create visible chats in your ChatGPT history instead of privacy-cleaned temporary conversations',
          )}
        >
          <button
            type="button"
            role="switch"
            aria-checked={config.apiServerKeepHistory === true}
            onClick={() =>
              updateConfig({ apiServerKeepHistory: config.apiServerKeepHistory !== true })
            }
            className={`relative w-10 h-6 rounded-full transition-colors ${
              config.apiServerKeepHistory === true ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                config.apiServerKeepHistory === true ? 'left-5' : 'left-1'
              }`}
            />
          </button>
        </SettingRow>

        <SettingRow
          label={t('API request timeout (s)')}
          hint={t('How long the local API Server waits before failing non-thinking requests')}
        >
          <input
            type="number"
            min={MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS}
            max={MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS}
            step={15}
            value={apiServerRequestTimeoutValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                apiServerRequestTimeoutValue,
                MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
                MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
              )
              updateConfig({ apiServerRequestTimeoutSeconds: value })
            }}
            className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow
          label={t('Thinking request timeout (s)')}
          hint={t(
            'How long the local API Server waits before failing high-effort thinking requests',
          )}
        >
          <input
            type="number"
            min={MIN_API_SERVER_THINKING_TIMEOUT_SECONDS}
            max={MAX_API_SERVER_THINKING_TIMEOUT_SECONDS}
            step={15}
            value={apiServerThinkingTimeoutValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                apiServerThinkingTimeoutValue,
                MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
                MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
              )
              updateConfig({ apiServerThinkingTimeoutSeconds: value })
            }}
            className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow
          label={t('Open API Server Bridge')}
          hint={`${t('Current port')}: ${Number(config.apiServerPort) || 18080}`}
        >
          <button
            type="button"
            onClick={() => {
              Browser.runtime.sendMessage({ type: RuntimeMessage.OpenApiServer }).catch(() => {})
            }}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('Open')}
          </button>
        </SettingRow>
      </SettingSection>

      {!isPopupMode && (
        <>
          <Divider />

          <SettingSection title={t('Site Matching & Menus')}>
            <SettingRow
              label={t('Hide context menu of this extension')}
              hint={t('Removes the ChatGPTBox entries from the browser right-click menu')}
            >
              <ToggleSwitch
                checked={config.hideContextMenu === true}
                onChange={async (value) => {
                  await updateConfig({ hideContextMenu: value })
                  Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu }).catch(() => {})
                }}
              />
            </SettingRow>

            <SettingRow
              label={t('Custom Site Regex')}
              hint={t('Match extra sites where the search-engine panel is injected')}
            >
              <input
                type="text"
                value={config.siteRegex || ''}
                onChange={(e) => updateConfig({ siteRegex: e.target.value })}
                className={TEXT_INPUT_CLASS}
              />
            </SettingRow>

            <ToggleRow
              label={t(
                'Exclusively use Custom Site Regex for website matching, ignoring built-in rules',
              )}
              checked={config.useSiteRegexOnly === true}
              onChange={(value) => updateConfig({ useSiteRegexOnly: value })}
            />
          </SettingSection>

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

          <Divider />

          <SettingSection title={t('ChatGPT Web Endpoint')}>
            <SettingRow
              label={t('Custom ChatGPT Web API Url')}
              hint={t('Leave empty to use the official endpoint')}
            >
              <input
                type="text"
                value={config.customChatGptWebApiUrl || ''}
                onChange={(e) => updateConfig({ customChatGptWebApiUrl: e.target.value })}
                className={TEXT_INPUT_CLASS}
              />
            </SettingRow>

            <SettingRow label={t('Custom ChatGPT Web API Path')}>
              <input
                type="text"
                value={config.customChatGptWebApiPath || ''}
                onChange={(e) => updateConfig({ customChatGptWebApiPath: e.target.value })}
                className={TEXT_INPUT_CLASS}
              />
            </SettingRow>
          </SettingSection>
        </>
      )}

      {isPopupMode ? (
        <>
          <Divider />

          <QuickLinkCard
            icon={Sliders}
            title={t('Diagnostics and backups moved to full settings')}
            description={t(
              'Provider toggles, ChatGPT Web request logs, config import/export, and reset actions are available in the full settings workspace.',
            )}
            stats={[
              `${enabledProviderCount} ${t('providers enabled')}`,
              config.debugChatgptWebRequests === true ? t('Web debug on') : t('Web debug off'),
            ]}
            actionLabel={t('Open full settings')}
            onAction={() => openFullSettings?.('advanced')}
          />
        </>
      ) : (
        <>
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
              <button
                onClick={() => exportWebDebugLogs()}
                className="px-3 py-1.5 text-xs font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
                disabled={webDebugLogs.length === 0}
              >
                {t('Export Logs')}
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

          <Divider />

          <SettingSection title={t('ChatGPT History Backup')}>
            <p className="text-xs text-muted-foreground">
              {t(
                'Exports and imports the plugin-local ChatGPT conversation cache and continuation state, including raw conversation JSON snapshots. Import merges by conversation ID, session ID, and continuation thread key; it does not delete existing history that is missing from the file or the currently logged-in account.',
              )}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => void handleExportChatgptHistory()}
                disabled={historyTransferBusy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                {historyTransferBusy ? t('Working...') : t('Export ChatGPT History')}
              </button>
              <button
                onClick={() => void handleImportChatgptHistory()}
                disabled={historyTransferBusy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4" />
                {historyTransferBusy ? t('Working...') : t('Import ChatGPT History')}
              </button>
            </div>

            {historyTransferMessage && (
              <div className="mt-3 text-xs text-muted-foreground">{historyTransferMessage}</div>
            )}
            {historyTransferError && (
              <div className="mt-2 text-xs text-destructive">{historyTransferError}</div>
            )}
          </SettingSection>

          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {t('Resetting will clear all your settings and conversation history.')}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

AdvancedTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  isPopupMode: PropTypes.bool,
  openFullSettings: PropTypes.func,
  onExport: PropTypes.func,
  onImport: PropTypes.func,
  onExportChatgptHistory: PropTypes.func,
  onImportChatgptHistory: PropTypes.func,
  onReset: PropTypes.func,
}
