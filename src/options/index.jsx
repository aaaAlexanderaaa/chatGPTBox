import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import '../_locales/i18n-react'
import Browser from 'webextension-polyfill'
import { changeLanguage } from 'i18next'
import { getPreferredLanguageKey } from '../config/index.mjs'
import IndependentPanelApp from '../pages/IndependentPanel/App.jsx'
import Popup from '../popup/PopupNew.jsx'
import './styles.css'

const STORAGE_KEY_SETTINGS_WIDTH = 'chatgptbox:options:settingsWidth'
const STORAGE_KEY_SETTINGS_OPEN = 'chatgptbox:options:settingsOpen'
const DEFAULT_SETTINGS_WIDTH = 460
const MIN_SETTINGS_WIDTH = 360
const MAX_SETTINGS_WIDTH = 720

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function OptionsApp() {
  const rootRef = useRef(null)
  const settingsRef = useRef(null)

  const [settingsOpen, setSettingsOpen] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS_OPEN)
    return saved !== 'false'
  })
  const [settingsWidth, setSettingsWidth] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem(STORAGE_KEY_SETTINGS_WIDTH) || '', 10)
    return Number.isFinite(saved)
      ? clamp(saved, MIN_SETTINGS_WIDTH, MAX_SETTINGS_WIDTH)
      : DEFAULT_SETTINGS_WIDTH
  })
  const settingsWidthRef = useRef(settingsWidth)

  const dragState = useRef({ active: false, pointerId: null })

  const setLanguage = async () => {
    const lang = await getPreferredLanguageKey()
    changeLanguage(lang)
  }

  useEffect(() => {
    setLanguage()
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('chatgptbox-extension-page')

    const listener = async (message) => {
      if (message.type === 'CHANGE_LANG') {
        changeLanguage(message.data.lang)
      }
    }
    Browser.runtime.onMessage.addListener(listener)
    return () => {
      Browser.runtime.onMessage.removeListener(listener)
    }
  }, [])

  useEffect(() => {
    settingsWidthRef.current = settingsWidth
  }, [settingsWidth])

  const handleResizePointerDown = (e) => {
    // Only allow drag on desktop-like layouts
    if (window.matchMedia('(max-width: 900px)').matches) return
    if (!settingsOpen) return

    dragState.current = { active: true, pointerId: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const handleResizePointerMove = (e) => {
    if (!dragState.current.active) return
    const root = rootRef.current
    if (!root) return

    const rect = root.getBoundingClientRect()
    const newWidth = clamp(
      Math.round(rect.right - e.clientX),
      MIN_SETTINGS_WIDTH,
      MAX_SETTINGS_WIDTH,
    )
    settingsWidthRef.current = newWidth
    setSettingsWidth(newWidth)
  }

  const handleResizePointerUp = (e) => {
    if (!dragState.current.active) return
    dragState.current = { active: false, pointerId: null }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch (err) {
      // ignore
    }
    localStorage.setItem(STORAGE_KEY_SETTINGS_WIDTH, String(settingsWidthRef.current))
  }

  const openSettings = () => {
    setSettingsOpen(true)
    localStorage.setItem(STORAGE_KEY_SETTINGS_OPEN, 'true')
    setTimeout(
      () => settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      0,
    )
  }

  const closeSettings = () => {
    setSettingsOpen(false)
    localStorage.setItem(STORAGE_KEY_SETTINGS_OPEN, 'false')
  }

  const chatProps = useMemo(
    () => ({
      embedded: true,
      showSettingsButton: true,
      onOpenSettings: openSettings,
    }),
    [],
  )

  return (
    <div ref={rootRef} className="options-shell">
      <div className="options-chat" aria-label="Chat">
        <IndependentPanelApp {...chatProps} />
      </div>

      {settingsOpen && (
        <>
          <div
            className="options-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize settings panel"
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
          />

          <div
            ref={settingsRef}
            className="options-settings"
            style={{ width: `${settingsWidth}px` }}
            aria-label="Settings"
          >
            <button
              type="button"
              className="options-settings-close"
              aria-label="Close settings panel"
              title="Close"
              onClick={closeSettings}
            >
              ×
            </button>
            <Popup />
          </div>
        </>
      )}
    </div>
  )
}

render(<OptionsApp />, document.getElementById('app'))
