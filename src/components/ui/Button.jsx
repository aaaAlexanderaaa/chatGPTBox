import { forwardRef } from 'preact/compat'
import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * Button component with multiple variants
 * Matches the demo design system
 */
const Button = forwardRef(
  (
    { className, variant = 'default', size = 'default', type = 'button', children, ...props },
    ref,
  ) => {
    return (
      <button
        type={type}
        className={cn(
          // Base styles
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50',

          // Variants
          {
            // Primary - teal gradient
            default:
              'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]',

            // Secondary - subtle background
            secondary:
              'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]',

            // Ghost - no background
            ghost: 'hover:bg-secondary hover:text-foreground',

            // Outline - bordered
            outline: 'border border-border bg-transparent hover:bg-secondary hover:text-foreground',

            // Destructive - red
            destructive:
              'bg-destructive/10 text-destructive hover:bg-destructive/20 active:scale-[0.98]',

            // Link - text only
            link: 'text-primary underline-offset-4 hover:underline',

            // Icon - square button for icons
            icon: 'hover:bg-secondary text-muted-foreground hover:text-foreground',
          }[variant],

          // Sizes
          {
            default: 'h-9 px-4 py-2',
            sm: 'h-8 px-3 text-xs',
            lg: 'h-10 px-6',
            icon: 'h-8 w-8 p-0',
          }[size],

          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'

Button.propTypes = {
  className: PropTypes.string,
  type: PropTypes.oneOf(['button', 'submit', 'reset']),
  variant: PropTypes.oneOf([
    'default',
    'secondary',
    'ghost',
    'outline',
    'destructive',
    'link',
    'icon',
  ]),
  size: PropTypes.oneOf(['default', 'sm', 'lg', 'icon']),
  children: PropTypes.node,
}

export { Button }
