import { languages } from 'countries-list'
import { getUserConfig } from './storage.mjs'
import { normalizeLanguageKey, preferredLanguageKey } from './language-preference.mjs'

export const languageList = { auto: { name: 'Auto', native: 'Auto' }, ...languages }
languageList.zh.name = 'Chinese (Simplified)'
languageList.zh.native = '简体中文'
languageList.zhHant = { ...languageList.zh }
languageList.zhHant.name = 'Chinese (Traditional)'
languageList.zhHant.native = '正體中文'
languageList.in = {}
languageList.in.name = 'Indonesia'
languageList.in.native = 'Indonesia'

export async function getUserLanguage() {
  return languageList[normalizeLanguageKey((await getUserConfig()).userLanguage)]?.name || 'English'
}

export async function getUserLanguageNative() {
  return (
    languageList[normalizeLanguageKey((await getUserConfig()).userLanguage)]?.native || 'English'
  )
}

export async function getPreferredLanguage() {
  const config = await getUserConfig()
  return languageList[preferredLanguageKey(config)]?.name || 'English'
}

export async function getPreferredLanguageNative() {
  const config = await getUserConfig()
  return languageList[preferredLanguageKey(config)]?.native || 'English'
}
