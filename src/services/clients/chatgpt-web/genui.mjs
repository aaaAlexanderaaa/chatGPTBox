import { parse } from 'acorn'
import { normalizeChatgptWebReferenceText } from './reference-text.mjs'

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]),
  )
const SIZES = { '2xs': 11, xs: 12, sm: 14, md: 16, lg: 20, xl: 24, '2xl': 30 }
const ICONS = { 'arrow-right': '→', 'arrow-left': '←', 'arrow-down': '↓', check: '✓' }
const TAGS = {
  fragment: 'div',
  box: 'div',
  grid: 'div',
  'grid-item': 'div',
  row: 'div',
  text: 'div',
  title: 'h3',
  caption: 'div',
  bold: 'strong',
  italic: 'em',
  table: 'table',
  'table-row': 'tr',
  'table-cell': 'td',
  divider: 'hr',
  icon: 'span',
}

function safeUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// Interpret only static JSX construction. Never evaluate the generated code,
// hooks, handlers, arbitrary calls, or property access on browser objects.
export function decodeChatgptWebGenui(dil) {
  if (typeof dil?.code !== 'string' || dil.code.length > 500000) return null
  try {
    const program = parse(dil.code, { ecmaVersion: 'latest' })
    const render = program.body.find(
      (node) =>
        node.type === 'ExpressionStatement' &&
        node.expression.type === 'CallExpression' &&
        node.expression.callee.type === 'MemberExpression' &&
        node.expression.callee.object.name === 'DIL' &&
        node.expression.callee.property.name === 'render',
    )?.expression
    let count = 0
    const read = (node) => {
      if (++count > 10000 || !node) throw new Error('Unsupported GenUI expression')
      if (node.type === 'Literal') return node.value
      if (node.type === 'ArrayExpression') return node.elements.map(read)
      if (node.type === 'ObjectExpression') {
        const result = Object.create(null)
        for (const prop of node.properties) {
          if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init')
            throw new Error('Unsupported property')
          result[prop.key.name ?? prop.key.value] = read(prop.value)
        }
        return result
      }
      if (node.type === 'MemberExpression') {
        if (
          node.object.name === '__dilConstants' &&
          node.computed &&
          node.property.type === 'Literal'
        ) {
          const key = node.property.value
          return Object.prototype.hasOwnProperty.call(dil.constants || {}, key)
            ? dil.constants[key]
            : null
        }
        if (node.object.name === '__dil' && node.property.name === 'Fragment') return 'fragment'
      }
      if (node.type === 'Identifier' && node.name === 'Cite') return 'cite'
      if (node.type === 'ArrowFunctionExpression') {
        const body =
          node.body.type === 'BlockStatement'
            ? node.body.body.find((entry) => entry.type === 'ReturnStatement')?.argument
            : node.body
        return read(body)
      }
      if (node.type === 'CallExpression') {
        if (node.callee.type === 'Identifier' && node.callee.name === '__dilSafe')
          return read(node.arguments[0])
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.name === '__dil' &&
          node.callee.property.name === 'jsx'
        ) {
          if (node.arguments[0]?.type === 'ArrowFunctionExpression') return read(node.arguments[0])
          const tag = read(node.arguments[0])
          if (tag !== 'cite' && !Object.prototype.hasOwnProperty.call(TAGS, tag))
            throw new Error('Unsupported GenUI component')
          return {
            tag,
            props: read(node.arguments[1]),
            children: node.arguments.slice(2).map(read),
          }
        }
      }
      throw new Error('Unsupported GenUI expression')
    }
    return render ? read(render.arguments[0]) : null
  } catch {
    return null
  }
}

function presentation(tag, props = {}) {
  props ||= {}
  const classes = [`chatgptbox-genui-${tag}`]
  const style = []
  if (tag === 'text') style.push('margin:8px 0')
  if (tag === 'title') style.push('margin:4px 0;line-height:1.25')
  if (tag === 'caption') style.push('font-size:12px;color:#657080')
  if (tag === 'table') style.push('width:100%;border-collapse:collapse;margin:16px 0')
  if (tag === 'table-cell')
    style.push('padding:12px;border-bottom:1px solid #d8dee8;vertical-align:top')
  function choice(key, choices, property) {
    const value = props[key]
    if (Object.prototype.hasOwnProperty.call(choices, value)) {
      classes.push(`chatgptbox-genui-${key}-${value}`)
      style.push(`${property}:${choices[value]}`)
    }
  }
  choice(
    'size',
    Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, `${v}px`])),
    'font-size',
  )
  choice('weight', { medium: 500, semibold: 600, bold: 700 }, 'font-weight')
  choice('color', { secondary: '#657080', tertiary: '#788496', default: 'inherit' }, 'color')
  choice('radius', { sm: '4px', md: '8px', lg: '12px' }, 'border-radius')
  choice('align', { center: 'center', start: 'flex-start', end: 'flex-end' }, 'align-items')
  choice(
    'justify',
    { between: 'space-between', center: 'center', start: 'flex-start' },
    'justify-content',
  )
  if (tag === 'grid') {
    const columns = Math.max(1, Math.min(6, Math.trunc(Number(props.columns)) || 2))
    classes.push(`chatgptbox-genui-columns-${columns}`)
    style.push(`display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr))`)
  }
  if (tag === 'row') style.push('display:flex;flex-wrap:wrap')
  if (tag === 'box') style.push('display:flex;flex-direction:column;min-width:0')
  for (const key of ['gap', 'padding']) {
    const value = Number(props[key])
    if (!Number.isInteger(value) || value < 0 || value > 12) continue
    classes.push(`chatgptbox-genui-${key}-${value}`)
    style.push(`${key}:${value * 4}px`)
  }
  if (props.border) {
    classes.push('chatgptbox-genui-border')
    style.push('border:1px solid #d8dee8')
  }
  if (props.tabularNums) {
    classes.push('chatgptbox-genui-tabular')
    style.push('font-variant-numeric:tabular-nums')
  }
  if (props.flex === '1' || props.flex === 1) {
    classes.push('chatgptbox-genui-flex')
    style.push('flex:1')
  }
  return `class="${classes.join(' ')}" style="${style.join(';')}"`
}

function citationItems(dil, resolutionId) {
  const result = dil.appData?.opGenui?.componentResults?.[resolutionId]
  const allowed = new Set((result?.safe_urls || []).map(safeUrl).filter(Boolean))
  return (result?.state?.items || []).filter((item) => {
    const url = safeUrl(item.url)
    return url && allowed.has(url)
  })
}

function renderGenuiFallbackMarkdown(dil, contentReferences) {
  if (typeof dil.fallbackMarkdown !== 'string') return null
  const results = dil.appData?.opGenui?.componentResults || {}
  const refs = Object.keys(results).flatMap((id) => citationItems(dil, id))
  // Resolve ordinary message references first, leaving component citations
  // intact until the safe GenUI resolution results have been checked.
  const markdown = normalizeChatgptWebReferenceText(dil.fallbackMarkdown, contentReferences, {
    preserveUnresolvedCitations: true,
  })
  return markdown.replace(/\uE200cite\uE202([^\uE201]*)\uE201/g, (_, ids) =>
    [...new Set(ids.split('\uE202'))]
      .flatMap((id) => {
        const item = refs.find((entry) => entry.ref_id === id)
        return item ? [`[${escapeHtml(item.source_label || 'Source')}](${safeUrl(item.url)})`] : []
      })
      .join(' '),
  )
}

export function renderChatgptWebGenui(message) {
  const dil = message?.metadata?.model_dil_v2
  if (!dil) return null
  const tree = decodeChatgptWebGenui(dil)
  function html(node) {
    if (node == null) return ''
    if (typeof node !== 'object') return escapeHtml(node)
    if (Array.isArray(node)) return node.map(html).join('')
    // Constants and object literals are not necessarily component nodes.
    if (
      typeof node.tag !== 'string' ||
      (node.tag !== 'cite' && !Object.prototype.hasOwnProperty.call(TAGS, node.tag)) ||
      !Array.isArray(node.children) ||
      (node.props != null && (typeof node.props !== 'object' || Array.isArray(node.props)))
    )
      throw new Error('Unsupported GenUI node')
    if (node.tag === 'cite') {
      return citationItems(dil, node.props?.__resolutionId)
        .map(
          (item) =>
            `<a href="${escapeHtml(safeUrl(item.url))}" title="${escapeHtml(
              item.title,
            )}">[${escapeHtml(item.source_label || item.title || 'Source')}]</a>`,
        )
        .join(' ')
    }
    const tag = TAGS[node.tag]
    const attrs = presentation(node.tag, node.props)
    if (tag === 'hr') return `<hr ${attrs}>`
    const children =
      node.tag === 'icon'
        ? escapeHtml(ICONS[node.props?.name] || '')
        : node.children.map(html).join('')
    return `<${tag} ${attrs}>${children}</${tag}>`
  }
  try {
    if (tree) return `<div class="chatgptbox-genui">${html(tree)}</div>`
  } catch {
    // Unsupported resolved data follows the same fallback as unsupported code.
  }
  return renderGenuiFallbackMarkdown(dil, message.metadata.content_references)
}
