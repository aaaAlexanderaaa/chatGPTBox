import { useEffect, useMemo, useState } from 'preact/hooks'
import { fieldsFromDescribe } from '../../models/schema-fields.mjs'

export function SchemaForm({ section, values = {}, onSubmit }) {
  const fields = useMemo(() => fieldsFromDescribe(section), [section])
  const [draft, setDraft] = useState(() => ({ ...values }))
  const [touchedSecrets, setTouchedSecrets] = useState(() => new Set())

  useEffect(() => {
    setDraft({ ...values })
    setTouchedSecrets(new Set())
  }, [values, section?.revision])

  const setField = (path, value, secret) => {
    setDraft((prev) => ({ ...prev, [path]: value }))
    if (secret) {
      setTouchedSecrets((prev) => {
        const next = new Set(prev)
        next.add(path)
        return next
      })
    }
  }

  const submit = (event) => {
    event.preventDefault()
    const ops = fields
      .filter((field) => {
        if (field.secret) return touchedSecrets.has(field.path) && draft[field.path] !== ''
        return draft[field.path] !== values[field.path]
      })
      .map((field) => ({ kind: 'set', path: field.path, value: draft[field.path] }))
    onSubmit?.({ ops, expectedRevision: section.revision })
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      {section?.namespace && (
        <h3 className="text-sm font-medium">{section.title || section.namespace}</h3>
      )}
      {fields.map((field) => (
        <label key={field.path} className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{field.title}</span>
          {field.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={Boolean(draft[field.path])}
              onChange={(event) => setField(field.path, event.target.checked, field.secret)}
            />
          ) : (
            <input
              type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
              className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
              value={draft[field.path] ?? ''}
              placeholder={field.secret ? '••••••••' : ''}
              onInput={(event) => setField(field.path, event.target.value, field.secret)}
            />
          )}
        </label>
      ))}
      <button
        type="submit"
        className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
      >
        Save
      </button>
    </form>
  )
}
