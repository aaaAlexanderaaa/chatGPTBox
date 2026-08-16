/**
 * Runtime-port reconnect with an explicit stop gate. Unmount must cancel the
 * retry so disconnect() does not spawn a zombie port (and keep the MV3 worker
 * alive). Module-off still retries: stop() disconnects, the next connect is
 * held, and re-enable drains it. A live held port does not loop.
 */
export function createPortReconnect({
  connect,
  shouldRetry = () => true,
  delayMs = 1000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let cancelled = false
  let timer = null

  function start() {
    cancelled = false
    connect?.()
  }

  function onDisconnect() {
    if (cancelled) return
    if (shouldRetry() === false) return
    if (timer != null) clearTimeoutFn(timer)
    timer = setTimeoutFn(() => {
      timer = null
      if (cancelled) return
      if (shouldRetry() === false) return
      connect?.()
    }, delayMs)
  }

  function stop() {
    cancelled = true
    if (timer != null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  return { start, onDisconnect, stop }
}
