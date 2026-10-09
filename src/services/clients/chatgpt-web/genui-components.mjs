import {
  escapeGenuiHtml as escapeHtml,
  GenuiError,
  GENUI_ICONS,
  genuiOwnValue as ownValue,
  genuiSafeUrl as safeUrl,
  genuiPresentation,
  recordGenuiError,
} from './genui-presentation.mjs'
import { GENUI_CHART_PROPERTIES, renderGenuiChart } from './genui-charts.mjs'

const COMMON = [
  'key',
  'fallback',
  'size',
  'color',
  'weight',
  'radius',
  'align',
  'justify',
  'background',
  'gap',
  'padding',
  'border',
  'tabularNums',
]
const LAYOUT = ['direction', 'width', 'height', 'flex', 'clip']
const TEXT = [
  'inline',
  'textAlign',
  'preserveWhitespace',
  'strong',
  'italic',
  'underline',
  'lineThrough',
]
const RESOLVED = ['__resolutionId', 'refs']

function component(element, properties = [], options = {}) {
  return Object.freeze({ element, properties: new Set([...COMMON, ...properties]), ...options })
}

// Every static adapter declares its data contract here. New names do not require
// changes to the parser, gateway, or Drafts actions.
export const GENUI_COMPONENTS = Object.freeze({
  fragment: component('div'),
  box: component('div', LAYOUT),
  col: component('div', LAYOUT),
  row: component('div', LAYOUT),
  card: component('div', [...LAYOUT, 'variant'], {
    defaults: { padding: 4, radius: 'lg', border: true },
  }),
  badge: component('span', ['label', 'pill', 'variant'], { render: renderBadge }),
  spacer: component('div', ['minSize']),
  grid: component('div', ['columns', 'minChildWidth', 'columnGap', 'rowGap']),
  'grid-item': component('div', [...LAYOUT, 'span', 'rowSpan']),
  flow: component('div', ['columns', 'layout']),
  'flow-item': component('div', [...LAYOUT, 'span', 'rowSpan', 'aspectMode', 'aspectRatio']),
  text: component('div', TEXT),
  title: component('h3', TEXT),
  caption: component('div', TEXT),
  bold: component('strong'),
  italic: component('em'),
  underline: component('u'),
  strikethrough: component('s'),
  blockquote: component('blockquote'),
  code: component('code'),
  divider: component('hr', [], { render: renderDivider }),
  icon: component('span', ['name', 'inline'], { render: renderIcon }),
  list: component('ul', ['marker', 'items', 'start'], { render: renderList }),
  'list-item': component('li', ['label', 'description', 'disabled'], { render: renderListItem }),
  table: component('table', ['columns', 'rows', 'columnSizing', 'dividers', 'emptyLabel'], {
    render: renderTable,
  }),
  'table-section': component('tbody', ['header'], { render: renderTableSection }),
  'table-row': component('tr', ['header', 'label', 'labelColSpan'], { render: renderTableRow }),
  'table-cell': component('td', ['header', 'colSpan', 'rowSpan', 'width', 'vAlign'], {
    render: renderTableCell,
  }),
  cite: component('span', RESOLVED, { render: renderCite }),
  link: component('a', [...RESOLVED, 'url', 'href', 'title'], { render: renderLink }),
  'link-card': component('a', [...RESOLVED, 'url', 'title', 'subtitle', 'snippet'], {
    render: renderLink,
  }),
  'code-block': component('pre', ['content', 'language'], { render: renderCodeBlock }),
  'writing-block': component('div', ['content', 'subject', 'variant'], {
    render: renderWritingBlock,
  }),
  chart: component('div', GENUI_CHART_PROPERTIES, { render: renderGenuiChart }),
  'pie-chart': component('div', GENUI_CHART_PROPERTIES, { render: renderGenuiChart }),
})

export const GENUI_NAMED_COMPONENTS = Object.freeze({
  Cite: 'cite',
  Citation: 'cite',
  Link: 'link',
  LinkCard: 'link-card',
  CodeBlock: 'code-block',
  WritingBlock: 'writing-block',
})

export function getGenuiComponent(tag) {
  return typeof tag === 'string' && Object.prototype.hasOwnProperty.call(GENUI_COMPONENTS, tag)
    ? GENUI_COMPONENTS[tag]
    : null
}

export function genuiCitationItems(dil, resolutionId) {
  if (['__proto__', 'prototype', 'constructor'].includes(String(resolutionId))) return []
  const result = ownValue(dil.appData?.opGenui?.componentResults, resolutionId)
  const allowed = new Set(
    (Array.isArray(result?.safe_urls) ? result.safe_urls : []).map(safeUrl).filter(Boolean),
  )
  return (Array.isArray(result?.state?.items) ? result.state.items : []).filter((item) => {
    const url = safeUrl(item?.url)
    return url && allowed.has(url)
  })
}

function validateKeys(value, allowed, tag) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new GenuiError('unsupported-property', tag, key)
  }
}

function spanAttribute(props, key, tag) {
  const value = props[key]
  if (value == null) return ''
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new GenuiError('invalid-props', tag, key)
  return ` ${key.toLowerCase()}="${value}"`
}

function renderCite({ props, dil }) {
  return genuiCitationItems(dil, props.__resolutionId)
    .map(
      (item) =>
        `<a href="${escapeHtml(safeUrl(item.url))}" title="${escapeHtml(item.title)}">[${escapeHtml(
          item.source_label || item.title || 'Source',
        )}]</a>`,
    )
    .join(' ')
}

function renderLink({ node, props, results, diagnostics, children, hasChildren, wrap }) {
  const result = ownValue(results, props.__resolutionId)
  const state = result?.state || {}
  const url = safeUrl(state.url ?? props.url ?? props.href)
  const title = state.title ?? props.title ?? 'Source'
  const approved = props.__resolutionId
    ? result?.safe_urls
    : Object.values(results).flatMap((entry) => entry?.safe_urls || [])
  const allowed = url && Array.isArray(approved) && approved.some((value) => safeUrl(value) === url)
  if (!allowed) diagnostics.omittedLinks += 1
  let body = hasChildren(node.children) ? children() : escapeHtml(title)
  if (node.tag === 'link-card') {
    const subtitle = state.source_label ?? props.subtitle
    const snippet = state.snippet ?? props.snippet
    body =
      `<strong>${escapeHtml(title)}</strong>` +
      (subtitle ? `<div class="chatgptbox-genui-caption">${escapeHtml(subtitle)}</div>` : '') +
      (snippet ? `<div class="chatgptbox-genui-text">${escapeHtml(snippet)}</div>` : '')
  }
  return allowed ? wrap('a', body, ` href="${escapeHtml(url)}"`) : wrap('span', body)
}

function renderTable({ node, props, context, render, depth, children, hasChildren }) {
  if (props.columnSizing != null && !['auto', 'equal'].includes(props.columnSizing))
    throw new GenuiError('invalid-props', 'table', 'columnSizing')
  let body
  if (hasChildren(node.children)) body = children()
  else {
    const columns = props.columns ?? [],
      rows = props.rows ?? []
    if (
      !Array.isArray(columns) ||
      columns.length > 64 ||
      !Array.isArray(rows) ||
      rows.length > 512 ||
      (rows.length && !columns.length)
    )
      throw new GenuiError('invalid-props', 'table')
    for (const column of columns) {
      if (!column || typeof column !== 'object' || typeof column.key !== 'string')
        throw new GenuiError('invalid-props', 'table', 'columns')
      validateKeys(column, new Set(['key', 'label', 'align', 'width']), 'table')
    }
    body =
      '<thead><tr>' +
      columns
        .map((column) =>
          render(
            {
              tag: 'table-cell',
              props: {
                header: true,
                align: column.align,
                width: column.width,
              },
              children: [column.label ?? column.key],
            },
            context,
            depth + 1,
          ),
        )
        .join('') +
      '</tr></thead><tbody>'
    body += rows.length
      ? rows
          .map((row) => {
            if (!row || typeof row !== 'object' || Array.isArray(row))
              throw new GenuiError('invalid-props', 'table', 'rows')
            return (
              '<tr>' +
              columns
                .map((column) =>
                  render(
                    {
                      tag: 'table-cell',
                      props: { align: column.align },
                      children: [ownValue(row, column.key)],
                    },
                    context,
                    depth + 1,
                  ),
                )
                .join('') +
              '</tr>'
            )
          })
          .join('')
      : `<tr><td colspan="${columns.length || 1}">${render(
          props.emptyLabel ?? 'No rows',
          context,
          depth + 1,
        )}</td></tr>`
    body += '</tbody>'
  }
  const tableProps = { ...props }
  const attrs = genuiPresentation('table', tableProps)
  const equal = props.columnSizing === 'equal' ? ' chatgptbox-genui-table-equal' : ''
  return `<div class="chatgptbox-genui-table-scroll${equal}"><table ${attrs}>${body}</table></div>`
}

function renderTableSection({ props, children, wrap }) {
  return wrap(props.header ? 'thead' : 'tbody', children({ header: props.header === true }))
}

function renderTableRow({ node, props, context, render, depth, children, wrap }) {
  const header = props.header === true || context.header === true
  const row = wrap('tr', children({ header }))
  if (props.label == null) return row
  const colSpan = props.labelColSpan ?? Math.max(1, node.children.length)
  return `<tr><td${spanAttribute({ colSpan }, 'colSpan', 'table-row')}>${render(
    props.label,
    context,
    depth + 1,
  )}</td></tr>${row}`
}

function renderTableCell({ node, props, context, children, wrap }) {
  const header = props.header === true || context.header === true
  return wrap(
    header ? 'th' : 'td',
    children(),
    spanAttribute(props, 'colSpan', node.tag) +
      spanAttribute(props, 'rowSpan', node.tag) +
      (header ? ' scope="col"' : ''),
  )
}

function renderList({ props, context, render, depth, children, wrap }) {
  const marker = props.marker ?? 'bullet'
  if (!['number', 'bullet', 'none'].includes(marker))
    throw new GenuiError('invalid-props', 'list', 'marker')
  const items = props.items ?? []
  if (!Array.isArray(items) || items.length > 512)
    throw new GenuiError('invalid-props', 'list', 'items')
  let start = ''
  if (props.start != null) {
    if (!Number.isInteger(props.start) || Math.abs(props.start) > 10000)
      throw new GenuiError('invalid-props', 'list', 'start')
    start = ` start="${props.start}"`
  }
  const body =
    items
      .map((item) => {
        if (typeof item === 'string')
          return render({ tag: 'list-item', props: {}, children: [item] }, context, depth + 1)
        if (!item || typeof item !== 'object' || Array.isArray(item))
          throw new GenuiError('invalid-props', 'list', 'items')
        validateKeys(item, new Set(['label', 'description', 'disabled', 'children']), 'list')
        const { children: itemChildren, ...itemProps } = item
        return render(
          {
            tag: 'list-item',
            props: itemProps,
            children: itemChildren == null ? [] : [itemChildren],
          },
          context,
          depth + 1,
        )
      })
      .join('') + children()
  return wrap(marker === 'number' ? 'ol' : 'ul', body, start)
}

function renderListItem({ node, props, context, render, depth, children, hasChildren, wrap }) {
  return wrap(
    'li',
    hasChildren(node.children) ? children() : render(props.label, context, depth + 1),
  ).replace(
    '</li>',
    (props.description != null
      ? `<div class="chatgptbox-genui-caption">${render(
          props.description,
          context,
          depth + 1,
        )}</div>`
      : '') + '</li>',
  )
}

function renderBadge({ node, props, context, render, depth, children, hasChildren, wrap }) {
  return wrap(
    'span',
    hasChildren(node.children) ? children() : render(props.label, context, depth + 1),
  )
}

function renderIcon({ props, wrap }) {
  return wrap('span', escapeHtml(GENUI_ICONS[props.name] || ''))
}

function renderDivider({ node, props }) {
  return `<hr ${genuiPresentation(node.tag, props)}>`
}

function renderCodeBlock({ node, props, wrap }) {
  if (typeof props.content !== 'string') throw new GenuiError('invalid-props', node.tag, 'content')
  const language =
    typeof props.language === 'string' && /^[a-z0-9_-]{1,32}$/i.test(props.language)
      ? props.language
      : 'text'
  return wrap('pre', `<code class="language-${language}">${escapeHtml(props.content)}</code>`)
}

function renderWritingBlock({ props, context, render, depth, children, wrap }) {
  const heading =
    props.variant === 'email' && props.subject
      ? `<strong>${escapeHtml(props.subject)}</strong>`
      : '<h3>Writing Block</h3>'
  const body = props.content == null ? children() : render(props.content, context, depth + 1)
  return wrap('div', `${heading}<div class="chatgptbox-genui-preserve-whitespace">${body}</div>`)
}

export function renderGenuiTree(tree, dil, diagnostics) {
  let count = 0
  const results = dil.appData?.opGenui?.componentResults || {}
  function render(node, context = {}, depth = 0) {
    try {
      return renderNode(node, context, depth)
    } catch (error) {
      if (node?.props?.fallback != null && error.reason !== 'render-limit') {
        recordGenuiError(diagnostics, error)
        diagnostics.localFallbacks += 1
        return render(node.props.fallback, context, depth + 1)
      }
      throw error
    }
  }
  function renderNode(node, context, depth) {
    if (++count > 10000 || depth > 80) throw new GenuiError('render-limit')
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node === 'string' || (typeof node === 'number' && Number.isFinite(node)))
      return escapeHtml(node)
    if (Array.isArray(node)) {
      if (node.length > 512) throw new GenuiError('render-limit')
      return node.map((child) => render(child, context, depth + 1)).join('')
    }
    const definition = getGenuiComponent(node?.tag)
    if (
      !definition ||
      !Array.isArray(node.children) ||
      (node.props != null && (typeof node.props !== 'object' || Array.isArray(node.props)))
    )
      throw new GenuiError(definition ? 'invalid-props' : 'unsupported-component', node?.tag)
    const props = { ...definition.defaults, ...node.props }
    validateKeys(props, definition.properties, node.tag)
    const children = (overrides) => render(node.children, { ...context, ...overrides }, depth + 1)
    const hasChildren = (value) =>
      Array.isArray(value) ? value.some(hasChildren) : value != null && typeof value !== 'boolean'
    const wrap = (element, body, extra = '', presentationProps = props) =>
      `<${element} ${genuiPresentation(node.tag, presentationProps)}${extra}>${body}</${element}>`
    if (definition.render)
      return definition.render({
        node,
        props,
        context,
        render,
        depth,
        results,
        dil,
        diagnostics,
        children,
        hasChildren,
        wrap,
      })
    return wrap(
      props.inline === true && ['text', 'caption'].includes(node.tag) ? 'span' : definition.element,
      children(),
    )
  }
  return render(tree)
}
