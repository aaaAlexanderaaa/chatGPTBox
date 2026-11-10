import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Send, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserConfig } from '../../config/storage.mjs'
import { cn } from '../../utils/cn.mjs'
import { shouldHandleInputAction } from '../../utils/should-handle-input-action.mjs'
import { readInputDraft, writeInputDraft, removeInputDraft } from '../../services/input-drafts.mjs'

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

export function InputBox({
  onSubmit,
  enabled,
  postMessage,
  draftKey,
  stopLabel = 'Stop',
  stopPlaceholder,
  readOnly = false,
  draftFlushRef,
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const valueRef = useRef(value)
  valueRef.current = value
  const editVersion = useRef(0)
  const activeDraftKey = useRef(draftKey)
  const lastWrite = useRef(null)
  const mounted = useRef(true)
  const submitting = useRef(false)
  const draftSavedRef = useRef(true)

  const saveDraft = (key, snapshot, version) => {
    if (lastWrite.current?.key === key && lastWrite.current.version === version)
      return lastWrite.current.promise
    const pending = { key, version, promise: null }
    pending.promise = writeInputDraft(draftStorageKey(key), snapshot).then(
      () => {
        if (activeDraftKey.current === key && editVersion.current === version)
          draftSavedRef.current = true
      },
      (error) => {
        if (lastWrite.current === pending) lastWrite.current = null
        throw error
      },
    )
    lastWrite.current = pending
    return pending.promise
  }
  const flushDraft = async (key = activeDraftKey.current) => {
    if (!key || draftSavedRef.current) return Promise.resolve()
    do {
      await saveDraft(key, valueRef.current, editVersion.current)
    } while (activeDraftKey.current === key && !draftSavedRef.current)
  }

  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Explicit navigation awaits flush. Blur/pagehide/unmount start a final
  // write; a process killed before storage acknowledges it is not guaranteed.
  useLayoutEffect(() => {
    activeDraftKey.current = draftKey
    draftSavedRef.current = true
    if (!draftKey) return
    let cancelled = false
    const version = editVersion.current
    const onHide = () => {
      void flushDraft(draftKey).catch(() => {})
    }
    window.addEventListener('pagehide', onHide)
    void readInputDraft(draftStorageKey(draftKey))
      .then((stored) => {
        if (cancelled || editVersion.current !== version) return
        valueRef.current = stored
        setValue(stored)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      window.removeEventListener('pagehide', onHide)
      void flushDraft(draftKey).catch(() => {})
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftKey || draftSavedRef.current) return
    const version = editVersion.current
    const timer = setTimeout(() => {
      if (
        activeDraftKey.current !== draftKey ||
        editVersion.current !== version ||
        draftSavedRef.current
      )
        return
      void saveDraft(draftKey, value, version).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [draftKey, value])

  useLayoutEffect(() => {
    if (!draftFlushRef) return
    const flush = () => flushDraft(draftKey)
    draftFlushRef.current = flush
    return () => {
      if (draftFlushRef.current === flush) draftFlushRef.current = null
    }
  }, [draftFlushRef, draftKey])

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

  const handleKeyDownOrClick = async (e) => {
    e.stopPropagation()
    if (readOnly && enabled) return
    if (shouldHandleInputAction(e)) {
      e.preventDefault()
      if (enabled) {
        if (!value || submitting.current) return
        const snapshot = valueRef.current,
          version = editVersion.current,
          submittedKey = activeDraftKey.current
        submitting.current = true
        try {
          const accepted = await onSubmit(snapshot)
          if (
            accepted === false ||
            !mounted.current ||
            editVersion.current !== version ||
            activeDraftKey.current !== submittedKey
          )
            return
        } catch {
          return
        } finally {
          submitting.current = false
        }
        editVersion.current += 1
        valueRef.current = ''
        setValue('')
        if (draftKey) {
          draftSavedRef.current = true // suppress the debounced re-save of ''
          lastWrite.current = null
          void removeInputDraft(draftStorageKey(draftKey)).catch(() => {})
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
        readOnly={readOnly}
        className="interact-input"
        placeholder={
          readOnly && enabled
            ? t('Reopen saved conversation')
            : enabled
            ? t('Type your question here')
            : t(stopPlaceholder || 'Generating... Press Enter to stop')
        }
        value={value}
        onChange={(e) => {
          editVersion.current += 1
          valueRef.current = e.target.value
          draftSavedRef.current = false
          setValue(e.target.value)
        }}
        onKeyDown={handleKeyDownOrClick}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          void flushDraft().catch(() => {})
        }}
      />

      {/* Submit/Stop Button */}
      <button
        className={cn('submit-button', !enabled && 'stop')}
        onClick={handleKeyDownOrClick}
        disabled={readOnly && enabled}
        aria-label={enabled ? t('Send') : t(stopLabel)}
        title={enabled ? t('Send') : t(stopLabel)}
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
  stopLabel: PropTypes.string,
  stopPlaceholder: PropTypes.string,
  readOnly: PropTypes.bool,
  draftFlushRef: PropTypes.shape({ current: PropTypes.any }),
}

export default InputBox
