import { useEffect, useState } from 'preact/hooks'
import { X } from 'lucide-react'

function useForceClosed(breakpoint = 900) {
  const [forceClosed, setForceClosed] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
      : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const listener = (event) => setForceClosed(event.matches)
    query.addEventListener?.('change', listener)
    return () => query.removeEventListener?.('change', listener)
  }, [breakpoint])
  return forceClosed
}

export function Shell({
  header,
  sidebar,
  children,
  detailsOpen = false,
  detailsChild = null,
  onCloseDetails,
}) {
  const forceClosed = useForceClosed(900)
  const showDetails = detailsOpen && !forceClosed && detailsChild != null

  return (
    <div className="dsh-app">
      {header}
      <div className="flex flex-1 min-h-0">
        {sidebar}
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
        {showDetails ? (
          <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-xs font-medium">Details</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                title="Close details"
                onClick={() => onCloseDetails?.()}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3 text-xs">{detailsChild}</div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
