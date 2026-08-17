export function sectionsFromDescribeResult(result, error) {
  if (error?.code === 'settings-not-exposed') return []
  if (String(error?.message || '').includes('settings-not-exposed')) return []
  return result?.sections || result?.items || (result?.namespace ? [result] : [])
}
