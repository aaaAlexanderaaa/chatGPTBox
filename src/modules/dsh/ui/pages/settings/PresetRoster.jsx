import { useCallback, useEffect, useState } from 'preact/hooks'
import { presetLabel } from '../../models/preset-model.mjs'

export function PresetRoster({ rpc }) {
  const [list, setList] = useState({ presets: [], hasDocument: true })
  const [copyFrom, setCopyFrom] = useState('')
  const [copyId, setCopyId] = useState('')
  const [copyName, setCopyName] = useState('')
  const [pathHints, setPathHints] = useState({})
  const [readPreview, setReadPreview] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const next = await rpc('agentPreset.list')
      setList(next || { presets: [] })
      setError(null)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }, [rpc])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (list.hasDocument !== false) return
    let cancelled = false
    ;(async () => {
      const hints = {}
      for (const preset of list.presets || []) {
        try {
          const result = await rpc('agentPreset.openDocument', { agentPreset: preset.id })
          if (result?.opened === false && result.path) hints[preset.id] = result.path
        } catch {
          // leave unset
        }
      }
      if (!cancelled) setPathHints(hints)
    })()
    return () => {
      cancelled = true
    }
  }, [list, rpc])

  const onCopy = async (event) => {
    event.preventDefault()
    if (!copyFrom || !copyId) return
    const payload = { from: copyFrom, agentPreset: copyId }
    if (copyName) payload.name = copyName
    try {
      await rpc('agentPreset.copy', payload)
      setCopyId('')
      setCopyName('')
      setError(null)
      await reload()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  const onOpen = async (agentPreset) => {
    try {
      const result = await rpc('agentPreset.openDocument', { agentPreset })
      if (result?.opened === false) {
        setPathHints((prev) => ({ ...prev, [agentPreset]: result.path }))
      }
      setError(null)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  const onRead = async (agentPreset) => {
    try {
      const value = await rpc('agentPreset.read', { agentPreset })
      setReadPreview({ agentPreset, value })
      setError(null)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  const onRemove = async (agentPreset) => {
    try {
      await rpc('agentPreset.remove', { agentPreset })
      setError(null)
      await reload()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  const presets = list.presets || []
  const hasDocument = list.hasDocument !== false

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-500">{error}</p>}
      <ul className="space-y-3">
        {presets.map((preset) => {
          const system = preset.trust === 'system'
          return (
            <li key={preset.id} className="border border-border rounded-md p-3 space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{presetLabel(preset)}</span>
                <span className="text-[11px] text-muted-foreground font-mono">{preset.id}</span>
                {preset.broken != null && preset.broken !== false && (
                  <span className="text-[11px] text-red-500">broken</span>
                )}
              </div>
              {preset.description && (
                <p className="text-xs text-muted-foreground">{preset.description}</p>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                {system && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary"
                    onClick={() => void onRead(preset.id)}
                  >
                    Read
                  </button>
                )}
                {hasDocument ? (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary"
                    onClick={() => void onOpen(preset.id)}
                  >
                    Open
                  </button>
                ) : (
                  pathHints[preset.id] && (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {pathHints[preset.id]}
                    </span>
                  )
                )}
                {!system && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary text-red-500"
                    onClick={() => void onRemove(preset.id)}
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary"
                  onClick={() => setCopyFrom(preset.id)}
                >
                  Copy from
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <form
        className="space-y-2 border border-border rounded-md p-3"
        onSubmit={(e) => void onCopy(e)}
      >
        <h3 className="text-sm font-medium">Copy preset</h3>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">From</span>
          <select
            className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
            value={copyFrom}
            onChange={(event) => setCopyFrom(event.target.value)}
          >
            <option value="">Select source…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {presetLabel(preset)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">New id</span>
          <input
            className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
            value={copyId}
            onInput={(event) => setCopyId(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name (optional)</span>
          <input
            className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
            value={copyName}
            onInput={(event) => setCopyName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
        >
          Copy
        </button>
      </form>

      {readPreview && (
        <pre className="text-[11px] bg-secondary rounded-md p-3 overflow-auto max-h-64">
          {typeof readPreview.value === 'string'
            ? readPreview.value
            : JSON.stringify(readPreview.value, null, 2)}
        </pre>
      )}
    </div>
  )
}
