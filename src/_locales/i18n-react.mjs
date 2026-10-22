import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { initializeLanguage } from './language-sync.mjs'

i18n.use(initReactI18next)
export const i18nReady = initializeLanguage(i18n)
