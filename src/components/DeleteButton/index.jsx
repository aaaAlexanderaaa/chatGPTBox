import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { TrashIcon } from '@primer/octicons-react'
import { cn } from '../../utils/cn.mjs'

DeleteButton.propTypes = {
  onConfirm: PropTypes.func.isRequired,
  size: PropTypes.number.isRequired,
  text: PropTypes.string.isRequired,
  className: PropTypes.string,
}

function DeleteButton({ onConfirm, size, text, className }) {
  const { t } = useTranslation()
  const [waitConfirm, setWaitConfirm] = useState(false)
  const confirmRef = useRef(null)
  const iconRef = useRef(null)

  useEffect(() => {
    if (waitConfirm) confirmRef.current.focus()
  }, [waitConfirm])

  return (
    <span className={cn(className)}>
      <button
        ref={confirmRef}
        type="button"
        className="normal-button"
        style={{
          fontSize: '10px',
          ...(waitConfirm ? {} : { display: 'none' }),
        }}
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
        onBlur={() => {
          setWaitConfirm(false)
        }}
        onClick={(e) => {
          e.stopPropagation()
          setWaitConfirm(false)
          onConfirm()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setWaitConfirm(false)
            iconRef.current?.focus()
          }
        }}
      >
        {t('Confirm')}
      </button>
      <button
        ref={iconRef}
        type="button"
        title={text}
        className="gpt-util-icon"
        style={{
          background: 'none',
          border: 'none',
          ...(waitConfirm ? { display: 'none' } : {}),
        }}
        aria-label={text}
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          setWaitConfirm(true)
        }}
      >
        <TrashIcon size={size} />
      </button>
    </span>
  )
}

export default DeleteButton
