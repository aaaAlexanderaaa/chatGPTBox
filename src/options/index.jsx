import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import '../_locales/i18n-react'
import Browser from 'webextension-polyfill'
import { changeLanguage } from 'i18next'
import { MessageSquare, X, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getPreferredLanguageKey } from '../config/storage.mjs'
// Register the module settings cards for THIS bundle too: options.html is
// where the Engines section (and its module cards) renders.
import '../modules/settings-cards.mjs'
import IndependentPanelApp from '../pages/IndependentPanel/App.jsx'
import SettingsCenter from './SettingsCenter.jsx'
import { RuntimeMessage } from '../protocol/messages.mjs'
import { Button } from '../components/ui/Button.jsx'
import './styles.css'

const STORAGE_KEY_CHAT_WIDTH = 'chatgptbox:options:chatWidth'
const STORAGE_KEY_CHAT_OPEN = 'chatgptbox:options:chatOpen'
const DEFAULT_CHAT_WIDTH = 440
const MIN_CHAT_WIDTH = 360
const MAX_CHAT_WIDTH = 720

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function OptionsApp() {
  const { t } = useTranslation()
  const search = new URLSearchParams(window.location.search)
  const settingsOnly = search.get('settings_only') === 'true'
  const rootRef = useRef(null)

  const [chatOpen, setChatOpen] = useState(() => {
    if (settingsOnly) return false
    return localStorage.getItem(STORAGE_KEY_CHAT_OPEN) === 'true'
  })
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem(STORAGE_KEY_CHAT_WIDTH) || '', 10)
    return Number.isFinite(saved)
      ? clamp(saved, MIN_CHAT_WIDTH, MAX_CHAT_WIDTH)
      : DEFAULT_CHAT_WIDTH
  })
  const chatWidthRef = useRef(chatWidth)
  const dragState = useRef({ active: false, pointerId: null })

  useEffect(() => {
    getPreferredLanguageKey().then((lang) => changeLanguage(lang))
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('chatgptbox-extension-page')

    const listener = (message) => {
      if (message.type === RuntimeMessage.ChangeLang) {
        changeLanguage(message.data.lang)
      }
    }
    Browser.runtime.onMessage.addListener(listener)
    return () => {
      Browser.runtime.onMessage.removeListener(listener)
    }
  }, [])

  useEffect(() => {
    chatWidthRef.current = chatWidth
  }, [chatWidth])

  const toggleChat = () => {
    setChatOpen((open) => {
      const next = !open
      localStorage.setItem(STORAGE_KEY_CHAT_OPEN, String(next))
      return next
    })
  }

  const handleResizePointerDown = (e) => {
    if (window.matchMedia('(max-width: 1000px)').matches) return
    dragState.current = { active: true, pointerId: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const handleResizePointerMove = (e) => {
    if (!dragState.current.active) return
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const newWidth = clamp(Math.round(rect.right - e.clientX), MIN_CHAT_WIDTH, MAX_CHAT_WIDTH)
    chatWidthRef.current = newWidth
    setChatWidth(newWidth)
  }

  const handleResizePointerUp = (e) => {
    if (!dragState.current.active) return
    dragState.current = { active: false, pointerId: null }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch (err) {
      // ignore
    }
    localStorage.setItem(STORAGE_KEY_CHAT_WIDTH, String(chatWidthRef.current))
  }

  return (
    <div ref={rootRef} className="options-shell">
      <header className="options-header">
        <div className="flex items-center gap-3 min-w-0">
          <img src="logo.png" alt="" className="w-7 h-7 rounded-lg" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground leading-tight">ChatGPTBox</h1>
            <p className="text-xs text-muted-foreground leading-tight">{t('Settings')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/aaaAlexanderaaa/chatGPTBox"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('Documentation')}
          </a>
          {!settingsOnly && (
            <Button variant={chatOpen ? 'secondary' : 'outline'} size="sm" onClick={toggleChat}>
              {chatOpen ? <X className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
              {chatOpen ? t('Close chat preview') : t('Preview chat')}
            </Button>
          )}
        </div>
      </header>

      <div className="options-body">
        <SettingsCenter />

        {!settingsOnly && chatOpen && (
          <>
            <div
              className="options-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat preview"
              tabIndex={0}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
            />
            <aside
              className="options-chat"
              style={{ width: `${chatWidth}px` }}
              aria-label={t('Chat preview')}
            >
              <IndependentPanelApp embedded={true} showSettingsButton={false} />
            </aside>
          </>
        )}
      </div>
    </div>
  )
}

render(<OptionsApp />, document.getElementById('app'))
