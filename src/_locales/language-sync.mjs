import Browser from 'webextension-polyfill'
import { resources } from './resources.mjs'
import { getNavigatorLanguage, getPreferredLanguageKey } from '../config/storage.mjs'

const initialized = new WeakMap()

export function initializeLanguage(i18n) {
  if (initialized.has(i18n)) return initialized.get(i18n)
  const ready = (async () => {
    if (!i18n.isInitialized)
      await i18n.init({
        resources,
        lng: getNavigatorLanguage(),
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
      })
    let revision = 0
    const synchronize = async () => {
      const current = ++revision
      const language = await getPreferredLanguageKey().catch(() => getNavigatorLanguage())
      if (current === revision) await i18n.changeLanguage(language)
    }
    const changed = (changes) => {
      if (changes.preferredLanguage || changes.userLanguage) void synchronize()
    }
    const events = Browser.storage.local.onChanged || Browser.storage.onChanged
    events?.addListener(changed)
    await synchronize()
    return i18n
  })()
  initialized.set(i18n, ready)
  return ready
}
