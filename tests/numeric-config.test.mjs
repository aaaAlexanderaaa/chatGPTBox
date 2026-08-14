import { describe, expect, it } from 'vitest'

// Unit tests for the table-driven numeric config clamp (architecture plan
// step 6). Locks in the property the refactor was after: each numeric field
// is clamped according to a single table row, and adding a field means adding
// exactly one row to NUMERIC_FIELDS.

import {
  NUMERIC_FIELDS,
  clampNumericField,
  clampNumericConfig,
} from '../src/config/numeric-config.mjs'

// A defaultConfig representative of the real one, scoped to numeric keys.
const defaultConfig = {
  maxResponseTokenLength: 2000,
  maxConversationContextLength: 100,
  temperature: 1,
  apiServerRequestTimeoutSeconds: 120,
  apiServerThinkingTimeoutSeconds: 300,
  apiServerPort: 18080,
  chatgptWebConversationPollTimeoutSeconds: 600,
  chatgptWebConversationPollIntervalSeconds: 5,
  chatgptWebHistorySyncRpm: 6,
  chatgptWebHistorySyncIntervalHours: 12,
}

describe('NUMERIC_FIELDS table', () => {
  it('covers every numeric config field', () => {
    // If this set changes, the change is intentional and this test forces a
    // conscious edit — preventing a silent drop or addition.
    expect(NUMERIC_FIELDS.map((f) => f.key)).toEqual([
      'maxResponseTokenLength',
      'maxConversationContextLength',
      'temperature',
      'apiServerRequestTimeoutSeconds',
      'apiServerThinkingTimeoutSeconds',
      'apiServerPort',
      'chatgptWebConversationPollTimeoutSeconds',
      'chatgptWebConversationPollIntervalSeconds',
      'chatgptWebHistorySyncRpm',
      'chatgptWebHistorySyncIntervalHours',
    ])
  })

  it('every entry declares a kind, a min <= max, and a non-NaN bound', () => {
    for (const spec of NUMERIC_FIELDS) {
      expect(spec.kind === 'int' || spec.kind === 'float').toBe(true)
      expect(Number.isFinite(spec.min)).toBe(true)
      expect(Number.isFinite(spec.max)).toBe(true)
      expect(spec.min).toBeLessThanOrEqual(spec.max)
    }
  })
})

describe('clampNumericField', () => {
  it('clamps an int above the max down to the max', () => {
    const spec = { key: 'x', kind: 'int', min: 1, max: 10 }
    expect(clampNumericField(999, 5, spec)).toBe(10)
  })

  it('clamps an int below the min up to the min', () => {
    const spec = { key: 'x', kind: 'int', min: 1, max: 10 }
    expect(clampNumericField(0, 5, spec)).toBe(1)
  })

  it('falls back to the default for NaN / non-numeric input', () => {
    const spec = { key: 'x', kind: 'int', min: 1, max: 10 }
    expect(clampNumericField(NaN, 7, spec)).toBe(7)
    expect(clampNumericField('abc', 7, spec)).toBe(7)
    expect(clampNumericField(undefined, 7, spec)).toBe(7)
  })

  it('preserves fractional values for float kind', () => {
    const spec = { key: 'x', kind: 'float', min: 0, max: 2 }
    expect(clampNumericField(0.7, 1, spec)).toBeCloseTo(0.7)
  })
})

describe('clampNumericConfig', () => {
  it('returns clamped values for every field and needsFix=false when nothing changes', () => {
    const config = { ...defaultConfig }
    const { clampedValues, needsFix } = clampNumericConfig(config, defaultConfig)
    expect(Object.keys(clampedValues).sort()).toEqual([...Object.keys(defaultConfig)].sort())
    for (const key of Object.keys(defaultConfig)) {
      expect(clampedValues[key]).toBe(defaultConfig[key])
    }
    expect(needsFix).toBe(false)
  })

  it('flags needsFix and clamps when a value is out of range', () => {
    const config = { ...defaultConfig, maxResponseTokenLength: 999999999 }
    const { clampedValues, needsFix } = clampNumericConfig(config, defaultConfig)
    expect(needsFix).toBe(true)
    // max is 256000
    expect(clampedValues.maxResponseTokenLength).toBe(256000)
    // only the offending field is "changed"; others equal their input
    expect(clampedValues.temperature).toBe(config.temperature)
  })

  it('recovers a NaN-persisted value to the default and flags it for write-back', () => {
    const config = { ...defaultConfig, chatgptWebHistorySyncRpm: NaN }
    const { clampedValues, needsFix } = clampNumericConfig(config, defaultConfig)
    expect(needsFix).toBe(true)
    expect(clampedValues.chatgptWebHistorySyncRpm).toBe(defaultConfig.chatgptWebHistorySyncRpm)
  })

  it('flags multiple offending fields together (regression for the old 3-place edit hazard)', () => {
    const config = {
      ...defaultConfig,
      temperature: 99, // > 2
      apiServerPort: 0, // < 1
      chatgptWebHistorySyncRpm: 999,
    }
    const { clampedValues, needsFix } = clampNumericConfig(config, defaultConfig)
    expect(needsFix).toBe(true)
    expect(clampedValues.temperature).toBe(2)
    expect(clampedValues.apiServerPort).toBe(1)
    expect(clampedValues.chatgptWebHistorySyncRpm).toBe(30)
  })
})
