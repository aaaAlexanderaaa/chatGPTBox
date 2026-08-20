import { render } from 'preact'
import Browser from 'webextension-polyfill'
import { App } from './app.jsx'
import { applyDocumentAppearance } from '../../api.mjs'
import './tokens.css'

// Full-page DeepSeek Harness. The cockpit follows the extension's theme
// choice (light/dark/auto + accent) like every other surface, reading
// storage directly — the module seam cannot re-export core config without
// an import cycle. 'auto' is applied synchronously so first paint follows
// the system while storage resolves.
const THEME_KEYS = [
  'themeMode',
  'accentColorLight',
  'accentStrengthLight',
  'accentColorDark',
  'accentStrengthDark',
]

document.documentElement.dataset.theme = 'auto'
document.body.style.margin = '0'

function applyStoredTheme(stored) {
  const themeMode = stored.themeMode || 'auto'
  const resolved =
    themeMode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : themeMode
  document.documentElement.dataset.theme = themeMode
  applyDocumentAppearance(document.documentElement, stored, resolved)
}

async function boot() {
  await Browser.storage.local
    .get(THEME_KEYS)
    .then(applyStoredTheme)
    .catch(() => {})

  // Live-follow: settings edits and (in auto mode) system theme flips
  Browser.storage.local.onChanged.addListener((changes) => {
    if (!Object.keys(changes).some((key) => THEME_KEYS.includes(key))) return
    void Browser.storage.local
      .get(THEME_KEYS)
      .then(applyStoredTheme)
      .catch(() => {})
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    void Browser.storage.local
      .get(THEME_KEYS)
      .then(applyStoredTheme)
      .catch(() => {})
  })

  render(<App />, document.getElementById('app'))
}

void boot()
