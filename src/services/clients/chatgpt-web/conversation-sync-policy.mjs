export const CHATGPT_WEB_HISTORY_AUTO_SYNC_MODES = Object.freeze({
  Off: 'off',
  Adaptive: 'adaptive',
  Fixed: 'fixed',
})

export const CHATGPT_WEB_HISTORY_SYNC_ALARM = 'chatgpt-web-conversation-sync'

export function normalizeChatgptWebHistoryAutoSyncMode(value) {
  return Object.values(CHATGPT_WEB_HISTORY_AUTO_SYNC_MODES).includes(value)
    ? value
    : CHATGPT_WEB_HISTORY_AUTO_SYNC_MODES.Off
}

export function getChatgptWebHistoryRequestIntervalMs(rpm) {
  const normalizedRpm = Math.min(30, Math.max(1, parseInt(rpm, 10) || 6))
  return Math.ceil(60_000 / normalizedRpm)
}

export function getNextAdaptiveSyncIntervalHours(currentHours, changed) {
  if (changed) return 6
  const normalized = Math.min(24, Math.max(6, Number(currentHours) || 6))
  if (normalized < 12) return 12
  return 24
}

export function getChatgptWebHistoryAutoSyncIntervalHours(config = {}, meta = {}) {
  const mode = normalizeChatgptWebHistoryAutoSyncMode(config.chatgptWebHistoryAutoSyncMode)
  if (mode === CHATGPT_WEB_HISTORY_AUTO_SYNC_MODES.Adaptive) {
    return Math.min(24, Math.max(6, Number(meta?.adaptiveSyncIntervalHours) || 6))
  }
  if (mode === CHATGPT_WEB_HISTORY_AUTO_SYNC_MODES.Fixed) {
    return Math.min(168, Math.max(1, Number(config.chatgptWebHistorySyncIntervalHours) || 12))
  }
  return null
}

export function isChatgptWebHistoryAutoSyncAllowed(config = {}, meta = {}) {
  return (
    config.chatgptWebHistorySyncEnabled === true &&
    normalizeChatgptWebHistoryAutoSyncMode(config.chatgptWebHistoryAutoSyncMode) !==
      CHATGPT_WEB_HISTORY_AUTO_SYNC_MODES.Off &&
    meta?.safetyLock?.reason !== 'rate_limited'
  )
}

export function resolveChatgptWebHistorySyncAlarmAction({
  allowed,
  intervalHours,
  existingAlarm = null,
  replaceExisting = false,
} = {}) {
  if (!allowed || !intervalHours) return { action: 'clear' }
  if (existingAlarm && !replaceExisting) return { action: 'keep' }
  return { action: 'create', delayInMinutes: intervalHours * 60 }
}
