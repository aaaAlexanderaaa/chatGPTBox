import Browser from 'webextension-polyfill'
import { NATIVE_CHATGPT_DEFAULTS } from '../config/native-chatgpt.mjs'
import { installNativePaste } from './paste-controller.mjs'

// This opt-in document-start entry stays independent of shared/provider bundles.
let controller = null,
  configEpoch = 0,
  active = false,
  confirmedOff = false
const read = async () => {
  const epoch = ++configEpoch,
    current = controller
  current?.suspend()
  try {
    const value = await Browser.storage.local.get({
      ...NATIVE_CHATGPT_DEFAULTS,
      preferredLanguage: 'auto',
    })
    if (active && epoch === configEpoch && current === controller) {
      confirmedOff = value.chatgptNativePasteEnabled === false
      current.configure(value)
    }
  } catch {
    /* Remain fail-closed in this opted-in document. */
  }
}
const changed = (changes, area) => {
  if (!active || area !== 'local') return
  if (
    'chatgptNativePasteEnabled' in changes &&
    changes.chatgptNativePasteEnabled.newValue !== true
  ) {
    ++configEpoch
    confirmedOff = true
    controller.configure({ ...NATIVE_CHATGPT_DEFAULTS, chatgptNativePasteEnabled: false })
  } else if (
    [...Object.keys(NATIVE_CHATGPT_DEFAULTS), 'preferredLanguage'].some((key) => key in changes)
  )
    void read()
}
const start = () => {
  if (active) return
  active = true
  controller = installNativePaste({ browser: Browser })
  if (confirmedOff)
    controller.configure({ ...NATIVE_CHATGPT_DEFAULTS, chatgptNativePasteEnabled: false })
  Browser.storage.onChanged.addListener(changed)
  void read()
}
const hide = (event) => {
  active = false
  ++configEpoch
  controller?.dispose()
  controller = null
  Browser.storage.onChanged.removeListener(changed)
  if (!event.persisted) {
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', restore)
  }
}
const restore = (event) => {
  if (event.persisted) start()
}
window.addEventListener('pagehide', hide)
window.addEventListener('pageshow', restore)
start()
