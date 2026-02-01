import { useState } from 'react'
import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * SettingRow - A row in the settings panel
 * Layout: Label + hint on left, control on right
 */
export function SettingRow({ label, hint, action, children, className }) {
  return (
    <div className={cn('flex items-center justify-between py-1', className)}>
      <div className="flex items-center gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

SettingRow.propTypes = {
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  action: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
}

/**
 * SettingSection - A group of settings with a title
 */
export function SettingSection({ title, children, className }) {
  return (
    <div className={cn('space-y-4', className)}>
      {title && (
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {title}
        </h3>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  )
}

SettingSection.propTypes = {
  title: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
}

/**
 * ToggleRow - A setting row with a toggle switch
 */
export function ToggleRow({ label, checked, defaultChecked, onChange, className }) {
  return (
    <div className={cn('flex items-center justify-between py-2', className)}>
      <span className="text-sm text-foreground">{label}</span>
      <ToggleSwitch checked={checked} defaultChecked={defaultChecked} onChange={onChange} />
    </div>
  )
}

ToggleRow.propTypes = {
  label: PropTypes.string.isRequired,
  checked: PropTypes.bool,
  defaultChecked: PropTypes.bool,
  onChange: PropTypes.func,
  className: PropTypes.string,
}

/**
 * ToggleSwitch - A simple toggle switch
 * Supports both controlled (checked prop) and uncontrolled (defaultChecked) modes
 */
export function ToggleSwitch({ checked: controlledChecked, defaultChecked = false, onChange }) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked)
  const isControlled = controlledChecked !== undefined
  const checked = isControlled ? controlledChecked : internalChecked

  const handleClick = () => {
    const newValue = !checked
    if (!isControlled) {
      setInternalChecked(newValue)
    }
    if (onChange) {
      onChange(newValue)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleClick}
      className={cn(
        'relative w-10 h-6 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-secondary',
      )}
    >
      <span
        className={cn(
          'absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all',
          checked ? 'left-5' : 'left-1',
        )}
      />
    </button>
  )
}

ToggleSwitch.propTypes = {
  checked: PropTypes.bool,
  defaultChecked: PropTypes.bool,
  onChange: PropTypes.func,
}

/**
 * Divider - A horizontal line separator
 */
export function Divider({ className }) {
  return <div className={cn('border-t border-border my-4', className)} />
}

Divider.propTypes = {
  className: PropTypes.string,
}
