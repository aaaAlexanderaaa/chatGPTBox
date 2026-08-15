import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Send, Square } from 'lucide-react'
import { isFirefox, isMobile, isSafari, updateRefHeight } from '../../utils'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { getUserConfig } from '../../config/storage.mjs'
import { cn } from '../../utils/cn.mjs'

// Draft storage lives in the extension's own storage.local, never page
// localStorage: this component also renders inside content scripts, where
// localStorage belongs to the host page and would leak every keystroke to
// the site and its third-party scripts.
const draftStorageKey = (draftKey) => `inputbox-draft:${draftKey}`

export function InputBox({ onSubmit, enabled, postMessage, reverseResizeDir, draftKey }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  // Draft autosave (D-19 hard requirement): any blur, crash, or surface
  // switch keeps every keystroke. Keyed by the owning surface.
  const draftSavedRef = useRef(true) // false while a debounced save is pending

  useEffect(() => {
    if (!draftKey) return
    let cancelled = false
    void Browser.storage.local
      .get(draftStorageKey(draftKey))
      .then((stored) => {
        if (cancelled) return
        setValue(stored?.[draftStorageKey(draftKey)] || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftKey || draftSavedRef.current) return
    const timer = setTimeout(() => {
      void Browser.storage.local
        .set({ [draftStorageKey(draftKey)]: value })
        .catch(() => {})
        .then(() => {
          draftSavedRef.current = true
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [draftKey, value])
  const [isFocused, setIsFocused] = useState(false)
  const reverseDivRef = useRef(null)
  const inputRef = useRef(null)
  const resizedRef = useRef(false)
  const [internalReverseResizeDir, setInternalReverseResizeDir] = useState(reverseResizeDir)

  useEffect(() => {
    setInternalReverseResizeDir(
      !isSafari() && !isFirefox() && !isMobile() ? internalReverseResizeDir : false,
    )
  }, [])

  const virtualInputRef = internalReverseResizeDir ? reverseDivRef : inputRef

  useEffect(() => {
    inputRef.current.focus()

    const onResizeY = () => {
      if (virtualInputRef.current.h !== virtualInputRef.current.offsetHeight) {
        virtualInputRef.current.h = virtualInputRef.current.offsetHeight
        if (!resizedRef.current) {
          resizedRef.current = true
          virtualInputRef.current.style.maxHeight = ''
        }
      }
    }
    virtualInputRef.current.h = virtualInputRef.current.offsetHeight
    virtualInputRef.current.addEventListener('mousemove', onResizeY)
  }, [])

  useEffect(() => {
    if (!resizedRef.current) {
      if (!internalReverseResizeDir) {
        updateRefHeight(inputRef)
        virtualInputRef.current.h = virtualInputRef.current.offsetHeight
        virtualInputRef.current.style.maxHeight = '160px'
      }
    }
  }, [value, internalReverseResizeDir])

  useEffect(() => {
    if (enabled)
      getUserConfig().then((config) => {
        if (config.focusAfterAnswer) inputRef.current.focus()
      })
  }, [enabled])

  const handleKeyDownOrClick = (e) => {
    e.stopPropagation()
    if (e.type === 'click' || (e.keyCode === 13 && e.shiftKey === false)) {
      e.preventDefault()
      if (enabled) {
        if (!value) return
        onSubmit(value)
        setValue('')
        if (draftKey) {
          draftSavedRef.current = true // suppress the debounced re-save of ''
          void Browser.storage.local.remove(draftStorageKey(draftKey)).catch(() => {})
        }
      } else {
        postMessage({ stop: true })
      }
    }
  }

  return (
    <div className={cn('input-box', isFocused && 'input-box--focused')}>
      <div
        ref={reverseDivRef}
        style={
          internalReverseResizeDir
            ? {
                transform: 'rotateX(180deg)',
                resize: 'vertical',
                overflow: 'hidden',
                minHeight: '160px',
              }
            : undefined
        }
      >
        <textarea
          dir="auto"
          ref={inputRef}
          disabled={false}
          className="interact-input"
          style={
            internalReverseResizeDir
              ? { transform: 'rotateX(180deg)', resize: 'none' }
              : { resize: 'vertical', minHeight: '48px' }
          }
          placeholder={
            enabled ? t('Type your question here') : t('Generating... Press Enter to stop')
          }
          value={value}
          onChange={(e) => {
            draftSavedRef.current = false
            setValue(e.target.value)
          }}
          onKeyDown={handleKeyDownOrClick}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
      </div>

      {/* Submit/Stop Button */}
      <button
        className={cn('submit-button', !enabled && 'stop')}
        onClick={handleKeyDownOrClick}
        aria-label={enabled ? t('Send') : t('Stop')}
      >
        {enabled ? <Send size={16} /> : <Square size={16} />}
      </button>
    </div>
  )
}

InputBox.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  enabled: PropTypes.bool.isRequired,
  reverseResizeDir: PropTypes.bool,
  postMessage: PropTypes.func.isRequired,
  draftKey: PropTypes.string,
}

export default InputBox
