import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * SegmentedControl - one choice out of a small set, rendered as a joined
 * control. Used for view switching (popup tabs) and option picking
 * (theme mode). Icons always render; labels can be hidden to save space.
 */
function SegmentedControl({
  options,
  value,
  onChange,
  size = 'default',
  showLabels = true,
  className,
  ariaLabel,
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-1 p-1 bg-secondary/60 rounded-lg', className)}
    >
      {options.map((option) => {
        const Icon = option.icon
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={!showLabels && option.label ? option.label : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-all whitespace-nowrap',
              size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
            {showLabels && option.label && <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

SegmentedControl.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string,
      icon: PropTypes.elementType,
    }),
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  size: PropTypes.oneOf(['default', 'sm']),
  showLabels: PropTypes.bool,
  className: PropTypes.string,
  ariaLabel: PropTypes.string,
}

export { SegmentedControl }
