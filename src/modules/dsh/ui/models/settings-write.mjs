function pathParts(path) {
  if (Array.isArray(path)) return path.filter((part) => typeof part === 'string')
  if (typeof path === 'string' && path.length > 0) return path.split('.')
  return []
}

export function settingsMutatePayload({ namespace, ns, ops = [], expectedRevision }) {
  return {
    ns: ns || namespace,
    ops: ops.map((entry) => {
      const kind = entry.op || entry.kind
      const path = pathParts(entry.path)
      if (kind === 'unset') return { op: 'unset', path }
      return { op: 'set', path, value: entry.value }
    }),
    expectedRevision,
  }
}

function coerceDraftValue(field, value) {
  if (field.type === 'boolean') return Boolean(value)
  if (field.type === 'number' && value !== '' && value != null) return Number(value)
  return value
}

/**
 * Build mutate ops from a form draft. An empty draft on a non-boolean field
 * means "back to the host default" — that is an unset of the override, never
 * a persisted empty string (a '' would fail number schemas and shadow the
 * host default for selects). Secret rows write only once touched and
 * non-empty.
 */
export function settingsDraftOps({ fields = [], draft = {}, values = {}, touchedSecrets } = {}) {
  return fields
    .filter((field) => {
      if (field.secret) return touchedSecrets?.has(field.path) === true && draft[field.path] !== ''
      return draft[field.path] !== values[field.path]
    })
    .map((field) => {
      const raw = draft[field.path]
      if (field.type !== 'boolean' && (raw === '' || raw == null)) {
        return { kind: 'unset', path: field.path }
      }
      return { kind: 'set', path: field.path, value: coerceDraftValue(field, raw) }
    })
}

export function isSettingsConflict(error) {
  if (error?.code === 'settings-conflict') return true
  if (typeof error?.message === 'string' && error.message.includes('settings-conflict')) {
    return true
  }
  return false
}
