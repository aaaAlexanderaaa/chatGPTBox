export function settingsMutatePayload({ namespace, ops, expectedRevision }) {
  return { namespace, ops, expectedRevision }
}

export function isSettingsConflict(error) {
  if (error?.code === 'settings-conflict') return true
  if (typeof error?.message === 'string' && error.message.includes('settings-conflict')) {
    return true
  }
  return false
}
