import { WEB_ENGINE_DEFINITIONS, engineIsEnabled } from './catalog.mjs'
import { EngineError, EngineOperation as Op } from './contract.mjs'

export const ENGINE_EXPOSURE_VERSION = 1
const GENERATION_GRANTS = [Op.Generate, Op.Append]

export function defaultEngineExposure() {
  return { externalEnabled: false, operations: [...GENERATION_GRANTS] }
}

export function normalizeEngineExposure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultEngineExposure()
  return {
    externalEnabled: value.externalEnabled === true,
    operations: Array.isArray(value.operations)
      ? [...new Set(value.operations.filter((item) => typeof item === 'string'))]
      : [],
  }
}

// Called once by the serialized background owner, never as a side effect of a
// settings read. Runtime readiness must not change a user's authorization.
export function migrateEngineExposure(config, definitions = WEB_ENGINE_DEFINITIONS) {
  const current = config.engineExposureVersion === ENGINE_EXPOSURE_VERSION
  const previous =
    config.engineExposure &&
    typeof config.engineExposure === 'object' &&
    !Array.isArray(config.engineExposure)
      ? config.engineExposure
      : {}
  const exposure = {}
  for (const definition of definitions) {
    if (current || Object.hasOwn(previous, definition.id)) {
      exposure[definition.id] = normalizeEngineExposure(previous[definition.id])
      continue
    }
    const wasExternal = config.apiServerEnabled === true && engineIsEnabled(config, definition)
    exposure[definition.id] = {
      externalEnabled: wasExternal,
      operations: wasExternal
        ? [...(definition.legacyExternalOperations || GENERATION_GRANTS)]
        : [...GENERATION_GRANTS],
    }
  }
  return { engineExposureVersion: ENGINE_EXPOSURE_VERSION, engineExposure: exposure }
}

export function assertEngineAdmission(config, definition, operation, caller) {
  if (!caller || !['extension', 'api', 'mcp'].includes(caller.kind) || !caller.principal)
    throw new EngineError('OPERATION_NOT_EXPOSED', 'An authenticated engine caller is required.')
  if (!engineIsEnabled(config, definition))
    throw new EngineError(
      'ENGINE_DISABLED',
      `${definition.label} is disabled. Enable it in Settings → Engines.`,
    )
  if (caller.kind === 'extension') return
  if (
    definition.extensionOperations?.includes(operation) &&
    !definition.externalExtensionOperations?.includes(operation)
  )
    throw new EngineError(
      'OPERATION_NOT_EXPOSED',
      'This resource operation is internal to the extension.',
    )
  const exposure = normalizeEngineExposure(config.engineExposure?.[definition.id])
  if (!exposure.externalEnabled)
    throw new EngineError(
      'EXTERNAL_ACCESS_DISABLED',
      `External access to ${definition.label} is disabled. Enable it in Settings → Engines.`,
    )
  if (!exposure.operations.includes(operation))
    throw new EngineError(
      'OPERATION_NOT_EXPOSED',
      `${operation} is not exposed for ${definition.label}.`,
    )
}

export function assertRunAccess(record, caller) {
  if (
    !caller?.principal ||
    !['extension', 'api', 'mcp'].includes(caller.kind) ||
    (!(caller.kind === 'extension' && caller.admin === true) &&
      record.principal !== caller.principal)
  )
    throw new EngineError(
      'OPERATION_NOT_EXPOSED',
      'This execution belongs to a different authenticated caller.',
    )
}

export function effectiveEngineOperations(config, definition, caller) {
  return [
    ...Object.entries(definition.operations || {})
      .filter(([, capability]) => capability.implemented)
      .map(([name]) => name),
    ...(definition.extensionOperations || []),
  ].filter((operation) => {
    if ([Op.ReadRun, Op.RecoverRun, Op.CancelRun].includes(operation)) return false // inherited from a specific owned run
    try {
      assertEngineAdmission(config, definition, operation, caller)
      return true
    } catch {
      return false
    }
  })
}
