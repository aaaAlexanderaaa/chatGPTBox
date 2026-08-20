/** Unwrap host.pickDirectory. Live value is `{ path: string | null }`; null is cancel. */
export function pickedDirectoryPath(result) {
  if (result == null) return null
  if (typeof result === 'string') {
    const path = result.trim()
    return path || null
  }
  if (typeof result !== 'object' || typeof result.path !== 'string') return null
  const path = result.path.trim()
  return path || null
}
