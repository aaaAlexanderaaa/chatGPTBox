// GenUI HTML also travels through Markdown parsers. Encode line breaks so a
// blank line in text or code cannot end the surrounding raw HTML block.
export const escapeGenuiHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"'\r\n]/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '\r': '&#13;',
        '\n': '&#10;',
      }[char]),
  )

export function genuiOwnValue(object, key) {
  if (object == null || typeof object !== 'object') return undefined
  if (['__proto__', 'prototype', 'constructor'].includes(String(key)))
    throw new GenuiError('unsupported-expression')
  return Object.getOwnPropertyDescriptor(object, key)?.value
}

export function genuiSafeUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// Diagnostics contain component/property names, never generated code or data values.
export class GenuiError extends Error {
  constructor(reason, component, property) {
    super(reason)
    this.reason = reason
    const name = (value) =>
      typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) ? value : undefined
    this.component = name(component)
    this.property = name(property)
  }
}

export function recordGenuiError(diagnostics, error) {
  const add = (list, value) => {
    if (value && list.length < 16 && !list.includes(value)) list.push(value)
  }
  if (error?.reason === 'unsupported-component')
    add(diagnostics.unsupportedComponents, error.component)
  if (error?.reason === 'unsupported-property' || error?.reason === 'invalid-props')
    add(
      diagnostics.unsupportedProperties,
      error.property && `${error.component || 'component'}.${error.property}`,
    )
}

const SIZES = { '2xs': 11, xs: 12, sm: 14, md: 16, lg: 20, xl: 24, '2xl': 30 }
const COLORS = {
  secondary: '#657080',
  tertiary: '#788496',
  default: 'inherit',
  success: '#09866d',
  warning: '#b45309',
  danger: '#b91c1c',
}
export const GENUI_ICONS = {
  'arrow-right': '→',
  'arrow-left': '←',
  'arrow-down': '↓',
  'arrow-up': '↑',
  'arrow-up-right': '↗',
  check: '✓',
  'check-circle': '✓',
  info: 'ⓘ',
  warning: '⚠',
}

export function genuiDimension(value) {
  return typeof value === 'string' &&
    /^\d+(?:\.\d+)?px$/.test(value) &&
    Number.parseFloat(value) <= 1024
    ? value
    : null
}

const LAYOUT_TAGS = new Set(['box', 'card', 'col', 'row', 'grid-item', 'flow-item'])
const GEOMETRY_TAGS = new Set([...LAYOUT_TAGS, 'spacer', 'text', 'table-cell'])
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const SURFACE = 'var(--chatgptbox-genui-surface,#f5f7fa)'

// Shared by the HTML serializer and both Markdown renderers. Raw answer HTML can
// forge GenUI classes; these declarations cannot load resources or escape flow.
export function sanitizeGenuiStyle(value, tag) {
  if (typeof value !== 'string') return null
  const kept = []
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const key = declaration.slice(0, separator).trim().toLowerCase()
    const val = declaration.slice(separator + 1).trim()
    const layout = LAYOUT_TAGS.has(tag)
    const valid =
      (GEOMETRY_TAGS.has(tag) &&
        ['width', 'height', 'min-width', 'min-height'].includes(key) &&
        (genuiDimension(val) || (key === 'min-width' && val === '0'))) ||
      (layout && key === 'flex-grow' && /^\d+(?:\.\d+)?$/.test(val) && Number(val) <= 10000) ||
      (layout && key === 'flex-basis' && val === '0') ||
      (layout && key === 'flex-direction' && ['row', 'column'].includes(val)) ||
      (layout && key === 'overflow' && val === 'hidden') ||
      (['box', 'card', 'badge'].includes(tag) &&
        key === 'background-color' &&
        (COLOR.test(val) || val === SURFACE)) ||
      (['grid-item', 'flow-item'].includes(tag) &&
        key === 'grid-column' &&
        (/^span [1-6]$/.test(val) || val === '1 / -1')) ||
      (['grid-item', 'flow-item'].includes(tag) &&
        key === 'grid-row' &&
        /^span (?:[1-9]|1\d|20)$/.test(val)) ||
      (tag === 'grid' && key === '--chatgptbox-genui-min-child-width' && genuiDimension(val)) ||
      (tag === 'flow-item' &&
        key === 'aspect-ratio' &&
        /^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(val) &&
        val.split('/').every((part) => Number(part) > 0 && Number(part) <= 1000))
    if (valid) kept.push(`${key}:${val}`)
  }
  return kept.length ? kept.join(';') : null
}

export function genuiPresentation(tag, props = {}) {
  const classes = [`chatgptbox-genui-${tag}`]
  const style = []
  function choice(key, choices, property) {
    const value = props[key]
    if (Object.prototype.hasOwnProperty.call(choices, value)) {
      classes.push(`chatgptbox-genui-${key}-${value}`)
      if (property) style.push(`${property}:${choices[value]}`)
    }
  }
  choice(
    'size',
    Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, `${v}px`])),
    'font-size',
  )
  choice('weight', { medium: 500, semibold: 600, bold: 700 }, 'font-weight')
  choice('color', COLORS, 'color')
  choice('radius', { sm: '4px', md: '8px', lg: '12px' }, 'border-radius')
  choice(
    'align',
    { center: 'center', start: 'flex-start', end: 'flex-end', stretch: 'stretch' },
    'align-items',
  )
  choice(
    'justify',
    { between: 'space-between', center: 'center', start: 'flex-start', end: 'flex-end' },
    'justify-content',
  )
  choice(
    'textAlign',
    { left: 'left', right: 'right', center: 'center', start: 'start', end: 'end' },
    'text-align',
  )
  // Table cell alignment is text alignment, rather than a flex alignment.
  if (tag === 'table-cell')
    choice('align', { left: 'left', right: 'right', center: 'center' }, 'text-align')
  if (props.inline === true) classes.push('chatgptbox-genui-inline')
  if (props.preserveWhitespace === true) classes.push('chatgptbox-genui-preserve-whitespace')
  if (props.strong === true) classes.push('chatgptbox-genui-weight-bold')
  if (props.italic === true) classes.push('chatgptbox-genui-italic')
  if (props.underline) classes.push('chatgptbox-genui-underline')
  if (props.lineThrough === true) classes.push('chatgptbox-genui-strikethrough')
  if (props.tabularNums === true) classes.push('chatgptbox-genui-tabular')
  if (props.border) classes.push('chatgptbox-genui-border')
  if (tag === 'grid' || tag === 'flow') {
    const columns =
      typeof props.columns === 'string' && ['sm', 'md', 'lg'].includes(props.columns)
        ? { sm: 2, md: 3, lg: 4 }[props.columns]
        : props.columns ?? 2
    if (!Number.isInteger(columns) || columns < 1 || columns > 6)
      throw new GenuiError('invalid-props', tag, 'columns')
    classes.push(`chatgptbox-genui-columns-${columns}`)
    style.push(`display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr))`)
    if (props.minChildWidth != null) {
      const value = genuiDimension(`${props.minChildWidth}px`)
      if (!value) throw new GenuiError('invalid-props', tag, 'minChildWidth')
      classes.push('chatgptbox-genui-auto-columns')
      style.push(`--chatgptbox-genui-min-child-width:${value}`)
    }
  }
  if (LAYOUT_TAGS.has(tag)) {
    const direction = tag === 'row' || props.direction === 'row' ? 'row' : 'column'
    classes.push(`chatgptbox-genui-direction-${direction}`)
    style.push(`display:flex;flex-direction:${direction};min-width:0`)
    if (props.clip === true) style.push('overflow:hidden')
    for (const key of ['width', 'height']) {
      const value = genuiDimension(props[key]) || genuiDimension(props.size)
      if (value) style.push(`${key}:${value}`)
    }
    const flex =
      typeof props.flex === 'number' ||
      (typeof props.flex === 'string' && /^\d+(?:\.\d+)?$/.test(props.flex))
        ? Number(props.flex)
        : NaN
    if (Number.isFinite(flex) && flex >= 0 && flex <= 10000)
      style.push(`flex-grow:${flex};flex-basis:0`)
  }
  if (props.background === 'surface-secondary') {
    classes.push('chatgptbox-genui-background-secondary')
    style.push(`background-color:${SURFACE}`)
  } else if (typeof props.background === 'string' && COLOR.test(props.background)) {
    style.push(`background-color:${props.background}`)
  }
  for (const key of ['gap', 'padding', 'columnGap', 'rowGap']) {
    const value = props[key]
    if (!Number.isInteger(value) || value < 0 || value > 12) continue
    classes.push(`chatgptbox-genui-${key}-${value}`)
    style.push(`${{ columnGap: 'column-gap', rowGap: 'row-gap' }[key] || key}:${value * 4}px`)
  }
  if (tag === 'grid-item' || tag === 'flow-item') {
    if (props.span != null) {
      if (props.span === 'full') style.push('grid-column:1 / -1')
      else if (Number.isInteger(props.span) && props.span >= 1 && props.span <= 6)
        style.push(`grid-column:span ${props.span}`)
      else throw new GenuiError('invalid-props', tag, 'span')
    }
    if (props.rowSpan != null) {
      if (!Number.isInteger(props.rowSpan) || props.rowSpan < 1 || props.rowSpan > 20)
        throw new GenuiError('invalid-props', tag, 'rowSpan')
      style.push(`grid-row:span ${props.rowSpan}`)
    }
    if (tag === 'flow-item' && props.aspectMode === 'fixed' && props.aspectRatio != null) {
      const aspect =
        typeof props.aspectRatio === 'string' &&
        /^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(props.aspectRatio) &&
        sanitizeGenuiStyle(`aspect-ratio:${props.aspectRatio}`, tag)
      if (!aspect) throw new GenuiError('invalid-props', tag, 'aspectRatio')
      style.push(aspect)
    }
  }
  if (tag === 'spacer') {
    const value =
      genuiDimension(props.minSize) ||
      (typeof props.minSize === 'number' && genuiDimension(`${props.minSize}px`))
    if (props.minSize != null && !value) throw new GenuiError('invalid-props', tag, 'minSize')
    if (value) style.push(`min-width:${value};min-height:${value}`)
  }
  if (tag === 'table-cell' && genuiDimension(props.width)) style.push(`width:${props.width}`)
  if (tag === 'table-cell' && ['center', 'end'].includes(props.vAlign))
    classes.push(`chatgptbox-genui-vAlign-${props.vAlign}`)
  if (tag === 'badge' && props.pill !== false) classes.push('chatgptbox-genui-pill')
  if (tag === 'list' && props.marker === 'none') classes.push('chatgptbox-genui-list-none')
  // Fixed typography/layout declarations also have CSS classes. Dynamic geometry
  // uses the same bounded allowlist the extension applies after parsing HTML.
  return `class="${classes.join(' ')}" style="${escapeGenuiHtml(style.join(';'))}"`
}
