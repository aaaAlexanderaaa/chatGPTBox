import { RE2JS } from 're2js'

export const PASTE_LIMITS = Object.freeze({
  chars: 20000,
  matches: 200,
  rules: 100,
  patternChars: 512,
  replacementChars: 256,
  captures: 16,
  ruleProgram: 512,
  totalProgram: 16384,
  expandedChars: 20000,
  outputChars: 40000,
  softMs: 500,
})

export class PasteRuleError extends Error {
  constructor(message, ruleIndex) {
    super(message)
    this.ruleIndex = ruleIndex
  }
}

// Keep malformed imported configuration invalid. Reading never rewrites storage.
export function normalizePasteRules(rules = []) {
  if (!Array.isArray(rules) || rules.length > PASTE_LIMITS.rules)
    throw new PasteRuleError('Use up to 100 regex replacement rules.')
  const seenLegacy = new Set()
  return rules.flatMap((value, ruleIndex) => {
    if (typeof value === 'string') {
      if (!value.trim() || value.length > 120 || /[\r\n]/.test(value))
        throw new PasteRuleError('Invalid legacy term. Repair or remove this rule.', ruleIndex)
      const term = value.trim()
      if (seenLegacy.has(term)) return []
      seenLegacy.add(term)
      return [{ pattern: RE2JS.quote(term), flags: '', replacement: '[REDACTED]' }]
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ['pattern', 'flags', 'replacement'].some((key) => typeof value[key] !== 'string')
    )
      throw new PasteRuleError(
        'Invalid rule format. Each rule needs pattern, flags and replacement.',
        ruleIndex,
      )
    return [{ pattern: value.pattern, flags: value.flags, replacement: value.replacement }]
  })
}

function replacementTokens(template, expression, ruleIndex) {
  const tokens = []
  let literal = ''
  const fail = () => {
    throw new PasteRuleError(
      'Invalid replacement. Use $$, $&, $1–$99 or $<name> for declared groups only.',
      ruleIndex,
    )
  }
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '$') {
      literal += template[i]
      continue
    }
    const next = template[++i]
    if (next === '$') {
      literal += '$'
      continue
    }
    if (literal) tokens.push({ text: literal })
    literal = ''
    let group
    if (next === '&') group = 0
    else if (next && /[0-9]/.test(next)) {
      let number = next
      while (i + 1 < template.length && /[0-9]/.test(template[i + 1])) number += template[++i]
      if (!/^[1-9][0-9]?$/.test(number)) fail()
      group = Number(number)
      if (group > expression.groupCount()) fail()
    } else if (next === '<') {
      const end = template.indexOf('>', i + 1)
      if (end < 0) fail()
      const name = template.slice(i + 1, end)
      const names = expression.namedGroups()
      if (!Object.hasOwn(names, name)) fail()
      group = names[name]
      i = end
    } else fail()
    tokens.push({ group })
  }
  if (literal) tokens.push({ text: literal })
  return tokens
}

// The callback checks a soft wall-clock budget, not an interruptible engine deadline.
export function compilePasteRules(values, check = () => {}) {
  let program = 0
  return normalizePasteRules(values).map((rule, ruleIndex) => {
    check()
    if (!rule.pattern || rule.pattern.length > PASTE_LIMITS.patternChars)
      throw new PasteRuleError('Each pattern must contain 1–512 UTF-16 units.', ruleIndex)
    if (rule.replacement.length > PASTE_LIMITS.replacementChars)
      throw new PasteRuleError(
        'Each replacement template may contain at most 256 UTF-16 units.',
        ruleIndex,
      )
    if (!/^[gims]*$/.test(rule.flags) || new Set(rule.flags).size !== rule.flags.length)
      throw new PasteRuleError(
        'Flags may contain i, m and s once each; g is optional because matching is always global.',
        ruleIndex,
      )
    const flags = ['i', 'm', 's'].filter((flag) => rule.flags.includes(flag)).join('')
    let expression
    try {
      expression = RE2JS.compile(
        rule.pattern,
        (flags.includes('i') ? RE2JS.CASE_INSENSITIVE : 0) |
          (flags.includes('m') ? RE2JS.MULTILINE : 0) |
          (flags.includes('s') ? RE2JS.DOTALL : 0),
      )
    } catch {
      // Engine diagnostics may echo the configured pattern. Never publish them to the host page.
      throw new PasteRuleError('Unsupported or invalid RE2 regular expression.', ruleIndex)
    }
    check()
    program += expression.programSize()
    if (expression.programSize() > PASTE_LIMITS.ruleProgram || program > PASTE_LIMITS.totalProgram)
      throw new PasteRuleError(
        'Regex program is too large. Simplify this rule or use fewer rules.',
        ruleIndex,
      )
    if (expression.groupCount() > PASTE_LIMITS.captures)
      throw new PasteRuleError('Use at most 16 capture groups per rule.', ruleIndex)
    if (expression.matcher('').find())
      throw new PasteRuleError(
        'Zero-length matches are not supported. Require at least one character.',
        ruleIndex,
      )
    check()
    return {
      rule: { ...rule, flags },
      ruleIndex,
      expression,
      tokens: replacementTokens(rule.replacement, expression, ruleIndex),
    }
  })
}

export function validatePasteRules(values) {
  const started = performance.now()
  return compilePasteRules(values, () => {
    if (performance.now() - started > PASTE_LIMITS.softMs)
      throw new PasteRuleError(
        'Local check took too long. Simplify the rules or paste a smaller part.',
      )
  }).map(({ rule }) => rule)
}

export function expandPasteReplacement(tokens, matcher, ruleIndex) {
  const parts = []
  let length = 0
  for (const token of tokens) {
    const value = Object.hasOwn(token, 'text') ? token.text : matcher.group(token.group) ?? ''
    length += value.length
    if (length > PASTE_LIMITS.expandedChars)
      throw new PasteRuleError(
        'Replacement output is too large. Simplify the rules or paste a smaller part.',
        ruleIndex,
      )
    parts.push(value)
  }
  return parts.join('')
}
