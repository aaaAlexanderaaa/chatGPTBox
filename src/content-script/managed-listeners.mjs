// Tracks DOM listeners and timers created by the content script so the
// page can tear them all down on full unload (or on manual teardown).
// Note: `pagehide` does not fire on SPA navigations (pushState/replaceState),
// so listeners survive client-side route changes — which matches how the
// content script expects to keep working as the user moves around an SPA.
// On bfcache entry (`event.persisted === true`) teardown is skipped so the
// page keeps functioning when restored via back/forward.
//
// Wrap a timer/listener with the managed variants ONLY if it may outlive
// its handler — long-running polls (`setInterval`), document-level
// `addEventListener`. One-shot `setTimeout` calls inside an event handler
// that fires once per user action don't need wrapping.

const registry = {
  listeners: new Set(),
  intervals: new Set(),
}

export function addManagedListener(target, event, handler, options) {
  target.addEventListener(event, handler, options)
  registry.listeners.add({ target, event, handler, options })
}

export function setManagedInterval(fn, ms) {
  const id = setInterval(fn, ms)
  registry.intervals.add(id)
  return id
}

export function clearManagedInterval(id) {
  clearInterval(id)
  registry.intervals.delete(id)
}

export function teardownChatGptBoxListeners() {
  for (const { target, event, handler, options } of registry.listeners) {
    try {
      target.removeEventListener(event, handler, options)
    } catch {
      /* ignore */
    }
  }
  registry.listeners.clear()
  for (const id of registry.intervals) clearInterval(id)
  registry.intervals.clear()
}

let installed = false
export function installPageLifecycleTeardown() {
  if (installed) return
  installed = true
  window.addEventListener('pagehide', (event) => {
    // bfcache entry: page may return via pageshow — don't tear down.
    if (event.persisted) return
    teardownChatGptBoxListeners()
  })
}
