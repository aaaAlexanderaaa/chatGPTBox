import { forwardRef } from 'preact/compat'
import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * Input component
 * Matches the demo design system
 */
const Input = forwardRef(({ className, type = 'text', ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'transition-all',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})

Input.displayName = 'Input'

Input.propTypes = {
  className: PropTypes.string,
  type: PropTypes.string,
}

/**
 * Textarea component
 */
const Textarea = forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none transition-all',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})

Textarea.displayName = 'Textarea'

Textarea.propTypes = {
  className: PropTypes.string,
}

export { Input, Textarea }
