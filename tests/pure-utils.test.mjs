import { describe, expect, it } from 'vitest'
import { parseIntWithClamp } from '../src/utils/parse-int-with-clamp.mjs'
import {
  clampTokenBudget,
  estimateTokenCount,
  truncateToTokenBudget,
} from '../src/utils/token-budget.mjs'

describe('parseIntWithClamp', () => {
  it('returns the parsed integer when in range', () => {
    expect(parseIntWithClamp('42', 0, 0, 100)).toBe(42)
  })

  it('clamps to max when above range', () => {
    expect(parseIntWithClamp('500', 0, 0, 100)).toBe(100)
  })

  it('clamps to min when below range', () => {
    expect(parseIntWithClamp('-5', 0, 0, 100)).toBe(0)
  })

  it('falls back to defaultValue when input is not parseable', () => {
    expect(parseIntWithClamp('not-a-number', 7, 0, 100)).toBe(7)
  })
})

describe('estimateTokenCount', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokenCount('')).toBe(0)
    expect(estimateTokenCount(null)).toBe(0)
    expect(estimateTokenCount(undefined)).toBe(0)
  })

  it('estimates tokens at the default 4 chars/token rate', () => {
    expect(estimateTokenCount('abcdefgh')).toBe(2)
  })

  it('honors a custom charsPerToken setting', () => {
    expect(estimateTokenCount('abcdefgh', { charsPerToken: 2 })).toBe(4)
  })

  it('returns at least 1 for any non-empty string', () => {
    expect(estimateTokenCount('a')).toBe(1)
  })
})

describe('truncateToTokenBudget', () => {
  it('returns the original text when under the budget', () => {
    expect(truncateToTokenBudget('hello', 10)).toBe('hello')
  })

  it('truncates with a suffix when over the budget', () => {
    const long = 'x'.repeat(100)
    const result = truncateToTokenBudget(long, 5)
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result.endsWith('[truncated]')).toBe(true)
  })

  it('returns an empty string when the budget is 0', () => {
    expect(truncateToTokenBudget('hello', 0)).toBe('')
  })
})

describe('clampTokenBudget', () => {
  it('clamps within [min, max]', () => {
    expect(clampTokenBudget(50, 0, 100, 0)).toBe(50)
    expect(clampTokenBudget(500, 0, 100, 0)).toBe(100)
    expect(clampTokenBudget(-10, 0, 100, 0)).toBe(0)
  })

  it('falls back when input is not a finite number', () => {
    expect(clampTokenBudget('not-a-number', 0, 100, 42)).toBe(42)
    expect(clampTokenBudget(NaN, 0, 100, 42)).toBe(42)
  })

  it('floors fractional values', () => {
    expect(clampTokenBudget(50.9, 0, 100, 0)).toBe(50)
  })
})
