import {
  PASTE_LIMITS,
  PasteRuleError,
  compilePasteRules,
  expandPasteReplacement,
} from './paste-rules.mjs'
export { PASTE_LIMITS } from './paste-rules.mjs'

export const REDACTION_KINDS = Object.freeze({
  secret: 'API key or bearer token',
  email: 'Email',
  phone: 'Mainland China phone candidate',
  custom: 'Custom regex rule',
})

const secretPattern = () =>
  /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer[ \t]+[A-Za-z0-9._~+/=-]{16,})/g

export function scanPaste(text, rules = [], namespace = 'local') {
  if (typeof text !== 'string' || text.length > PASTE_LIMITS.chars)
    return {
      complete: false,
      reason: 'Paste is too long. Split it into parts of at most 20000 characters.',
    }
  if (!/^[a-z0-9-]{1,40}$/i.test(namespace))
    return { complete: false, reason: 'The local check could not start. Paste again.' }
  const started = performance.now()
  const check = () => {
    if (performance.now() - started > PASTE_LIMITS.softMs)
      throw new PasteRuleError(
        'Local check took too long. Simplify the rules or paste a smaller part.',
      )
  }
  try {
    const custom = compilePasteRules(rules, check)
    const found = []
    const add = (item) => {
      check()
      if (found.length >= PASTE_LIMITS.matches)
        throw new PasteRuleError('Too many matches. Split the text and paste again.')
      found.push(item)
    }
    // Fixed native detectors retain their established semantics; custom patterns never use RegExp.
    const builtins = [
      ['secret', secretPattern()],
      ['email', /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,189}\.[a-z]{2,24}\b/gi],
      ['phone', /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g],
    ]
    for (const [kind, pattern] of builtins) {
      for (const match of text.matchAll(pattern))
        add({
          start: match.index,
          end: match.index + match[0].length,
          kind,
          locked: kind === 'secret',
        })
      check()
    }
    for (const { expression, tokens, ruleIndex } of custom) {
      const matcher = expression.matcher(text)
      check()
      // Standard global iteration: leftmost, non-overlapping occurrences within each rule.
      while (matcher.find()) {
        check()
        if (matcher.start() === matcher.end())
          throw new PasteRuleError(
            'Zero-length matches are not supported. Require at least one character.',
            ruleIndex,
          )
        add({
          start: matcher.start(),
          end: matcher.end(),
          kind: 'custom',
          locked: false,
          ruleIndex,
          replacement: expandPasteReplacement(tokens, matcher, ruleIndex),
        })
      }
      check()
    }
    const groups = []
    for (const item of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const previous = groups[groups.length - 1]
      if (previous && item.start < previous.end) {
        previous.end = Math.max(previous.end, item.end)
        previous.items.push(item)
      } else groups.push({ start: item.start, end: item.end, items: [item] })
    }
    const identities = new Map(),
      counts = {}
    const matches = groups.map(({ start, end, items }, id) => {
      const locked = items.some((item) => item.locked)
      const own = items.filter((item) => item.kind === 'custom')
      const usesRule = !locked && own.length === 1 && own[0].start === start && own[0].end === end
      const conflict = !locked && own.length > 0 && !usesRule
      const kind = locked ? 'secret' : own.length ? 'custom' : items[0].kind
      let replacement = '[SECRET REMOVED]'
      if (usesRule) replacement = own[0].replacement
      else if (!locked) {
        const key = kind + ':' + text.slice(start, end)
        if (!identities.has(key)) identities.set(key, (counts[kind] = (counts[kind] || 0) + 1))
        replacement = '[' + kind.toUpperCase() + '_' + namespace + '_' + identities.get(key) + ']'
      }
      return {
        start,
        end,
        id,
        kind,
        locked,
        replacement,
        conflict,
        ruleIndexes: own.map((item) => item.ruleIndex),
      }
    })
    identities.clear()
    // Any subset can omit shrinking replacements; all-selected output alone is not an upper bound.
    if (
      text.length +
        matches.reduce(
          (sum, item) => sum + Math.max(0, item.replacement.length - (item.end - item.start)),
          0,
        ) >
      PASTE_LIMITS.outputChars
    )
      throw new PasteRuleError(
        'Replacement output is too large. Simplify the rules or paste a smaller part.',
      )
    check()
    return { complete: true, matches }
  } catch (error) {
    return {
      complete: false,
      reason:
        error instanceof PasteRuleError
          ? error.message
          : 'The local check could not start. Paste again.',
      ...(Number.isInteger(error?.ruleIndex) ? { ruleIndex: error.ruleIndex } : {}),
    }
  }
}

export function redactPaste(text, matches, selected = matches.map((item) => item.id)) {
  if (
    !Array.isArray(selected) ||
    selected.length > PASTE_LIMITS.matches ||
    selected.some((id) => !Number.isInteger(id) || !matches.some((item) => item.id === id))
  )
    throw new Error('Invalid review selection.')
  const ids = new Set(selected)
  let output = '',
    offset = 0
  for (const item of matches) {
    if (!item.locked && !ids.has(item.id)) continue
    output += text.slice(offset, item.start) + item.replacement
    offset = item.end
  }
  output += text.slice(offset)
  if (output.length > PASTE_LIMITS.outputChars)
    throw new Error('Replacement output is too large. Simplify the rules or paste a smaller part.')
  // Audit the actual selected result, including new secrets formed at replacement boundaries.
  if (secretPattern().test(output))
    throw new Error(
      'The candidate contains a known key or token. Change the rules or selection before inserting.',
    )
  return output
}
