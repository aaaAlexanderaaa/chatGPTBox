import { useEffect, useRef, useState } from 'preact/hooks'
import { jobsForPopover } from '../models/jobs-model.mjs'

function jobLabel(job) {
  return job.name || job.id || 'job'
}

export function JobsPopover({ jobs }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!jobs?.length) return null

  const { live, settled, badge } = jobsForPopover(jobs)

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary text-muted-foreground"
        onClick={() => setOpen((value) => !value)}
        title="Jobs"
      >
        Jobs{badge > 0 ? ` · ${badge}` : ''}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-20 w-72 max-h-80 overflow-auto bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1 text-xs">
          {live.length > 0 && (
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Live
            </div>
          )}
          {live.map((job) => (
            <div key={job.id} className="px-3 py-1.5 flex items-center gap-2">
              <span className="text-amber-500">●</span>
              <span className="truncate flex-1">{jobLabel(job)}</span>
              <span className="text-muted-foreground">{job.status}</span>
            </div>
          ))}
          {settled.length > 0 && (
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Settled
            </div>
          )}
          {settled.map((job) => (
            <div key={job.id} className="px-3 py-1.5 flex items-center gap-2">
              <span className="text-muted-foreground">○</span>
              <span className="truncate flex-1">{jobLabel(job)}</span>
              <span className="text-muted-foreground">{job.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
