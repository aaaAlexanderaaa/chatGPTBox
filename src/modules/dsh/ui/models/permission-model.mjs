export function permissionOptions(projection) {
  const ids = projection?.presets || projection?.options || []
  return ids.map((id) => ({
    id,
    label: String(id)
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    danger: id === 'danger-full-access' || id === 'full-access',
  }))
}

export function planChipVisible(plan) {
  if (!plan) return false
  return (plan.pending ? !plan.active : plan.active) === true
}
