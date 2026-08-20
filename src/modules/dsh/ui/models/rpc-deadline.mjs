export function rpcDeadlineMs(method) {
  if (method === 'host.pickDirectory' || method === 'command.execute') return 0
  return 30_000
}
