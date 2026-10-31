import { installNativeDraftEntry } from './draft-entry.mjs'

// Keep settings fresh across BFCache without retaining a stale draft or request.
export function installNativeDraftLifecycle({ doc, browser, getConfig, t, onRewrite }) {
  const win = doc.defaultView
  let disposeEntry = () => {},
    epoch = 0,
    active = true,
    stopped = false
  const refresh = async () => {
    const revision = ++epoch
    const config = await getConfig()
    if (stopped || !active || revision !== epoch) return
    disposeEntry()
    disposeEntry = installNativeDraftEntry({
      doc,
      enabled: config.chatgptNativeRewriteEnabled,
      t,
      onRewrite: async (context) => {
        const latest = await getConfig()
        if (!stopped && active && revision === epoch && latest.chatgptNativeRewriteEnabled)
          await onRewrite(context, latest)
      },
    })
  }
  const changed = (changes, area) => {
    if (
      active &&
      area === 'local' &&
      (changes.chatgptNativeRewriteEnabled || changes.preferredLanguage)
    )
      void refresh().catch(() => {})
  }
  const dispose = () => {
    stopped = true
    active = false
    ++epoch
    disposeEntry()
    browser.storage.onChanged.removeListener(changed)
    win.removeEventListener('pagehide', hide)
    win.removeEventListener('pageshow', restore)
  }
  const hide = (event) => {
    active = false
    ++epoch
    disposeEntry()
    if (!event.persisted) dispose()
  }
  const restore = (event) => {
    if (event.persisted && !stopped) {
      active = true
      void refresh().catch(() => {})
    }
  }
  browser.storage.onChanged.addListener(changed)
  win.addEventListener('pagehide', hide)
  win.addEventListener('pageshow', restore)
  void refresh().catch(() => {})
  return dispose
}
