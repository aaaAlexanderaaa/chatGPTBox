import PropTypes from 'prop-types'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn.mjs'

/**
 * SelectField - A styled select dropdown
 * Matches the demo design
 */
export function SelectField({ value, onChange, options, className, minWidth = '160px' }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-9 pl-3 pr-8 text-sm bg-input border border-border rounded-lg appearance-none',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          'cursor-pointer text-foreground transition-all',
          className,
        )}
        style={{ minWidth }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  )
}

SelectField.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  className: PropTypes.string,
  minWidth: PropTypes.string,
}
