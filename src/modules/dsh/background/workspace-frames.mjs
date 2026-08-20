const PULL_TYPES = new Set([
  'host/workspace-changed',
  'host/workspace-removed',
  'host/workspace-order-changed',
  'host/archived-sessions-changed',
])

export function shouldPullWorkspaces(type) {
  return PULL_TYPES.has(type)
}
