/**
 * OS-notification policy for the waiting inbox. Badge count is always the
 * global pending total; the notification is a single slot (one id), so
 * answering session B must not wipe session A's still-pending ask.
 */
export function waitingNotificationAction({
  sessionPending = 0,
  totalPending = 0,
  attached = false,
} = {}) {
  if (totalPending <= 0) return 'clear'
  if (sessionPending > 0 && attached) return 'none'
  if (sessionPending > 0) return 'notify'
  return 'notify-other'
}
