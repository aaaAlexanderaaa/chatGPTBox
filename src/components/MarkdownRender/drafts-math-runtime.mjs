import katex from 'katex'

const MAX_EXPRESSIONS = 500
const MAX_TEX_LENGTH = 10000
const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'OPTION',
  'TITLE',
  'SVG',
  'MATH',
  'PRE',
  'CODE',
  'KBD',
  'SAMP',
])
const IGNORED_CLASSES = [
  'katex',
  'katex-display',
  'chatgptbox-math-display',
  'chatgptbox-genui-chart-viewport',
]
const DISPLAY_ENV_RE = /^\\begin\{(equation\*?|align\*?|alignat\*?|gather\*?|CD)\}/

function isEscaped(text, index) {
  let slashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++
  return slashes % 2 === 1
}

function hasIgnoredClass(element) {
  if (!element?.classList) return false
  return IGNORED_CLASSES.some((name) => element.classList.contains(name))
}

function isIgnoredElement(element) {
  return !element || IGNORED_TAGS.has(element.tagName) || hasIgnoredClass(element)
}

function insideIgnored(node, root) {
  let current = node
  while (current && current !== root) {
    if (current.nodeType === 1 && isIgnoredElement(current)) return true
    current = current.parentNode
  }
  return false
}

function normalizeDisplayMarkdownBreaks(tex) {
  if (!tex.includes('\\begin{')) return tex
  // CommonMark/GFM converts trailing `\\` before a newline into a single `\` + hard break.
  return tex.replace(/(^|[^\\])((?:\\\\)*)\\([ \t]*\n)/g, '$1$2\\\\$3')
}

function backslashDelimiterAt(text, index) {
  if (text[index] !== '\\' || text[index - 1] === '\\') return null
  // Markdown prose consumes an escape; raw HTML retains both backslashes.
  const slashes = text[index + 1] === '\\' ? 2 : 1
  const marker = text[index + slashes]
  if (marker !== '[' && marker !== '(') return null
  return {
    length: slashes + 1,
    closing: '\\'.repeat(slashes) + (marker === '[' ? ']' : ')'),
    display: marker === '[',
  }
}

function renderTexNode(doc, tex, { display = false, strict = false, state } = {}) {
  if (state.count >= state.maxExpressions) return null
  const trimmed = String(tex || '').trim()
  if (!trimmed || trimmed.length > MAX_TEX_LENGTH) return null
  let html
  try {
    html = katex.renderToString(trimmed, {
      output: 'mathml',
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      maxSize: 500,
      maxExpand: 1000,
      macros: {},
    })
  } catch {
    if (strict) return null
    try {
      html = katex.renderToString(trimmed, {
        output: 'mathml',
        displayMode: display,
        throwOnError: false,
        errorColor: 'currentColor',
        trust: false,
        strict: 'ignore',
        maxSize: 500,
        maxExpand: 1000,
        macros: {},
      })
    } catch {
      return null
    }
  }
  const template = doc.createElement('template')
  template.innerHTML = html
  const katexNode = template.content.firstElementChild
  if (!katexNode || !katexNode.querySelector('math')) return null
  state.count += 1
  if (!display) return katexNode
  const wrapper = doc.createElement('span')
  wrapper.className = 'chatgptbox-math-display'
  wrapper.appendChild(katexNode)
  return wrapper
}

export function scanMathSegments(text) {
  const segments = []
  let index = 0
  const len = text.length
  while (index < len) {
    // 1. Display $$ ... $$
    if (text[index] === '$' && text[index + 1] === '$' && !isEscaped(text, index)) {
      let close = index + 2
      let found = -1
      while (close < len - 1) {
        if (text[close] === '$' && text[close + 1] === '$' && !isEscaped(text, close)) {
          found = close
          break
        }
        close++
      }
      if (found > index + 2) {
        const inner = text.slice(index + 2, found)
        if (inner.trim()) {
          segments.push({ start: index, end: found + 2, tex: inner, display: true, strict: false })
          index = found + 2
          continue
        }
      }
      index += 2
      continue
    }

    // 2. Display \[ ... \] and inline \( ... \), including doubled delimiters.
    if (text[index] === '\\' && !isEscaped(text, index)) {
      const delimiter = backslashDelimiterAt(text, index)
      if (delimiter) {
        const { length, closing, display } = delimiter
        let close = index + length
        let found = -1
        while (close <= len - length) {
          if (text.startsWith(closing, close) && text[close - 1] !== '\\') {
            found = close
            break
          }
          close++
        }
        if (found > index + length) {
          const inner = text.slice(index + length, found)
          if (inner.trim()) {
            segments.push({
              start: index,
              end: found + length,
              tex: inner,
              display,
              strict: false,
            })
            index = found + length
            continue
          }
        }
        index += length
        continue
      }

      // 3. Standalone top-level display LaTeX environments (\begin{align*}...\end{align*})
      if (text.startsWith('\\begin{', index)) {
        const match = DISPLAY_ENV_RE.exec(text.slice(index))
        if (match) {
          const endTag = `\\end{${match[1]}}`
          const endAt = text.indexOf(endTag, index + match[0].length)
          if (endAt > index) {
            const fullEnd = endAt + endTag.length
            segments.push({
              start: index,
              end: fullEnd,
              tex: text.slice(index, fullEnd),
              display: true,
              strict: true,
            })
            index = fullEnd
            continue
          }
        }
      }
    }

    // 4. Inline $ ... $ with strict currency guards (Pandoc/GFM tex_math_dollars)
    if (text[index] === '$' && text[index + 1] !== '$' && !isEscaped(text, index)) {
      const afterOpen = text[index + 1]
      if (afterOpen && !/\s/.test(afterOpen)) {
        let close = index + 1
        let found = -1
        while (close < len) {
          const ch = text[close]
          if (ch === '\n') break
          if (ch === '$' && !isEscaped(text, close)) {
            if (text[close + 1] === '$') break
            const beforeClose = text[close - 1]
            const afterClose = text[close + 1]
            if (
              beforeClose &&
              !/\s/.test(beforeClose) &&
              !(afterClose && /[0-9]/.test(afterClose))
            ) {
              found = close
            }
            // Stop at the first unescaped `$`: if it cannot close, the opening `$` was currency.
            break
          }
          close++
        }
        if (found > index + 1) {
          const inner = text.slice(index + 1, found)
          if (inner.trim()) {
            segments.push({
              start: index,
              end: found + 1,
              tex: inner,
              display: false,
              strict: true,
            })
            index = found + 1
            continue
          }
        }
      }
    }

    index++
  }
  return segments
}

function stripOuterDelimiters(raw, defaultDisplay) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4)
    return { tex: trimmed.slice(2, -2), display: true }
  const delimiter = backslashDelimiterAt(trimmed, 0)
  if (
    delimiter &&
    trimmed.endsWith(delimiter.closing) &&
    trimmed.length > delimiter.length * 2 &&
    trimmed[trimmed.length - delimiter.length - 1] !== '\\'
  )
    return { tex: trimmed.slice(delimiter.length, -delimiter.length), display: delimiter.display }
  if (
    trimmed.startsWith('$') &&
    trimmed.endsWith('$') &&
    !trimmed.startsWith('$$') &&
    trimmed.length > 2
  )
    return { tex: trimmed.slice(1, -1), display: false }
  return { tex: trimmed, display: defaultDisplay }
}

function renderExplicitMathElements(root, doc, state) {
  // MultiMarkdown <span class="math"> / <div class="math">
  for (const el of [...root.querySelectorAll('span.math, div.math')]) {
    if (!el.isConnected || insideIgnored(el, root)) continue
    const { tex, display } = stripOuterDelimiters(el.textContent || '', el.tagName === 'DIV')
    const rendered = renderTexNode(doc, tex, { display, strict: false, state })
    if (rendered) el.replaceWith(rendered)
  }

  // Fenced ```math blocks (<pre><code class="language-math|math|chatgptbox-math">)
  for (const code of [
    ...root.querySelectorAll(
      'pre > code.language-math, pre > code.math, pre > code.chatgptbox-math',
    ),
  ]) {
    const pre = code.parentElement
    if (!pre || !pre.isConnected || pre.childNodes.length > 3) continue
    if (
      [...pre.childNodes].some(
        (child) => child !== code && (child.nodeType !== 3 || child.nodeValue.trim()),
      )
    )
      continue
    if (insideIgnored(pre.parentNode, root)) continue
    const { tex } = stripOuterDelimiters(code.textContent || '', true)
    const rendered = renderTexNode(doc, tex, { display: true, strict: false, state })
    if (rendered) pre.replaceWith(rendered)
  }

  // Inline explicit math code (<code class="language-math|math|chatgptbox-math">)
  for (const code of [
    ...root.querySelectorAll('code.language-math, code.math, code.chatgptbox-math'),
  ]) {
    if (!code.isConnected || code.parentElement?.tagName === 'PRE') continue
    if (insideIgnored(code.parentNode, root)) continue
    const { tex, display } = stripOuterDelimiters(code.textContent || '', false)
    const rendered = renderTexNode(doc, tex, { display, strict: false, state })
    if (rendered) code.replaceWith(rendered)
  }
}

function isPlainEm(node) {
  if (!node || node.nodeType !== 1 || node.tagName !== 'EM' || node.attributes.length > 0)
    return false
  for (const child of node.childNodes) {
    if (child.nodeType !== 3 && !(child.nodeType === 1 && child.tagName === 'BR')) return false
  }
  return true
}

function emText(node) {
  let out = ''
  for (const child of node.childNodes) {
    out += child.nodeType === 3 ? child.nodeValue : '\n'
  }
  return out
}

function processInlineRun(run, doc, state) {
  let flat = ''
  const pieces = []
  let hasNonText = false
  for (const node of run) {
    const start = flat.length
    if (node.nodeType === 3) {
      flat += node.nodeValue
      pieces.push({ kind: 'text', node, start, end: flat.length })
    } else if (node.tagName === 'BR') {
      hasNonText = true
      flat += '\n'
      pieces.push({ kind: 'br', node, start, end: flat.length })
    } else {
      hasNonText = true
      flat += '_' + emText(node) + '_'
      pieces.push({ kind: 'em', node, start, end: flat.length })
    }
  }
  if (!hasNonText && !/[$\\]/.test(flat)) return
  const segments = scanMathSegments(flat)
  if (!segments.length) return

  const resolved = []
  for (const seg of segments) {
    const crossesEm = pieces.some(
      (piece) => piece.kind === 'em' && piece.start < seg.end && piece.end > seg.start,
    )
    // Never partially split an <em> tag across a math boundary.
    const partialEm = pieces.some(
      (piece) =>
        piece.kind === 'em' &&
        ((piece.start < seg.start && piece.end > seg.start) ||
          (piece.start < seg.end && piece.end > seg.end)),
    )
    if (partialEm) continue
    const tex =
      seg.display && seg.tex.includes('\n') ? normalizeDisplayMarkdownBreaks(seg.tex) : seg.tex
    const rendered = renderTexNode(doc, tex, {
      display: seg.display,
      strict: seg.strict || crossesEm,
      state,
    })
    if (rendered) resolved.push({ ...seg, rendered })
  }
  if (!resolved.length) return

  const parent = run[0].parentNode
  const anchor = run[run.length - 1].nextSibling
  const fragment = doc.createDocumentFragment()

  const emitUnmatched = (from, to) => {
    if (from >= to) return
    for (const piece of pieces) {
      if (piece.end <= from || piece.start >= to) continue
      if (piece.kind === 'text') {
        const s = Math.max(from, piece.start) - piece.start
        const e = Math.min(to, piece.end) - piece.start
        const slice = piece.node.nodeValue.slice(s, e)
        if (slice) fragment.appendChild(doc.createTextNode(slice))
      } else {
        fragment.appendChild(piece.node)
      }
    }
  }

  let cursor = 0
  for (const item of resolved) {
    emitUnmatched(cursor, item.start)
    fragment.appendChild(item.rendered)
    cursor = item.end
  }
  emitUnmatched(cursor, flat.length)

  for (const node of run) {
    if (node.parentNode === parent) parent.removeChild(node)
  }
  parent.insertBefore(fragment, anchor)
}

function renderInlineDelimiters(root, doc, state) {
  const containers = []
  const collect = (el) => {
    if (!el || el.nodeType !== 1 || isIgnoredElement(el)) return
    let hasText = false
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && /[$\\]/.test(child.nodeValue)) hasText = true
      else if (child.nodeType === 1) collect(child)
    }
    if (hasText) containers.push(el)
  }
  collect(root)

  for (const container of containers) {
    if (!container.isConnected || state.count >= state.maxExpressions) continue
    const children = [...container.childNodes]
    let run = []
    const flush = () => {
      if (run.length) {
        processInlineRun(run, doc, state)
        run = []
      }
    }
    for (const child of children) {
      if (
        child.nodeType === 3 ||
        (child.nodeType === 1 && (child.tagName === 'BR' || isPlainEm(child)))
      ) {
        run.push(child)
      } else {
        flush()
      }
    }
    flush()
  }
}

export function wrapDraftsTables(root) {
  if (!root?.querySelectorAll) return
  const doc = root.ownerDocument || document
  for (const table of [...root.querySelectorAll('table')]) {
    if (
      !table.isConnected ||
      table.closest('.chatgptbox-genui-table-scroll, .chatgptbox-table-scroll') ||
      table.classList.contains('chatgptbox-genui-table')
    )
      continue
    const wrapper = doc.createElement('div')
    wrapper.className = 'chatgptbox-table-scroll'
    table.parentNode.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  }
}

export function renderDraftsMath(root, options = {}) {
  if (!root?.querySelectorAll) return 0
  const doc = root.ownerDocument || document
  const state = {
    count: 0,
    maxExpressions: options.maxExpressions ?? MAX_EXPRESSIONS,
  }
  renderExplicitMathElements(root, doc, state)
  renderInlineDelimiters(root, doc, state)
  return state.count
}
