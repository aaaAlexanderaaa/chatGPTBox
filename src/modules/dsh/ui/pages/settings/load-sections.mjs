export function isSettingsNotExposed(error) {
  if (!error) return false
  if (error.code === 'settings-not-exposed') return true
  return String(error.message || '').includes('settings-not-exposed')
}

export function sectionNamespace(section) {
  return section?.namespace || section?.ns || ''
}

export function settingsTabForNamespace(ns) {
  const name = String(ns || '')
  if (!name) return null
  if (name.startsWith('llm')) return 'models'
  if (name === 'agent-default-model') return 'models'
  if (name === 'agent-presets') return 'presets'
  // Namespaces that only configure the official React client carry no meaning
  // inside the extension, and rc.8's describe serves every registered one.
  if (name === 'ui-onboarding' || name === 'sidebar' || name === 'settings') return null
  if (name === 'agent-loop' || name === 'bash' || name === 'shell' || name.includes('web-search')) {
    return 'plugins'
  }
  return 'general'
}

export function sectionsFromDescribeResult(result, error) {
  if (isSettingsNotExposed(error)) return []
  const raw =
    result?.namespaces ||
    result?.sections ||
    result?.items ||
    (sectionNamespace(result) ? [result] : [])
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const namespace = sectionNamespace(entry)
    if (!namespace || entry.namespace === namespace) return entry
    return { ...entry, namespace }
  })
}
