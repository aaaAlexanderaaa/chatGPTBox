import { escapeGenuiHtml as escapeHtml, GenuiError } from './genui-presentation.mjs'

export const GENUI_CHART_ATTRIBUTE = 'data-chatgptbox-chart'
export const GENUI_CHART_MAX_BYTES = 131072
export const GENUI_CHART_PROPERTIES = [
  'data',
  'series',
  'xAxis',
  'yAxis',
  'layout',
  'showGrid',
  'showYAxis',
  'showLegend',
  'showTooltip',
  'showDots',
  'showHoverDots',
  'showTooltipCursor',
  'showTooltipLabel',
  'showTooltipMarkers',
  'showValueLabels',
  'enableLegendSeriesToggle',
  'disableAnimation',
  'width',
  'height',
  'aspectRatio',
  'scrollable',
  'disableUserScroll',
  'visiblePointCount',
  'minPointWidth',
  'maxBarSize',
  'barRadius',
  'barGap',
  'barCategoryGap',
  'innerRadius',
  'outerRadius',
  'startAngle',
  'endAngle',
  'cornerRadius',
  'paddingAngle',
  'showLabelLines',
  'tooltipValueMode',
]
const SERIES = [
  'dataKey',
  'type',
  'label',
  'color',
  'fillColor',
  'stack',
  'curveType',
  'valueFormat',
  'valuePrefix',
  'valueSuffix',
]
const AXIS = ['dataKey', 'type', 'hide', 'labels', 'domain', 'orientation', 'tickFormatter']
const BOOLEAN = [
  'showGrid',
  'showYAxis',
  'showLegend',
  'showTooltip',
  'showDots',
  'showHoverDots',
  'showTooltipCursor',
  'showTooltipLabel',
  'showTooltipMarkers',
  'showValueLabels',
  'enableLegendSeriesToggle',
  'disableAnimation',
  'scrollable',
  'disableUserScroll',
  'showLabelLines',
]
const NUMERIC = {
  width: [1, 1024],
  height: [120, 1024],
  aspectRatio: [0.25, 4],
  visiblePointCount: [1, 512],
  minPointWidth: [1, 200],
  maxBarSize: [1, 200],
  barRadius: [0, 100],
  barGap: [0, 100],
  cornerRadius: [0, 100],
  paddingAngle: [0, 30],
  startAngle: [-360, 360],
  endAngle: [-360, 360],
}
const COLORS = {
  blue: '#3b82f6',
  green: '#10b981',
  teal: '#0d9488',
  orange: '#f97316',
  pink: '#ec4899',
  purple: '#8b5cf6',
  red: '#ef4444',
  yellow: '#eab308',
  slate: '#64748b',
}
const SAFE_KEY = /^(?!__proto__$|prototype$|constructor$)[\p{L}\p{N}_ .-]{1,80}$/u
const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value)
function invalid(tag, key) {
  throw new GenuiError('invalid-props', tag, key)
}
function text(value, tag, key, required = false) {
  if (value == null && !required) return undefined
  if (typeof value !== 'string' || value.length > 256 || (required && !value)) invalid(tag, key)
  return value
}
function keys(value, allowed, tag, property) {
  if (!isObject(value)) invalid(tag, property)
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new GenuiError('unsupported-property', tag, property)
}
function number(value, range, tag, key) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1])
    invalid(tag, key)
  return value
}
function choice(value, choices, tag, key) {
  if (!choices.includes(value)) invalid(tag, key)
  return value
}
function color(value, tag, key) {
  if (value == null) return undefined
  if (Object.prototype.hasOwnProperty.call(COLORS, value)) return COLORS[value]
  if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) invalid(tag, key)
  return value
}
function formatter(value, tag, key) {
  if (value == null) return undefined
  keys(value, ['type', 'currency', 'decimals', 'notation'], tag, key)
  const result = { type: choice(value.type, ['currency', 'percent', 'number'], tag, key) }
  if (value.currency != null) {
    if (!/^[A-Z]{3}$/.test(value.currency)) invalid(tag, key)
    result.currency = value.currency
  }
  if (value.decimals != null) result.decimals = number(value.decimals, [0, 6], tag, key)
  if (value.notation != null)
    result.notation = choice(value.notation, ['standard', 'compact'], tag, key)
  return result
}
function axis(value, tag, key) {
  if (typeof value === 'string') value = { dataKey: value }
  if (value == null) return {}
  keys(value, AXIS, tag, key)
  const result = {}
  if (value.dataKey != null) {
    if (typeof value.dataKey !== 'string' || !SAFE_KEY.test(value.dataKey)) invalid(tag, key)
    result.dataKey = value.dataKey
  }
  if (value.type != null) result.type = choice(value.type, ['number', 'category'], tag, key)
  if (value.hide != null) result.hide = choice(value.hide, [true, false], tag, key)
  if (value.orientation != null)
    result.orientation = choice(value.orientation, ['left', 'right'], tag, key)
  if (value.labels != null) {
    if (!isObject(value.labels) || Object.keys(value.labels).length > 512) invalid(tag, key)
    result.labels = Object.create(null)
    for (const [name, label] of Object.entries(value.labels)) {
      if (!SAFE_KEY.test(name)) invalid(tag, key)
      result.labels[name] = text(label, tag, key, true)
    }
  }
  if (value.domain != null) {
    if (!Array.isArray(value.domain) || value.domain.length !== 2) invalid(tag, key)
    result.domain = value.domain.map((bound) =>
      typeof bound === 'number'
        ? number(bound, [-1e15, 1e15], tag, key)
        : choice(bound, ['auto', 'dataMin', 'dataMax'], tag, key),
    )
    if (result.domain.every((v) => typeof v === 'number') && result.domain[0] >= result.domain[1])
      invalid(tag, key)
  }
  if (value.tickFormatter != null) result.tickFormatter = formatter(value.tickFormatter, tag, key)
  return result
}

// Only data crosses the answer boundary. Chart options and callbacks are built
// by the packaged renderer, never copied from generated JavaScript.
export function normalizeGenuiChart(tag, source) {
  if (!['chart', 'pie-chart'].includes(tag) || !isObject(source)) invalid(tag, 'data')
  const props = {}
  for (const key of GENUI_CHART_PROPERTIES) if (source[key] != null) props[key] = source[key]
  props.xAxis = axis(props.xAxis, tag, 'xAxis')
  props.yAxis = axis(props.yAxis, tag, 'yAxis')
  if (!props.xAxis.dataKey) invalid(tag, 'xAxis')
  if (
    !Array.isArray(props.series) ||
    !props.series.length ||
    props.series.length > 16 ||
    (tag === 'pie-chart' && props.series.length !== 1)
  )
    invalid(tag, 'series')
  props.series = props.series.map((entry) => {
    keys(entry, SERIES, tag, 'series')
    if (typeof entry.dataKey !== 'string' || !SAFE_KEY.test(entry.dataKey)) invalid(tag, 'series')
    const series = {
      dataKey: entry.dataKey,
      type:
        tag === 'pie-chart'
          ? 'pie'
          : choice(entry.type, ['bar', 'line', 'area', 'scatter'], tag, 'series'),
    }
    if (tag === 'pie-chart' && entry.type != null && entry.type !== 'pie') invalid(tag, 'series')
    for (const key of ['label', 'stack', 'valuePrefix', 'valueSuffix'])
      if (entry[key] != null) series[key] = text(entry[key], tag, 'series')
    for (const key of ['color', 'fillColor'])
      if (entry[key] != null) series[key] = color(entry[key], tag, 'series')
    if (entry.curveType != null)
      series.curveType = choice(
        entry.curveType,
        [
          'linear',
          'natural',
          'monotone',
          'monotoneX',
          'monotoneY',
          'step',
          'stepBefore',
          'stepAfter',
        ],
        tag,
        'series',
      )
    if (entry.valueFormat != null)
      series.valueFormat = choice(
        entry.valueFormat,
        ['raw', 'integer', 'compact', 'number'],
        tag,
        'series',
      )
    return series
  })
  if (new Set(props.series.map((entry) => entry.dataKey)).size !== props.series.length)
    invalid(tag, 'series')
  if (!Array.isArray(props.data) || props.data.length > 512) invalid(tag, 'data')
  const dataKeys = [props.xAxis.dataKey, ...props.series.map((entry) => entry.dataKey)]
  props.data = props.data.map((row) => {
    if (
      !isObject(row) ||
      Object.keys(row).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
    )
      invalid(tag, 'data')
    const result = Object.create(null)
    for (const key of dataKeys) {
      const value = Object.getOwnPropertyDescriptor(row, key)?.value
      if (key === props.xAxis.dataKey) {
        if (typeof value === 'number') result[key] = number(value, [-1e15, 1e15], tag, 'data')
        else result[key] = text(value, tag, 'data', true)
      } else if (value == null) result[key] = null
      else result[key] = number(value, [tag === 'pie-chart' ? 0 : -1e15, 1e15], tag, 'data')
    }
    const numericAxis =
      props.xAxis.type === 'number' ||
      (props.xAxis.type == null && props.series.some((entry) => entry.type === 'scatter'))
    if (numericAxis && typeof result[props.xAxis.dataKey] !== 'number') invalid(tag, 'data')
    if (row.fill != null) result.fill = color(row.fill, tag, 'data')
    if (row.formatted != null) result.formatted = text(row.formatted, tag, 'data')
    return result
  })
  for (const key of BOOLEAN)
    if (props[key] != null) props[key] = choice(props[key], [true, false], tag, key)
  for (const [key, range] of Object.entries(NUMERIC))
    if (props[key] != null) props[key] = number(props[key], range, tag, key)
  if (props.layout != null)
    props.layout = choice(props.layout, ['horizontal', 'vertical'], tag, 'layout')
  if (props.tooltipValueMode != null)
    props.tooltipValueMode = choice(
      props.tooltipValueMode,
      ['value', 'percent', 'both'],
      tag,
      'tooltipValueMode',
    )
  for (const key of ['innerRadius', 'outerRadius', 'barCategoryGap']) {
    if (props[key] == null) continue
    if (typeof props[key] === 'string') {
      if (!/^\d+(?:\.\d+)?%$/.test(props[key]) || Number.parseFloat(props[key]) > 100)
        invalid(tag, key)
    } else props[key] = number(props[key], [0, 512], tag, key)
  }
  if (
    props.innerRadius != null &&
    props.outerRadius != null &&
    typeof props.innerRadius === typeof props.outerRadius &&
    Number.parseFloat(props.innerRadius) >= Number.parseFloat(props.outerRadius)
  )
    invalid(tag, 'innerRadius')
  const descriptor = { version: 1, type: tag, props }
  if (JSON.stringify(descriptor).length > GENUI_CHART_MAX_BYTES) invalid(tag, 'data')
  return descriptor
}

export function parseGenuiChartDescriptor(value) {
  if (typeof value !== 'string' || value.length > GENUI_CHART_MAX_BYTES)
    throw new Error('Invalid chart descriptor')
  const descriptor = JSON.parse(value)
  keys(descriptor, ['version', 'type', 'props'], 'chart', 'data')
  if (descriptor.version !== 1) invalid('chart', 'data')
  keys(descriptor.props, GENUI_CHART_PROPERTIES, descriptor.type, 'data')
  return normalizeGenuiChart(descriptor.type, descriptor.props)
}

export function genuiChartValue(value, series = {}) {
  if (value == null) return '—'
  const options =
    series.valueFormat === 'integer'
      ? { maximumFractionDigits: 0 }
      : series.valueFormat === 'compact'
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : {}
  const result =
    series.valueFormat === 'raw'
      ? String(value)
      : new Intl.NumberFormat(undefined, options).format(value)
  return `${series.valuePrefix || ''}${result}${series.valueSuffix || ''}`
}

export function renderGenuiChart({ node, props, children }) {
  const descriptor = normalizeGenuiChart(node.tag, props),
    { xAxis, data, series } = descriptor.props
  const header =
    `<th scope="col">${escapeHtml(xAxis.dataKey)}</th>` +
    series
      .map((entry) => `<th scope="col">${escapeHtml(entry.label || entry.dataKey)}</th>`)
      .join('')
  const rows = data
    .map(
      (row) =>
        `<tr><td>${escapeHtml(
          xAxis.labels?.[String(row[xAxis.dataKey])] ?? row[xAxis.dataKey],
        )}</td>${series
          .map((entry) => `<td>${escapeHtml(genuiChartValue(row[entry.dataKey], entry))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<div class="chatgptbox-genui-chart" ${GENUI_CHART_ATTRIBUTE}="${escapeHtml(
    JSON.stringify(descriptor),
  )}"><div class="chatgptbox-genui-chart-viewport"></div><details class="chatgptbox-genui-chart-data" open><summary>图表数据</summary><div class="chatgptbox-genui-table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div></details>${children()}</div>`
}
