// Table-driven numeric config clamping (architecture plan step 6).
//
// getUserConfig() previously hand-wrote ~90 lines clamping 14 numeric fields,
// with EACH field registered in THREE places: the clamp call, the needsFix
// comparison, and the write-back. Adding a numeric field meant editing all
// three and forgetting one silently broke validation.
//
// This module replaces that with a single NUMERIC_FIELDS table. Each entry
// declares { key, kind, min, max }. The default value comes from defaultConfig
// (passed in), so this file stays free of a config import. clampNumericConfig()
// walks the table once to compute the clamped values, returns them + whether
// anything changed + the partial object to persist.
//
// Pure and dependency-free (the clamp helpers are inlined) so it unit-tests
// trivially without a browser.

import { parseIntWithClamp } from '../utils/parse-int-with-clamp.mjs'
import { parseFloatWithClamp } from '../utils/parse-float-with-clamp.mjs'

/**
 * @typedef {'int'|'float'} NumericKind
 */

/**
 * @typedef {object} NumericFieldSpec
 * @property {string} key         The config field name.
 * @property {NumericKind} kind   'int' or 'float' — picks the clamp helper.
 * @property {number} min         Inclusive lower bound.
 * @property {number} max         Inclusive upper bound.
 */

// LIMITS are passed as explicit values (not imported from limits.mjs) so the
// table is self-describing and avoids a circular dependency on config/storage.
// limits.mjs is the canonical home for these constants; storage.mjs forwards
// them in when calling clampNumericConfig.
export const NUMERIC_FIELDS = /** @type {NumericFieldSpec[]} */ ([
  { key: 'maxResponseTokenLength', kind: 'int', min: 100, max: 256000 },
  { key: 'maxConversationContextLength', kind: 'int', min: 0, max: 200 },
  { key: 'temperature', kind: 'float', min: 0, max: 2 },
  { key: 'apiServerRequestTimeoutSeconds', kind: 'int', min: 30, max: 3600 },
  { key: 'apiServerThinkingTimeoutSeconds', kind: 'int', min: 30, max: 7200 },
  { key: 'apiServerPort', kind: 'int', min: 1, max: 65535 },
  { key: 'chatgptWebConversationPollTimeoutSeconds', kind: 'int', min: 30, max: 7200 },
  { key: 'chatgptWebConversationPollIntervalSeconds', kind: 'int', min: 1, max: 300 },
  { key: 'chatgptWebHistorySyncRpm', kind: 'int', min: 1, max: 30 },
  { key: 'chatgptWebHistorySyncIntervalHours', kind: 'int', min: 1, max: 168 },
])

/**
 * Clamp a single field using its spec and the default fallback.
 *
 * @param {unknown} current
 * @param {number} fallback
 * @param {NumericFieldSpec} spec
 * @returns {number}
 */
export function clampNumericField(current, fallback, spec) {
  const args = [current, fallback, spec.min, spec.max]
  return spec.kind === 'float' ? parseFloatWithClamp(...args) : parseIntWithClamp(...args)
}

/**
 * Walk the NUMERIC_FIELDS table and clamp each field on `config` against its
 * default. Returns the clamped values, whether anything changed, and the
 * partial object to persist (only fields that changed).
 *
 * @param {object} config          The merged config (will be mutated in place by the caller via the returned clampedValues).
 * @param {object} defaultConfig   Source of defaults (keyed the same as NUMERIC_FIELDS).
 * @returns {{ clampedValues: Record<string, number>, needsFix: boolean }}
 */
export function clampNumericConfig(config, defaultConfig) {
  /** @type {Record<string, number>} */
  const clampedValues = {}
  let needsFix = false
  for (const spec of NUMERIC_FIELDS) {
    const fallback = defaultConfig[spec.key]
    const clamped = clampNumericField(config[spec.key], fallback, spec)
    clampedValues[spec.key] = clamped
    if (clamped !== config[spec.key]) needsFix = true
  }
  return { clampedValues, needsFix }
}
