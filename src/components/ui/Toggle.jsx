import { useState } from 'preact/hooks'
import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * Toggle/Switch component
 * Matches the demo design system
 */
function Toggle({ checked: controlledChecked, defaultChecked = false, onChange, className }) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked)

  // Support both controlled and uncontrolled modes
  const isControlled = controlledChecked !== undefined
  const checked = isControlled ? controlledChecked : internalChecked

  const handleClick = () => {
    if (!isControlled) {
      setInternalChecked(!checked)
    }
    if (onChange) {
      onChange(!checked)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleClick}
      className={cn(
        'relative h-6 w-10 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-secondary',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all',
          checked ? 'left-5' : 'left-1',
        )}
      />
    </button>
  )
}

Toggle.propTypes = {
  checked: PropTypes.bool,
  defaultChecked: PropTypes.bool,
  onChange: PropTypes.func,
  className: PropTypes.string,
}

export { Toggle }
