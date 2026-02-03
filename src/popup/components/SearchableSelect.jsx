import PropTypes from 'prop-types'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '../../utils/cn.mjs'

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  allowCustomValue = false,
  minWidth = '160px',
}) {
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = useMemo(() => options.find((opt) => opt.value === value), [options, value])

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => {
      const label = (opt.label || '').toLowerCase()
      const val = (opt.value || '').toLowerCase()
      return label.includes(q) || val.includes(q)
    })
  }, [options, query])

  const customValue = useMemo(() => {
    if (!allowCustomValue) return null
    const raw = query.trim()
    if (!raw) return null
    const exists = options.some((opt) => opt.value === raw)
    return exists ? null : raw
  }, [allowCustomValue, options, query])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [open])

  const applyValue = (nextValue) => {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={containerRef} style={{ minWidth }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-9 w-full pl-3 pr-8 text-sm bg-input border border-border rounded-lg',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          'cursor-pointer text-foreground transition-all text-left',
        )}
      >
        <span className={cn('block truncate', !selected ? 'text-muted-foreground' : undefined)}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                  setQuery('')
                }
                if (e.key === 'Enter' && customValue) {
                  e.preventDefault()
                  applyValue(customValue)
                }
              }}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground',
              )}
            />
          </div>

          <div className="max-h-64 overflow-auto">
            {customValue && (
              <button
                type="button"
                onClick={() => applyValue(customValue)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate">{`Use "${customValue}"`}</span>
                </div>
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">{'No results'}</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => applyValue(opt.value)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm hover:bg-secondary/60 transition-colors',
                      isSelected ? 'bg-secondary/40' : undefined,
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </div>
                    {opt.value !== opt.label && (
                      <div className="text-xs text-muted-foreground truncate">{opt.value}</div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

SearchableSelect.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  placeholder: PropTypes.string,
  searchPlaceholder: PropTypes.string,
  allowCustomValue: PropTypes.bool,
  minWidth: PropTypes.string,
}
