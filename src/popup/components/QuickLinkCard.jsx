import PropTypes from 'prop-types'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '../../utils/cn.mjs'

export function QuickLinkCard({
  icon: Icon,
  title,
  description,
  stats = [],
  actionLabel,
  onAction,
  className,
}) {
  const filteredStats = stats.filter(Boolean)

  return (
    <div className={cn('rounded-xl border border-border bg-card/60 p-4 space-y-4', className)}>
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/10">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      {filteredStats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filteredStats.map((stat) => (
            <span
              key={stat}
              className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {stat}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        <ArrowUpRight className="w-4 h-4" />
        {actionLabel}
      </button>
    </div>
  )
}

QuickLinkCard.propTypes = {
  icon: PropTypes.elementType,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  stats: PropTypes.arrayOf(PropTypes.string),
  actionLabel: PropTypes.string.isRequired,
  onAction: PropTypes.func.isRequired,
  className: PropTypes.string,
}
