export function isSettingsNotExposed(error) {
  if (!error) return false
  if (error.code === 'settings-not-exposed') return true
  return String(error.message || '').includes('settings-not-exposed')
}

export function sectionsFromDescribeResult(result, error) {
  if (isSettingsNotExposed(error)) return []
  return result?.sections || result?.items || (result?.namespace ? [result] : [])
}
