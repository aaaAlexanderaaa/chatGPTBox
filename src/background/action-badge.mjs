// Single owner of the browser-action badge. DSH waiting counts are
// life-critical (contract: the user must see pending approvals); the ChatGPT
// Web 429 lock is important but must not hide a waiting count.

export const DSH_WAITING_BADGE_COLOR = '#d97706'
export const RATE_LIMIT_BADGE_COLOR = '#b91c1c'

export function resolveActionBadge({ dshWaiting = 0, rateLimited = false } = {}) {
  const waiting = Number(dshWaiting) || 0
  if (waiting > 0) return { text: String(waiting), color: DSH_WAITING_BADGE_COLOR }
  if (rateLimited) return { text: '429', color: RATE_LIMIT_BADGE_COLOR }
  return { text: '', color: null }
}

let dshWaiting = 0
let rateLimited = false

export function setDshWaitingCount(count) {
  dshWaiting = Math.max(0, Number(count) || 0)
  return resolveActionBadge({ dshWaiting, rateLimited })
}

export function setRateLimitedFlag(flag) {
  rateLimited = flag === true
  return resolveActionBadge({ dshWaiting, rateLimited })
}

const CLEARED_BADGE_COLOR = '#000000'

export function applyActionBadge(action, badge) {
  if (!action?.setBadgeText) return
  void Promise.resolve(action.setBadgeText({ text: badge?.text || '' })).catch(() => {})
  if (!action.setBadgeBackgroundColor) return
  const color = badge?.color || CLEARED_BADGE_COLOR
  void Promise.resolve(action.setBadgeBackgroundColor({ color })).catch(() => {})
}
