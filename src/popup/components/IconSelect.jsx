import PropTypes from 'prop-types'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { cn } from '../../utils/cn.mjs'

export function IconSelect({ value, onChange, options, className, panelClassName }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const selected = options.find((o) => o.value === value) || options[0]

  useEffect(() => {
    const onDocPointerDown = (e) => {
      const root = rootRef.current
      if (!root) return
      if (!root.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-9 px-3 pr-8 text-sm bg-input border border-border rounded-lg',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          'cursor-pointer text-foreground transition-all',
          'inline-flex items-center gap-2 min-w-[220px] justify-between',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          {selected?.Icon && <selected.Icon className="w-4 h-4 text-muted-foreground" />}
          <span className="truncate">{selected?.label || value}</span>
        </span>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 mt-2 w-full max-h-72 overflow-auto',
            'bg-popover border border-border rounded-lg shadow-lg p-1',
            panelClassName,
          )}
          role="listbox"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left',
                opt.value === value
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {opt.Icon && <opt.Icon className="w-4 h-4" />}
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

IconSelect.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      Icon: PropTypes.func,
    }),
  ).isRequired,
  className: PropTypes.string,
  panelClassName: PropTypes.string,
}
