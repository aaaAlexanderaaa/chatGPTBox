import { useEffect, useRef, useState } from 'preact/hooks'
import { permissionOptions } from '../models/permission-model.mjs'

export function PermissionSelect({ projection, onPick }) {
  const rows = permissionOptions(projection)
  const [pendingDanger, setPendingDanger] = useState(null)
  const [understood, setUnderstood] = useState(false)
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (pendingDanger) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [pendingDanger])

  if (rows.length === 0) return null

  const closeDanger = () => {
    setPendingDanger(null)
    setUnderstood(false)
  }

  const confirmDanger = () => {
    if (!pendingDanger || !understood) return
    const id = pendingDanger
    closeDanger()
    onPick?.(id)
  }

  return (
    <span className="dsh-permission relative">
      <select
        className="text-xs bg-transparent border border-border rounded-md px-1.5 py-1 mb-1.5 max-w-[10rem]"
        value=""
        onChange={(event) => {
          const id = event.target.value
          event.target.value = ''
          if (!id) return
          const row = rows.find((r) => r.id === id)
          if (row?.danger) {
            setUnderstood(false)
            setPendingDanger(id)
            return
          }
          onPick?.(id)
        }}
        title="Permission mode"
      >
        <option value="" disabled>
          Permission
        </option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
      </select>
      <dialog
        ref={dialogRef}
        className="rounded-md border border-border bg-card p-4 text-sm shadow-lg"
        onCancel={(event) => {
          event.preventDefault()
          closeDanger()
        }}
      >
        <p className="mb-3">
          Enable full access? This can run destructive tools without further prompts.
        </p>
        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          I understand
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
            onClick={closeDanger}
          >
            Cancel
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-40"
            disabled={!understood}
            onClick={confirmDanger}
          >
            Confirm
          </button>
        </div>
      </dialog>
    </span>
  )
}
