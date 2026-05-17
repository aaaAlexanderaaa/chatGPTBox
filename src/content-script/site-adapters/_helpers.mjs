export function logAdapterError(adapterName, error) {
  // Site adapters run on third-party pages and fail often when sites change their DOM.
  // Route failures to debug so production consoles stay quiet but breadcrumbs remain.
  console.debug(`[site-adapter:${adapterName}]`, error)
}

export function safeAdapter(adapterName, fn) {
  return async function safeAdapterWrapped(...args) {
    try {
      return await fn(...args)
    } catch (error) {
      logAdapterError(adapterName, error)
    }
  }
}
