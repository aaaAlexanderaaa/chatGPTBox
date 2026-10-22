// Model reasoning is transport data, not part of a JSON document or a rewrite.
// Only unwrap leading reasoning: literal tags inside the answer stay intact.
export function normalizeModelAnswer(value) {
  let text = typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : ''
  const reasoning = []
  for (;;) {
    const opening = /^<(think|thinking|analysis|reasoning)(?:\s[^>]*)?>/i.exec(text)
    if (!opening) break
    const closing = new RegExp(`</${opening[1]}\\s*>`, 'i').exec(text.slice(opening[0].length))
    if (!closing)
      return {
        text: '',
        reasoning: [...reasoning, text.slice(opening[0].length)].join('\n\n'),
        pending: true,
      }
    const end = opening[0].length + closing.index
    reasoning.push(text.slice(opening[0].length, end).trim())
    text = text.slice(end + closing[0].length).trim()
  }
  // Some providers suppress the opening tag while still emitting its close.
  if (text && !['{', '[', '```'].some((prefix) => text.startsWith(prefix))) {
    const closing =
      /(?:^|\n)[ \t]*<\/(?:think|thinking|analysis|reasoning)\s*>[ \t]*(?:\n|$)/i.exec(text)
    if (closing) {
      reasoning.push(text.slice(0, closing.index).trim())
      text = text.slice(closing.index + closing[0].length).trim()
    }
  }
  return { text, reasoning: reasoning.filter(Boolean).join('\n\n'), pending: false }
}

export function unwrapAnswerFence(text) {
  return text.trim().replace(/^```(?:[\w+-]+)?[^\S\n]*\n([\s\S]*?)\n```\s*$/, '$1')
}

// Scan complete objects without treating braces or escaped quotes in strings
// as delimiters. Never execute model text or repair an incomplete document.
export function jsonAnswerCandidates(value) {
  const answer = normalizeModelAnswer(value)
  if (answer.pending || !answer.text) return []
  const candidates = new Set([unwrapAnswerFence(answer.text)])
  let start = -1,
    depth = 0,
    quoted = false,
    escaped = false
  for (let index = 0; index < answer.text.length; index++) {
    const char = answer.text[index]
    if (start < 0) {
      if (char === '{') {
        start = index
        depth = 1
        quoted = false
      }
      continue
    }
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) {
      candidates.add(answer.text.slice(start, index + 1))
      start = -1
    }
  }
  return [...candidates]
}
