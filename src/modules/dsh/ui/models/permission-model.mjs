export function permissionOptions(projection) {
  const ids = projection?.presets || projection?.options || []
  return ids.map((entry) => {
    if (entry && typeof entry === 'object') {
      const id = entry.value ?? entry.id
      return {
        id,
        label: entry.name ?? entry.label ?? String(id),
        danger: id === 'danger-full-access' || id === 'full-access',
      }
    }
    const id = entry
    return {
      id,
      label: String(id)
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      danger: id === 'danger-full-access' || id === 'full-access',
    }
  })
}

export function planChipVisible(plan) {
  if (!plan) return false
  return (plan.pending ? !plan.active : plan.active) === true
}
