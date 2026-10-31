import Browser from 'webextension-polyfill'

export const NATIVE_PASTE_SCRIPT = Object.freeze({
  id: 'chatgptbox-native-paste',
  matches: ['https://chatgpt.com/*'],
  js: ['native-chatgpt-early.js'],
  runAt: 'document_start',
  allFrames: false,
  persistAcrossSessions: true,
})
const ENABLED = 'chatgptNativePasteEnabled'
const ERROR = 'chatgptNativePasteActivationError'
const FAILURE =
  'Local paste checking is unconfirmed. Do not rely on it; reload the extension and try again.'

// Register before persisting opt-in. Default-off documents never get the early entry.
export function createNativePasteActivation(browser) {
  let queue = Promise.resolve()
  const supported = () =>
    browser.runtime.getManifest?.().manifest_version === 3 &&
    typeof browser.scripting?.registerContentScripts === 'function'
  const serial = (task) => {
    const result = queue.then(task, task)
    queue = result.catch(() => {})
    return result
  }
  const matches = (script) =>
    Object.entries(NATIVE_PASTE_SCRIPT).every(
      ([key, value]) => JSON.stringify(script[key]) === JSON.stringify(value),
    )
  const registered = () =>
    browser.scripting.getRegisteredContentScripts({ ids: [NATIVE_PASTE_SCRIPT.id] })
  const ensure = async (enabled) => {
    const current = await registered()
    if (!enabled) {
      if (current.length)
        await browser.scripting.unregisterContentScripts({ ids: [NATIVE_PASTE_SCRIPT.id] })
    } else if (!current.length)
      await browser.scripting.registerContentScripts([{ ...NATIVE_PASTE_SCRIPT }])
    else if (!matches(current[0]))
      await browser.scripting.updateContentScripts([{ ...NATIVE_PASTE_SCRIPT }])
    const actual = await registered()
    if (enabled ? actual.length !== 1 || !matches(actual[0]) : actual.length !== 0)
      throw new Error(FAILURE)
  }
  const failed = async () => {
    // Only report a confirmed off state after verifying browser cleanup. If the
    // browser cannot confirm either state, retain the flag and an explicit error.
    let off = false
    try {
      await ensure(false)
      off = true
    } catch {
      /* Settings must retain the unconfirmed-state warning. */
    }
    await browser.storage.local.set({ ...(off ? { [ENABLED]: false } : {}), [ERROR]: FAILURE })
  }
  const sync = () =>
    serial(async () => {
      if (!supported()) return
      try {
        const config = await browser.storage.local.get({ [ENABLED]: false })
        await ensure(config[ENABLED] === true)
        if (config[ENABLED] === true) await browser.storage.local.set({ [ERROR]: '' })
      } catch (error) {
        await failed().catch(() => {})
        throw new Error(FAILURE, { cause: error })
      }
    })
  return {
    sync,
    async setEnabled(message, sender) {
      if (
        sender?.id !== browser.runtime.id ||
        sender.frameId !== 0 ||
        !sender.url?.startsWith(browser.runtime.getURL('')) ||
        typeof message.data?.enabled !== 'boolean'
      )
        throw new Error('Local paste settings require an extension settings page.')
      if (!supported()) throw new Error(FAILURE)
      return serial(async () => {
        const enabled = message.data.enabled
        try {
          // Confirm registration/removal before publishing the successful state.
          await ensure(enabled)
          await browser.storage.local.set({ [ENABLED]: enabled, [ERROR]: '' })
          return { enabled, reloadRequired: true }
        } catch (error) {
          await failed().catch(() => {})
          throw new Error(FAILURE, { cause: error })
        }
      })
    },
    start() {
      if (!supported()) return () => {}
      const reconcile = () => {
        void sync().catch(() => {})
      }
      const changed = (changes, area) => {
        if (area === 'local' && ENABLED in changes) reconcile()
      }
      browser.storage.onChanged.addListener(changed)
      reconcile()
      return () => browser.storage.onChanged.removeListener(changed)
    },
  }
}
const activation = createNativePasteActivation(Browser)
export const startNativePasteActivation = () => activation.start()
export const setNativePasteEnabled = (message, sender) => activation.setEnabled(message, sender)
