export function fieldsFromDescribe(section) {
  const properties = section?.schema?.properties || section?.schema?.dict
  if (!properties || typeof properties !== 'object') return []
  const secrets = new Set(section.secrets || [])
  return Object.entries(properties).map(([path, spec]) => ({
    path,
    type: spec?.type || 'string',
    title: spec?.title || path,
    secret: secrets.has(path),
  }))
}
