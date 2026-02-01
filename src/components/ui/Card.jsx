import PropTypes from 'prop-types'
import { cn } from '../../utils/cn.mjs'

/**
 * Card component
 * Matches the demo design system
 */
function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

Card.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

/**
 * CardHeader component
 */
function CardHeader({ className, children, ...props }) {
  return (
    <div className={cn('flex flex-col space-y-1.5 p-4', className)} {...props}>
      {children}
    </div>
  )
}

CardHeader.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

/**
 * CardTitle component
 */
function CardTitle({ className, children, ...props }) {
  return (
    <h3 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props}>
      {children}
    </h3>
  )
}

CardTitle.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

/**
 * CardDescription component
 */
function CardDescription({ className, children, ...props }) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)} {...props}>
      {children}
    </p>
  )
}

CardDescription.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

/**
 * CardContent component
 */
function CardContent({ className, children, ...props }) {
  return (
    <div className={cn('p-4 pt-0', className)} {...props}>
      {children}
    </div>
  )
}

CardContent.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

/**
 * CardFooter component
 */
function CardFooter({ className, children, ...props }) {
  return (
    <div className={cn('flex items-center p-4 pt-0', className)} {...props}>
      {children}
    </div>
  )
}

CardFooter.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
