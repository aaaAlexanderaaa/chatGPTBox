import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Send, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { getUserConfig } from '../../config/storage.mjs'
import { cn } from '../../utils/cn.mjs'
import { shouldHandleInputAction } from '../../utils/should-handle-input-action.mjs'

// Draft storage lives in the extension's own storage.local, never page
// localStorage: this component also renders inside content scripts, where
// localStorage belongs to the host page and would leak every keystroke to
// the site and its third-party scripts.
const draftStorageKey = (draftKey) => `inputbox-draft:${draftKey}`

const MIN_INPUT_HEIGHT = 40
const AUTO_MAX_INPUT_HEIGHT = 180
const MANUAL_MAX_INPUT_HEIGHT = 320

function autoGrow(el) {
  // border-box: height and scrollHeight both include padding, so this is exact
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, AUTO_MAX_INPUT_HEIGHT)}px`
}

export function InputBox({ onSubmit, enabled, postMessage, draftKey }) {
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
  const inputRef = useRef(null)
  // Once the user drags the handle, their explicit height wins over auto-grow
  const manuallyResizedRef = useRef(false)
  const dragState = useRef(null)

  useEffect(() => {
    inputRef.current.focus()
  }, [])

  useEffect(() => {
    if (!manuallyResizedRef.current) autoGrow(inputRef.current)
  }, [value])

  useEffect(() => {
    if (enabled)
      getUserConfig().then((config) => {
        if (config.focusAfterAnswer) inputRef.current?.focus()
      })
  }, [enabled])

  const handleKeyDownOrClick = (e) => {
    e.stopPropagation()
    if (shouldHandleInputAction(e)) {
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

  // Top-edge drag handle: pull up to grow the input into the conversation
  // area. Replaces the old rotateX(180deg) reverse-resize hack and its 160px
  // of dead space.
  const onHandlePointerDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: inputRef.current.offsetHeight,
    }
  }

  const onHandlePointerMove = (e) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const next = Math.min(
      MANUAL_MAX_INPUT_HEIGHT,
      Math.max(MIN_INPUT_HEIGHT, Math.round(drag.startHeight + (drag.startY - e.clientY))),
    )
    manuallyResizedRef.current = true
    inputRef.current.style.height = `${next}px`
  }

  const onHandlePointerUp = (e) => {
    if (dragState.current?.pointerId !== e.pointerId) return
    dragState.current = null
  }

  return (
    <div className={cn('input-box', isFocused && 'input-box--focused')}>
      <div
        className="input-box-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('Resize input')}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
      >
        <span className="input-box-resize-grip" />
      </div>
      <textarea
        dir="auto"
        ref={inputRef}
        rows={1}
        disabled={false}
        className="interact-input"
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

      {/* Submit/Stop Button */}
      <button
        className={cn('submit-button', !enabled && 'stop')}
        onClick={handleKeyDownOrClick}
        aria-label={enabled ? t('Send') : t('Stop')}
      >
        {enabled ? <Send size={15} /> : <Square size={15} />}
      </button>
    </div>
  )
}

InputBox.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  enabled: PropTypes.bool.isRequired,
  postMessage: PropTypes.func.isRequired,
  draftKey: PropTypes.string,
}

export default InputBox
