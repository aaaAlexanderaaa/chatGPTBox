import { render } from 'preact'
import '../../_locales/i18n-react'
import App from './App'
import Browser from 'webextension-polyfill'
import { changeLanguage } from 'i18next'
import { getPreferredLanguageKey } from '../../config/storage.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

document.body.style.margin = 0
document.body.style.overflow = 'hidden'
document.documentElement.classList.add('chatgptbox-extension-page')
getPreferredLanguageKey().then((lang) => {
  changeLanguage(lang)
})
Browser.runtime.onMessage.addListener((message) => {
  if (message.type === RuntimeMessage.ChangeLang) {
    const data = message.data
    changeLanguage(data.lang)
  }
})
render(<App />, document.getElementById('app'))
