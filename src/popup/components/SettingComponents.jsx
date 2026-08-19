import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'
import { Toggle } from '../../components/ui/Toggle.jsx'
import { Input } from '../../components/ui/Input.jsx'

/**
 * SettingRow - A row in the settings panel
 * Layout: Label + hint on left, control on right
 */
export function SettingRow({ label, hint, action, children, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="shrink-0">{children}</div>
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
 * SettingSection - A group of settings with a title and optional description
 */
export function SettingSection({ title, description, children, className }) {
  return (
    <div className={cn('space-y-4', className)}>
      {(title || description) && (
        <div className="mb-3">
          {title && (
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </h3>
          )}
          {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  )
}

SettingSection.propTypes = {
  title: PropTypes.string,
  description: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
}

/**
 * ToggleRow - A setting row with a toggle switch
 */
export function ToggleRow({ label, hint, checked, defaultChecked, onChange, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
      <div className="min-w-0">
        <span className="text-sm text-foreground">{label}</span>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Toggle checked={checked} defaultChecked={defaultChecked} onChange={onChange} />
    </div>
  )
}

ToggleRow.propTypes = {
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  checked: PropTypes.bool,
  defaultChecked: PropTypes.bool,
  onChange: PropTypes.func,
  className: PropTypes.string,
}

/**
 * NumberRow - A setting row with a clamped numeric input
 */
export function NumberRow({ label, hint, value, min, max, step, onChange, className }) {
  return (
    <SettingRow label={label} hint={hint} className={className}>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 text-right"
      />
    </SettingRow>
  )
}

NumberRow.propTypes = {
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  value: PropTypes.number.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  className: PropTypes.string,
}

/**
 * ToggleSwitch - re-exported kit toggle under the legacy name so existing
 * tab code keeps working.
 */
export { Toggle as ToggleSwitch }

/**
 * Divider - A horizontal line separator
 */
export function Divider({ className }) {
  return <div className={cn('border-t border-border my-4', className)} />
}

Divider.propTypes = {
  className: PropTypes.string,
}
