import { forwardRef } from 'preact/compat'
import PropTypes from 'prop-types'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn.mjs'

/**
 * Select component
 * Matches the demo design system
 */
const Select = forwardRef(({ className, children, ...props }, ref) => {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-border bg-input pl-3 pr-8 text-sm text-foreground',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'cursor-pointer transition-all',
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
})

Select.displayName = 'Select'

Select.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

/**
 * SelectOption component
 */
const SelectOption = ({ value, children, ...props }) => {
  return (
    <option value={value} {...props}>
      {children}
    </option>
  )
}

SelectOption.propTypes = {
  value: PropTypes.string,
  children: PropTypes.node,
}

export { Select, SelectOption }
