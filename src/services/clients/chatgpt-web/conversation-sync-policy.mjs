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

export function normalizeHistorySyncRpm(rpm) {
  return Math.min(30, Math.max(1, parseInt(rpm, 10) || 6))
}

export function getChatgptWebHistoryRequestIntervalMs(rpm) {
  return Math.ceil(60_000 / normalizeHistorySyncRpm(rpm))
}

const HISTORY_REQUEST_WINDOW_MS = 60_000
const HISTORY_REQUEST_MISSED_SLOT_GRACE_MS = 250

export function createHistoryRequestWindow(rpm, { now = Date.now(), random = Math.random } = {}) {
  const count = normalizeHistorySyncRpm(rpm)
  const offsets = Array.from({ length: count }, () =>
    Math.round(random() * HISTORY_REQUEST_WINDOW_MS),
  ).sort((left, right) => left - right)
  return {
    startedAt: new Date(now).toISOString(),
    offsets,
    index: 0,
  }
}

function normalizeHistoryRequestSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null
  const startedAt = Date.parse(schedule.startedAt || '')
  if (!Number.isFinite(startedAt)) return null
  const offsets = Array.isArray(schedule.offsets)
    ? schedule.offsets.filter((value) => Number.isFinite(Number(value)))
    : []
  if (offsets.length === 0) return null
  return {
    startedAt: new Date(startedAt).toISOString(),
    offsets,
    index: Math.max(0, parseInt(schedule.index, 10) || 0),
  }
}

export function planHistoryRequestSlot(
  schedule,
  rpm,
  { now = Date.now(), random = Math.random } = {},
) {
  const originOf = (state) => Date.parse(state.startedAt)
  let state = normalizeHistoryRequestSchedule(schedule)
  const origin = state ? originOf(state) : NaN
  const windowAlive = state && Number.isFinite(origin) && now - origin < HISTORY_REQUEST_WINDOW_MS

  if (!windowAlive) {
    state = createHistoryRequestWindow(rpm, { now, random })
  }

  let startedAtMs = originOf(state)
  while (
    state.index < state.offsets.length &&
    startedAtMs + state.offsets[state.index] < now - HISTORY_REQUEST_MISSED_SLOT_GRACE_MS
  ) {
    state = { ...state, index: state.index + 1 }
  }

  if (state.index >= state.offsets.length) {
    const nextWindowStart = Math.max(now, startedAtMs + HISTORY_REQUEST_WINDOW_MS)
    state = createHistoryRequestWindow(rpm, { now: nextWindowStart, random })
    startedAtMs = originOf(state)
  }

  const fireAt = Math.max(now, startedAtMs + state.offsets[state.index])
  return {
    fireAt,
    schedule: {
      ...state,
      index: state.index + 1,
    },
  }
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
