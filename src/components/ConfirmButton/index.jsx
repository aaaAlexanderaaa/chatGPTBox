import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

ConfirmButton.propTypes = {
  onConfirm: PropTypes.func.isRequired,
  text: PropTypes.string.isRequired,
  className: PropTypes.string,
  icon: PropTypes.node,
}

function ConfirmButton({ onConfirm, text, className, icon }) {
  const { t } = useTranslation()
  const [waitConfirm, setWaitConfirm] = useState(false)
  const confirmRef = useRef(null)

  useEffect(() => {
    if (waitConfirm) confirmRef.current.focus()
  }, [waitConfirm])

  return (
    <span className={cn(className)}>
      <button
        ref={confirmRef}
        type="button"
        className={cn('normal-button', className)}
        style={{
          ...(waitConfirm ? {} : { display: 'none' }),
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onBlur={() => {
          setWaitConfirm(false)
        }}
        onClick={() => {
          setWaitConfirm(false)
          onConfirm()
        }}
      >
        {t('Confirm')}
      </button>
      <button
        type="button"
        className={cn('normal-button', className)}
        style={{
          ...(waitConfirm ? { display: 'none' } : {}),
        }}
        onClick={() => {
          setWaitConfirm(true)
        }}
      >
        {icon}
        {text}
      </button>
    </span>
  )
}

export default ConfirmButton
