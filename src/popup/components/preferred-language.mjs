import Browser from 'webextension-polyfill'
import { changeLanguage } from 'i18next'
import { languageList } from '../../config/language.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

export function buildLanguageOptions() {
  const opts = Object.entries(languageList).map(([value, v]) => ({
    value,
    label: v.native || v.name || value,
  }))
  opts.sort((a, b) => {
    if (a.value === 'auto') return -1
    if (b.value === 'auto') return 1
    return a.label.localeCompare(b.label)
  })
  return opts
}

/**
 * Persist the preferred language, switch this page's i18n, and broadcast the
 * change to every tab so injected UI follows without a reload.
 */
export async function applyPreferredLanguage(preferredLanguageKey, { config, updateConfig, i18n }) {
  await updateConfig({ preferredLanguage: preferredLanguageKey })

  const lang = preferredLanguageKey === 'auto' ? config.userLanguage : preferredLanguageKey
  i18n.changeLanguage(lang)
  changeLanguage(lang)

  const tabs = await Browser.tabs.query({})
  tabs.forEach((tab) => {
    Browser.tabs
      .sendMessage(tab.id, {
        type: RuntimeMessage.ChangeLang,
        data: { lang },
      })
      .catch(() => {})
  })
}
