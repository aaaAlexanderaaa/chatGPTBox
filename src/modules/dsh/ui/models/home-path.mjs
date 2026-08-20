/**
 * Collapse the host home-directory prefix of an absolute path to `~`.
 * `home` arrives from host.describe (rc.8+); older hosts omit it and paths
 * render unchanged. Only a full segment boundary qualifies — `/Users/alex`
 * must not swallow `/Users/alexander`.
 */
export function abbreviateHome(path, home) {
  if (typeof path !== 'string' || path.length === 0) return path
  if (typeof home !== 'string' || home.length === 0) return path
  const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home
  if (normalizedHome.length === 0) return path
  if (path === normalizedHome) return '~'
  if (path.startsWith(`${normalizedHome}/`)) return `~${path.slice(normalizedHome.length)}`
  return path
}
