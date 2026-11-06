import { GenuiError, genuiOwnValue as own } from './genui-presentation.mjs'
import { normalizeGenuiChart, GENUI_CHART_MAX_BYTES } from './genui-charts.mjs'

const FIELDS = [
  'chartType',
  'data',
  'xKey',
  'nameKey',
  'valueKey',
  'series',
  'axes',
  'layout',
  'meta',
  'valueFormat',
  'valuePrefix',
  'valueSuffix',
  'xAxisLabel',
  'xAxisScale',
]
function invalid(property) {
  throw new GenuiError('invalid-props', 'chart-widget', property)
}
function fields(value, allowed, property) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(property)
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new GenuiError('unsupported-property', 'chart-widget', property)
}
const keyOr = (value, fallback) => (typeof value === 'string' && value.trim() ? value : fallback)

// This is the website's data format, not executable Recharts code or options.
export function normalizeGenuiNativeChart(content) {
  if (typeof content === 'string') {
    if (content.length > GENUI_CHART_MAX_BYTES) invalid('content')
    try {
      content = JSON.parse(content)
    } catch {
      invalid('content')
    }
  }
  fields(content, FIELDS, 'content')
  const type = content.chartType
  if (!['bar', 'line', 'pie', 'scatter'].includes(type)) invalid('chartType')
  if (!Array.isArray(content.data) || content.data.length > 512) invalid('data')
  const data = content.data
  if (data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) invalid('data')
  // Match the observed native defaults, including property order. Explicit keys
  // always win; values are never coerced and ambiguous invalid data is rejected.
  const first = data[0] || {},
    firstKeys = Object.keys(first)
  const xKey = keyOr(
    content.xKey,
    firstKeys.find((key) => typeof own(first, key) === 'string') || firstKeys[0] || 'name',
  )
  const valueKey = keyOr(
    content.valueKey,
    firstKeys.find((key) => key !== xKey && typeof own(first, key) === 'number') ||
      firstKeys.find((key) => key !== xKey) ||
      'value',
  )
  const xAxis = { dataKey: type === 'pie' ? keyOr(content.nameKey, xKey) : xKey }
  const yAxis = {}
  if (type === 'scatter' || content.xAxisScale === 'linear') xAxis.type = 'number'
  if (content.xAxisScale != null && content.xAxisScale !== 'linear') invalid('xAxisScale')
  if (content.xAxisLabel != null) xAxis.label = content.xAxisLabel
  if (content.axes != null) {
    if (!Array.isArray(content.axes) || content.axes.length > 2) invalid('axes')
    const seen = new Set()
    content.axes.forEach((axis, index) => {
      fields(axis, ['dimension', 'domain', 'label', 'ticks'], 'axes')
      const dimension = axis.dimension ?? (index === 0 ? 'x' : 'y')
      if (!['x', 'y'].includes(dimension) || seen.has(dimension)) invalid('axes')
      seen.add(dimension)
      const target = dimension === 'x' ? xAxis : yAxis
      for (const name of ['domain', 'label', 'ticks'])
        if (axis[name] != null) target[name] = axis[name]
    })
  }
  let series = content.series
  if (series != null && (!Array.isArray(series) || series.length > 16)) invalid('series')
  if (!series?.length) series = [{ dataKey: valueKey }]
  if (type === 'pie' && series.length > 1) invalid('series')
  series = series.map((entry) => {
    fields(
      entry,
      [
        'dataKey',
        'label',
        'stack',
        'band',
        'axisLabel',
        'valueFormat',
        'valuePrefix',
        'valueSuffix',
      ],
      'series',
    )
    if (entry.axisLabel != null) {
      if (yAxis.label != null && yAxis.label !== entry.axisLabel) invalid('axes')
      yAxis.label = entry.axisLabel
    }
    const result = {
      dataKey: type === 'pie' ? keyOr(content.valueKey, entry.dataKey) : entry.dataKey,
      type,
      label: keyOr(entry.label, entry.dataKey),
      valueFormat: entry.valueFormat ?? content.valueFormat ?? 'compact',
      valuePrefix: entry.valuePrefix ?? content.valuePrefix,
      valueSuffix: entry.valueSuffix ?? content.valueSuffix,
    }
    if (entry.stack != null) result.stack = entry.stack
    if (entry.band != null) {
      if (type !== 'line') invalid('band')
      result.band = entry.band
    }
    return result
  })
  return normalizeGenuiChart(type === 'pie' ? 'pie-chart' : 'chart', {
    data,
    series,
    xAxis,
    yAxis,
    meta: content.meta,
    layout: content.layout,
    showYAxis: type !== 'pie',
    enableLegendSeriesToggle: true,
    ...(type === 'pie' ? { tooltipValueMode: 'both' } : {}),
  })
}
