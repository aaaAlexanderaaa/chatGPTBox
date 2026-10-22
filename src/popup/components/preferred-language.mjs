import Browser from 'webextension-polyfill'
import { languageList } from '../../config/language.mjs'
import { preferredLanguageKey as resolveLanguageKey } from '../../config/language-preference.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

export function buildLanguageOptions(t = (value) => value) {
  const opts = Object.entries(languageList).map(([value, v]) => ({
    value,
    label: value === 'auto' ? t('Auto') : v.native || v.name || value,
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

  const lang = resolveLanguageKey({ ...config, preferredLanguage: preferredLanguageKey })
  await i18n.changeLanguage(lang)
  await Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu }).catch(() => {})

  const tabs = await Browser.tabs.query({})
  await Promise.allSettled(
    tabs.map((tab) =>
      Browser.tabs
        .sendMessage(tab.id, {
          type: RuntimeMessage.ChangeLang,
          data: { lang },
        })
        .catch(() => {}),
    ),
  )
}
