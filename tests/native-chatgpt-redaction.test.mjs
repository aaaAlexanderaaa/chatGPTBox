import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizePasteRules,
  validatePasteRules,
  PASTE_LIMITS,
} from '../src/native-chatgpt/paste-rules.mjs'
import { scanPaste, redactPaste } from '../src/native-chatgpt/redaction.mjs'
import { nativeChatgptConfig } from '../src/config/native-chatgpt.mjs'

const rule = (pattern, replacement = '[客户]', flags = '') => ({ pattern, flags, replacement })
const result = (text, rules) => {
  const scan = scanPaste(text, rules, 'test')
  expect(scan.complete, scan.reason).toBe(true)
  return { scan, output: redactPaste(text, scan.matches) }
}
afterEach(() => vi.restoreAllMocks())

describe('local regex replacement semantics', () => {
  it('matches Chinese variants and separators with real regex rules', () => {
    expect(result('示例甲公司、示例乙公司、示例丙公司', [rule('示例[甲乙]公司')]).output).toBe(
      '[客户]、[客户]、示例丙公司',
    )
    expect(
      result('客户-编号: 123 客户_编号：456', [rule('客户[-_ ]?编号[:：] ?[0-9]+', '[编号]')])
        .output,
    ).toBe('[编号] [编号]')
  })
  it('supports case, multiline and dotall flags and canonicalizes optional global flags', () => {
    expect(validatePasteRules([rule('^client:.+$', '[客户]', 'gmi')])[0].flags).toBe('im')
    expect(result('CLIENT:One\nclient:Two', [rule('^client:.+$', '[客户]', 'im')]).output).toBe(
      '[客户]\n[客户]',
    )
    expect(result('A\nB', [rule('A.B', '', 's')]).output).toBe('')
  })
  it('expands numbered/named/optional captures once and preserves intentional spaces', () => {
    expect(
      result('编号:123', [rule('(?<label>编号):([0-9]+)(后缀)?', ' $<label> [隐藏]$3 $$ $& ')])
        .output,
    ).toBe(' 编号 [隐藏] $ 编号:123 ')
    expect(result(' a ', [rule(' a ', ' ')]).output).toBe(' ')
    expect(result('$1', [rule('\\$1', '$$1')]).output).toBe('$1')
  })
  it('supports deletion and never cascades custom rules through replacement output', () => {
    expect(result('abc', [rule('b', '')]).output).toBe('ac')
    expect(result('a', [rule('a', 'b'), rule('b', 'c')]).output).toBe('b')
  })
  it('uses UTF-16 coordinates around emoji and Chinese text', () => {
    const { scan, output } = result('😀示例甲公司😀', [rule('示例[甲乙]公司')])
    expect(scan.matches[0]).toMatchObject({ start: 2, end: 7 })
    expect(output).toBe('😀[客户]😀')
  })
  it('explicitly uses normal non-overlapping global occurrences within one rule', () => {
    expect(result('ababa', [rule('aba', 'X')]).output).toBe('Xba')
    expect(result('aba aba', [rule('aba', 'X')]).output).toBe('X X')
  })
  it('upgrades legacy terms as escaped literals without rewriting input or interpreting metacharacters', () => {
    const terms = [' a+b ', 'a+b', '[客户]', '\\d+']
    const original = [...terms]
    const rules = validatePasteRules(terms)
    expect(rules).toHaveLength(3)
    expect(result('a+b aaab [客户] \\d+ 123', rules).output).toBe(
      '[REDACTED] aaab [REDACTED] [REDACTED] 123',
    )
    expect(terms).toEqual(original)
    const maxLegacy = Array.from({ length: 100 }, (_, i) => ('legacy-' + i).padEnd(120, 'x'))
    expect(validatePasteRules(maxLegacy)).toHaveLength(100)
  })
})

describe('overlap and secret protection', () => {
  it('lets one encompassing custom rule replace an email, while partial overlap masks the union', () => {
    expect(result('demo@example.com', [rule('(demo)@example\\.com', '$1@[域名]')]).output).toBe(
      'demo@[域名]',
    )
    const { scan, output } = result('demo@example.com', [rule('demo', 'D')])
    expect(scan.matches[0]).toMatchObject({ conflict: true, ruleIndexes: [0], start: 0, end: 16 })
    expect(output).toBe('[CUSTOM_test_1]')
  })
  it('masks a transitive conflict even when a broad later rule returns the original', () => {
    const { scan, output } = result('abcde', [
      rule('abc', 'A'),
      rule('cde', 'B'),
      rule('abcde', '$&'),
    ])
    expect(output).toBe('[CUSTOM_test_1]')
    expect(scan.matches[0]).toMatchObject({ conflict: true, ruleIndexes: [2, 0, 1] })
    expect(redactPaste('abcde', scan.matches, [])).toBe('abcde')
  })
  it('never releases source secrets through captures or review deselection', () => {
    const text = 'token sk-abcdefghijklmnopqrstuv end'
    const { scan, output } = result(text, [rule('token (sk-[a-z]+) end', '$1')])
    expect(output).toBe('[SECRET REMOVED]')
    expect(scan.matches[0].locked).toBe(true)
    expect(redactPaste(text, scan.matches, [])).toBe('[SECRET REMOVED]')
  })
  it('rejects known secrets created by fixed replacement or concatenation', () => {
    const key = 'sk-' + 'x'.repeat(20)
    for (const [text, rules] of [
      ['X', [rule('X', key)]],
      ['@@' + 'x'.repeat(20), [rule('@@', 'sk-')]],
    ]) {
      const scan = scanPaste(text, rules)
      expect(scan.complete).toBe(true)
      expect(() => redactPaste(text, scan.matches)).toThrow('candidate contains a known key')
    }
  })
  it('audits every actual selection, including omitting a shrinking rule', () => {
    const text = '@@' + 'x'.repeat(20)
    const scan = scanPaste(text, [rule('@@', 'sk-'), rule('x+', '')])
    expect(redactPaste(text, scan.matches)).toBe('sk-')
    expect(() => redactPaste(text, scan.matches, [0])).toThrow('candidate contains a known key')
  })
})

describe('invalid or exhausting policies stay incomplete', () => {
  it.each(['[', '(?=x)x', '(?<=x)y', '(x)\\1'])('rejects unsupported expression %s', (pattern) => {
    expect(() => validatePasteRules([rule(pattern)])).toThrow('RE2')
    expect(scanPaste('safe', [rule(pattern)]).complete).toBe(false)
  })
  it.each(['$0', '$00', '$01', '$100', '$2', '$12', '$<missing>', '$<', '$', '$q', "$'", '$`'])(
    'rejects ambiguous or unknown template %s',
    (replacement) => {
      expect(() => validatePasteRules([rule('(a)', replacement)])).toThrow('Invalid replacement')
    },
  )
  it.each(['ii', 'u', 'y', 'd', 'x', 'gmiig'])('rejects flags %s', (flags) => {
    expect(scanPaste('safe', [rule('x', 'X', flags)]).complete).toBe(false)
  })
  it('fails empty matches both at save and when a boundary-only match depends on input', () => {
    expect(() => validatePasteRules([rule('a*')])).toThrow('Zero-length')
    expect(validatePasteRules([rule('\\b')])).toHaveLength(1)
    expect(scanPaste('word', [rule('\\b')])).toMatchObject({
      complete: false,
      ruleIndex: 0,
      reason: expect.stringContaining('Zero-length'),
    })
  })
  it.each([null, 'broken', {}, [null], [{ pattern: 'x' }]])(
    'preserves malformed imports for failure, including %j',
    (value) => {
      const config = nativeChatgptConfig({ chatgptNativePasteTerms: value })
      expect(config.chatgptNativePasteTerms).toBe(value)
      expect(scanPaste('ordinary text', config.chatgptNativePasteTerms).complete).toBe(false)
      expect(() => normalizePasteRules(value)).toThrow()
    },
  )
  it('enforces count, UTF-16 template/pattern length, capture and compiled-program limits', () => {
    for (const rules of [
      Array(101).fill(rule('x')),
      [rule('x'.repeat(513))],
      [rule('x', 'x'.repeat(257))],
      [rule('(a)'.repeat(17))],
      [rule('a{1000}')],
      Array(34).fill(rule('a{500}')),
      [rule('(?:a{1000}){1000}')],
    ])
      expect(scanPaste('ordinary', rules).complete).toBe(false)
  })
  it('counts raw findings before overlap merge', () => {
    expect(scanPaste('a a a', Array(100).fill(rule('a')))).toMatchObject({
      complete: false,
      reason: expect.stringContaining('Too many'),
    })
  })
  it('bounds expanded replacements before joining and bounds all possible selection outputs', () => {
    expect(scanPaste('a'.repeat(19999), [rule('(a+)', '$1$1')])).toMatchObject({
      complete: false,
      reason: expect.stringContaining('output is too large'),
    })
    expect(
      scanPaste('a'.repeat(100) + 'b'.repeat(19900), [rule('a', 'x'.repeat(256)), rule('b+', '')]),
    ).toMatchObject({ complete: false, reason: expect.stringContaining('output is too large') })
  })
  it('fails when the soft time budget is exhausted instead of claiming no matches', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(PASTE_LIMITS.softMs + 1)
    expect(scanPaste('safe', [rule('x')])).toMatchObject({
      complete: false,
      reason: expect.stringContaining('took too long'),
    })
  })
  it('runs backtracking-shaped negative patterns through the bounded RE2 engine', () => {
    const start = performance.now()
    const scan = scanPaste('a'.repeat(19999) + '!', [rule('(a+)+$'), rule('(?:a|aa)+$')])
    expect(scan).toEqual({ complete: true, matches: [] })
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
