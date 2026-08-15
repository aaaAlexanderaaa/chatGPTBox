import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { Download, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ModuleMessage } from '../../api.mjs'

// ChatGPT Web settings card (roadmap C1, D-3: frozen migration).
//
// This file is the JSX of the four ChatGPT Web groups that used to live in
// the Advanced tab, moved verbatim under one roof. The module boundary
// forbids importing extension core code, so every core piece the moved code
// needs arrives through the `kit` prop assembled by the render site
// (AdvancedTab): UI primitives, numeric clamps, limit constants, storage
// keys, and the history transfer handlers. Destructured to the original
// names so the moved markup stays byte-for-byte what it was.

const TEXT_INPUT_CLASS =
  'w-56 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-foreground'

export function ChatgptWebSettingsCard({ config, updateConfig, isPopupMode, kit }) {
  const { t } = useTranslation()
  const {
    SettingRow,
    SettingSection,
    ToggleRow,
    ToggleSwitch,
    Divider,
    parseIntWithClamp,
    limits,
    storageKeys,
    exportHistory,
    importHistory,
  } = kit

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
    const data = await Browser.storage.local.get({ [storageKeys.conversationMeta]: {} })
    setHistorySyncMeta(data[storageKeys.conversationMeta] || {})
  }, [storageKeys.conversationMeta])

  useEffect(() => {
    void loadHistorySyncMeta()
    const listener = (changes) => {
      if (changes?.[storageKeys.conversationMeta]) {
        setHistorySyncMeta(changes[storageKeys.conversationMeta].newValue || {})
      }
    }
    const storageChanges = Browser.storage.onChanged || Browser.storage.local.onChanged
    storageChanges.addListener(listener)
    return () => storageChanges.removeListener(listener)
  }, [loadHistorySyncMeta, storageKeys.conversationMeta])

  const runHistorySync = useCallback(
    async (resume = false) => {
      const rpm = Number(config.chatgptWebHistorySyncRpm) || limits.DEFAULT_HISTORY_SYNC_RPM
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
          type: ModuleMessage.ChatgptWebSyncConversations,
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
    [config, historySyncMeta, loadHistorySyncMeta, limits.DEFAULT_HISTORY_SYNC_RPM, t],
  )

  const stopHistorySync = useCallback(async () => {
    setHistorySyncError('')
    try {
      await Browser.runtime.sendMessage({ type: ModuleMessage.ChatgptWebStopConversationSync })
    } catch (error) {
      setHistorySyncError(error?.message || String(error))
    }
  }, [])

  const unlockHistorySync = useCallback(async () => {
    setHistorySyncError('')
    try {
      await Browser.runtime.sendMessage({ type: ModuleMessage.ChatgptWebUnlockConversationSync })
      void loadHistorySyncMeta()
    } catch (error) {
      setHistorySyncError(error?.message || String(error))
    }
  }, [loadHistorySyncMeta])

  const loadWebDebugLogs = useCallback(async () => {
    setWebDebugLoading(true)
    setWebDebugError('')
    try {
      const data = await Browser.storage.local.get({ [storageKeys.debugLog]: [] })
      const logs = Array.isArray(data[storageKeys.debugLog]) ? data[storageKeys.debugLog] : []
      setWebDebugLogs(logs)
    } catch (error) {
      setWebDebugError(error?.message || String(error))
    } finally {
      setWebDebugLoading(false)
    }
  }, [storageKeys.debugLog])

  const clearWebDebugLogs = useCallback(async () => {
    setWebDebugError('')
    try {
      await Browser.storage.local.set({ [storageKeys.debugLog]: [] })
      setWebDebugLogs([])
      setSelectedWebDebugIndex(-1)
    } catch (error) {
      setWebDebugError(error?.message || String(error))
    }
  }, [storageKeys.debugLog])

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

  const chatgptWebConversationPollTimeoutValue = parseIntWithClamp(
    config.chatgptWebConversationPollTimeoutSeconds,
    limits.DEFAULT_CONVERSATION_POLL_TIMEOUT_SECONDS,
    limits.MIN_CONVERSATION_POLL_TIMEOUT_SECONDS,
    limits.MAX_CONVERSATION_POLL_TIMEOUT_SECONDS,
  )
  const chatgptWebConversationPollIntervalValue = parseIntWithClamp(
    config.chatgptWebConversationPollIntervalSeconds,
    limits.DEFAULT_CONVERSATION_POLL_INTERVAL_SECONDS,
    limits.MIN_CONVERSATION_POLL_INTERVAL_SECONDS,
    limits.MAX_CONVERSATION_POLL_INTERVAL_SECONDS,
  )
  const chatgptWebHistorySyncRpmValue = parseIntWithClamp(
    config.chatgptWebHistorySyncRpm,
    limits.DEFAULT_HISTORY_SYNC_RPM,
    limits.MIN_HISTORY_SYNC_RPM,
    limits.MAX_HISTORY_SYNC_RPM,
  )
  const chatgptWebHistorySyncIntervalHoursValue = parseIntWithClamp(
    config.chatgptWebHistorySyncIntervalHours,
    limits.DEFAULT_HISTORY_SYNC_INTERVAL_HOURS,
    limits.MIN_HISTORY_SYNC_INTERVAL_HOURS,
    limits.MAX_HISTORY_SYNC_INTERVAL_HOURS,
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

  const handleExportChatgptHistory = useCallback(async () => {
    if (!exportHistory) return
    setHistoryTransferBusy(true)
    setHistoryTransferMessage('')
    setHistoryTransferError('')
    try {
      const summary = await exportHistory()
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
  }, [exportHistory, t])

  const handleImportChatgptHistory = useCallback(async () => {
    if (!importHistory) return
    setHistoryTransferBusy(true)
    setHistoryTransferMessage('')
    setHistoryTransferError('')
    try {
      const result = await importHistory()
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
  }, [importHistory, t])

  return (
    <div className="space-y-4">
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
            min={limits.MIN_CONVERSATION_POLL_INTERVAL_SECONDS}
            max={limits.MAX_CONVERSATION_POLL_INTERVAL_SECONDS}
            step={1}
            value={chatgptWebConversationPollIntervalValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                chatgptWebConversationPollIntervalValue,
                limits.MIN_CONVERSATION_POLL_INTERVAL_SECONDS,
                limits.MAX_CONVERSATION_POLL_INTERVAL_SECONDS,
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
            min={limits.MIN_CONVERSATION_POLL_TIMEOUT_SECONDS}
            max={limits.MAX_CONVERSATION_POLL_TIMEOUT_SECONDS}
            step={15}
            value={chatgptWebConversationPollTimeoutValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                chatgptWebConversationPollTimeoutValue,
                limits.MIN_CONVERSATION_POLL_TIMEOUT_SECONDS,
                limits.MAX_CONVERSATION_POLL_TIMEOUT_SECONDS,
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
                  min={limits.MIN_HISTORY_SYNC_INTERVAL_HOURS}
                  max={limits.MAX_HISTORY_SYNC_INTERVAL_HOURS}
                  step={1}
                  value={chatgptWebHistorySyncIntervalHoursValue}
                  onChange={(event) => {
                    const value = parseIntWithClamp(
                      event.target.value,
                      chatgptWebHistorySyncIntervalHoursValue,
                      limits.MIN_HISTORY_SYNC_INTERVAL_HOURS,
                      limits.MAX_HISTORY_SYNC_INTERVAL_HOURS,
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
                min={limits.MIN_HISTORY_SYNC_RPM}
                max={limits.MAX_HISTORY_SYNC_RPM}
                step={1}
                value={chatgptWebHistorySyncRpmValue}
                onChange={(event) => {
                  const value = parseIntWithClamp(
                    event.target.value,
                    chatgptWebHistorySyncRpmValue,
                    limits.MIN_HISTORY_SYNC_RPM,
                    limits.MAX_HISTORY_SYNC_RPM,
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

      {!isPopupMode && (
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
      )}

      {!isPopupMode && (
        <SettingSection title={t('ChatGPT Web Debug Viewer')}>
          <ToggleRow
            label={t('Debug ChatGPT Web Requests')}
            checked={config.debugChatgptWebRequests === true}
            onChange={(value) => updateConfig({ debugChatgptWebRequests: value })}
          />
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
      )}

      {!isPopupMode && (
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
      )}
    </div>
  )
}
