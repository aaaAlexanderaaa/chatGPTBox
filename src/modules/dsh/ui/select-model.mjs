/** RPC payload for session.selectModel — the option's provider, not the current one. */
export function selectModelArgs(sessionId, model, fallbackProvider) {
  return {
    sessionId,
    provider: model?.provider || fallbackProvider,
    model: model?.id,
  }
}

export function modelsFromCatalog(catalog) {
  return (catalog?.groups || []).flatMap((group) =>
    (group.models || []).map((model) => ({
      ...model,
      groupName: group.name,
      provider: model.provider || group.provider || group.id,
    })),
  )
}

export function modelChipLabel(catalog, pending) {
  if (pending?.provider && pending?.id) return `${pending.provider}/${pending.id}`
  if (catalog?.current?.provider && catalog?.current?.model) {
    return `${catalog.current.provider}/${catalog.current.model}`
  }
  return 'model'
}
