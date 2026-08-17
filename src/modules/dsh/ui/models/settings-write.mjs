export function settingsMutatePayload({ namespace, ops, expectedRevision }) {
  return { namespace, ops, expectedRevision }
}

export function isSettingsConflict(error) {
  return error?.code === 'settings-conflict'
}
