import { EngineError } from './contract.mjs'

// Small data-only schema subset used by descriptors and their native validators.
// It deliberately covers the shapes we publish rather than accepting arbitrary
// JSON Schema keywords that this runtime would silently fail to enforce.
export function validateEngineShape(value, schema, path = 'input') {
  if (schema.enum && !schema.enum.includes(value))
    throw new EngineError(
      'PARAMETER_UNSUPPORTED',
      `${path} must be one of: ${schema.enum.join(', ')}.`,
    )
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (schema.type && type !== schema.type)
    throw new EngineError('INPUT_UNSUPPORTED', `${path} must be ${schema.type}.`)
  if (
    typeof value === 'string' &&
    ((schema.minLength && value.trim().length < schema.minLength) ||
      (schema.maxLength && value.length > schema.maxLength))
  )
    throw new EngineError('INPUT_UNSUPPORTED', `${path} exceeds its supported text limits.`)
  if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems)
    throw new EngineError('INPUT_UNSUPPORTED', `${path} allows at most ${schema.maxItems} items.`)
  if (type === 'object') {
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key))
        throw new EngineError('INVALID_REQUEST', `${path}.${key} is required.`)
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key]
      if (child) validateEngineShape(item, child, `${path}.${key}`)
      else if (schema.additionalProperties === false)
        throw new EngineError('PARAMETER_UNSUPPORTED', `${path}.${key} is unsupported.`)
    }
  }
}
