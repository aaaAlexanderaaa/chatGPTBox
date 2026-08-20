function resolveNode(envelope, node, depth = 0) {
  if (node == null || depth > 12) return null
  if (typeof node === 'number' || (typeof node === 'string' && envelope?.refs?.[node])) {
    return resolveNode(envelope, envelope.refs[String(node)], depth + 1)
  }
  if (typeof node !== 'object') return null
  if (node.$ref != null) return resolveNode(envelope, node.$ref, depth + 1)
  return node
}

function schemaRoot(schema) {
  if (!schema || typeof schema !== 'object') return { envelope: null, node: null }
  if (schema.refs && schema.uid != null) {
    return { envelope: schema, node: resolveNode(schema, schema.uid) }
  }
  return { envelope: { refs: schema.refs || {} }, node: schema }
}

function unionOptions(envelope, node) {
  if (!node) return []
  if (typeof node.value === 'string' && (node.type === 'const' || node.type == null)) {
    return [node.value]
  }
  if (Array.isArray(node.enum)) return node.enum.filter((value) => typeof value === 'string')
  if (!Array.isArray(node.list)) return []
  const options = []
  for (const entry of node.list) {
    options.push(...unionOptions(envelope, resolveNode(envelope, entry)))
  }
  return options
}

function fieldType(envelope, spec) {
  const node = resolveNode(envelope, spec) || spec
  if (!node) return { type: 'string' }
  if (node.type === 'boolean') return { type: 'boolean' }
  if (node.type === 'number' || node.type === 'integer') return { type: 'number' }
  if (node.type === 'union' || node.type === 'const') {
    const options = unionOptions(envelope, node)
    if (options.length > 0) return { type: 'select', options }
  }
  return { type: 'string' }
}

function isNestedContainer(envelope, spec) {
  const node = resolveNode(envelope, spec) || spec
  return node?.type === 'object' || node?.type === 'dict' || node?.type === 'array'
}

function secretSet(secrets) {
  const set = new Set()
  if (!Array.isArray(secrets)) return set
  for (const entry of secrets) {
    if (typeof entry === 'string') set.add(entry)
    else if (Array.isArray(entry?.path)) set.add(entry.path.join('.'))
    else if (typeof entry?.path === 'string') set.add(entry.path)
  }
  return set
}

export function fieldHelp(path) {
  if (!/baseurl|base_url|endpoint/i.test(String(path))) return null
  return {
    placeholder: 'https://api.deepseek.com',
    description:
      'Official DeepSeek: https://api.deepseek.com (no /v1). OpenAI-compatible gateways: origin + /v1. Do not append /chat/completions or /responses — pick the API protocol separately.',
  }
}

export function fieldsFromDescribe(section) {
  const schema = section?.schema
  const { envelope, node } = schemaRoot(schema)
  const properties = node?.dict || node?.properties || schema?.properties || schema?.dict
  if (!properties || typeof properties !== 'object') return []
  const secrets = secretSet(section.secrets)
  const fields = []
  for (const [path, spec] of Object.entries(properties)) {
    if (isNestedContainer(envelope, spec)) continue
    const resolved = resolveNode(envelope, spec) || spec || {}
    const typed = fieldType(envelope, resolved)
    const field = {
      path,
      type: typed.type,
      title: resolved.meta?.label || resolved.title || path,
      secret: secrets.has(path),
    }
    if (typed.options) field.options = typed.options
    const description = resolved.meta?.description
    if (description) field.description = description
    fields.push(field)
  }
  return fields
}
