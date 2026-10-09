import { init, use } from 'echarts/core'
import { BarChart, LineChart, ScatterChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  AriaComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import {
  GENUI_CHART_ATTRIBUTE,
  genuiChartValue,
  normalizeGenuiChart,
  parseGenuiChartDescriptor,
} from '../../services/clients/chatgpt-web/genui-charts.mjs'

use([
  BarChart,
  LineChart,
  ScatterChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  AriaComponent,
  SVGRenderer,
])
const PALETTE = [
  '#3b82f6',
  '#0d9488',
  '#f97316',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
  '#eab308',
  '#ef4444',
]

function numberLabel(value, formatter) {
  if (!formatter || typeof value !== 'number') return String(value)
  if (formatter.type === 'percent') return `${value.toFixed(formatter.decimals ?? 0)}%`
  const options = {
    notation: formatter.notation || 'standard',
    maximumFractionDigits: formatter.decimals ?? (formatter.notation === 'compact' ? 1 : 3),
  }
  if (formatter.type === 'currency')
    Object.assign(options, { style: 'currency', currency: formatter.currency || 'USD' })
  return new Intl.NumberFormat(undefined, options).format(value)
}

export function buildGenuiChartOption(descriptor, dark = false) {
  const { type, props: p } = normalizeGenuiChart(descriptor.type, descriptor.props)
  const ink = dark ? '#e5e7eb' : '#1f2328',
    line = dark ? '#374151' : '#e2e8f0'
  const names = Object.fromEntries(p.series.map((s) => [s.dataKey, s.label || s.dataKey]))
  const label = (row) =>
    p.xAxis.labels?.[String(row[p.xAxis.dataKey])] ?? String(row[p.xAxis.dataKey])
  const option = {
    color: PALETTE,
    animation: false,
    textStyle: {
      color: ink,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 12,
    },
    aria: {
      enabled: true,
      label: {
        description: `${p.series
          .map((s) => s.label || s.dataKey)
          .join('、')}。展开下方“图表数据”可查看全部类别和数值。`,
      },
    },
    legend: {
      show: p.showLegend !== false,
      bottom: 0,
      textStyle: { color: ink },
      selectedMode:
        type === 'pie-chart'
          ? p.enableLegendSeriesToggle !== false
          : p.enableLegendSeriesToggle === true,
      formatter: (name) => names[name] || name,
    },
    tooltip: {
      show: p.showTooltip !== false,
      renderMode: 'richText',
      confine: true,
      trigger: type === 'pie-chart' || p.series.some((s) => s.type === 'scatter') ? 'item' : 'axis',
      axisPointer: { type: p.showTooltipCursor === false ? 'none' : 'line' },
      backgroundColor: dark ? '#1f2937' : '#ffffff',
      borderColor: line,
      textStyle: { color: ink },
      formatter: (entries) => {
        const values = Array.isArray(entries) ? entries : [entries]
        const lines = []
        if (type !== 'pie-chart') {
          const row = p.data[values[0]?.dataIndex]
          if (row) lines.push(label(row))
        }
        for (const entry of values) {
          const series = p.series[entry.seriesIndex || 0],
            row = p.data[entry.dataIndex]
          if (!row) continue
          let value = row.formatted ?? genuiChartValue(row[series.dataKey], series)
          if (type === 'pie-chart' && ['percent', 'both'].includes(p.tooltipValueMode)) {
            const percent = `${Number(entry.percent || 0).toFixed(1)}%`
            value = p.tooltipValueMode === 'percent' ? percent : `${value} (${percent})`
          }
          lines.push(
            `${type === 'pie-chart' ? label(row) : series.label || series.dataKey}: ${value}`,
          )
        }
        return lines.join('\n')
      },
    },
  }
  if (type === 'pie-chart') {
    const s = p.series[0]
    option.series = [
      {
        type: 'pie',
        name: s.dataKey,
        radius: [p.innerRadius ?? 0, p.outerRadius ?? '75%'],
        startAngle: p.startAngle ?? 90,
        endAngle: p.endAngle ?? -270,
        clockwise: (p.endAngle ?? -270) < (p.startAngle ?? 90),
        padAngle: p.paddingAngle ?? 0,
        itemStyle: {
          borderRadius: p.cornerRadius ?? 0,
          borderColor: dark ? '#111827' : '#ffffff',
          borderWidth: 2,
        },
        label: {
          show: p.showValueLabels === true,
          color: ink,
          formatter: (entry) => `${entry.name}: ${genuiChartValue(entry.value, s)}`,
        },
        labelLine: { show: p.showValueLabels === true && p.showLabelLines === true },
        data: p.data.map((row, index) => ({
          name: label(row),
          value: row[s.dataKey],
          itemStyle: { color: row.fill || s.color || PALETTE[index % PALETTE.length] },
        })),
      },
    ]
    return option
  }
  const numericX =
    p.xAxis.type === 'number' ||
    (p.xAxis.type == null && p.series.some((s) => s.type === 'scatter'))
  const categoryAxis = {
    type: numericX ? 'value' : 'category',
    show: p.xAxis.hide !== true,
    ...(numericX ? {} : { data: p.data.map((row) => row[p.xAxis.dataKey]) }),
    axisLabel: {
      color: ink,
      hideOverlap: true,
      formatter: (value) =>
        p.xAxis.labels?.[String(value)] ?? numberLabel(value, p.xAxis.tickFormatter),
    },
    axisLine: { lineStyle: { color: line } },
    axisTick: { show: false },
    splitLine: { show: false },
  }
  const valueAxis = {
    type: 'value',
    show: p.showYAxis === true && p.yAxis.hide !== true,
    position: p.yAxis.orientation || 'left',
    axisLabel: {
      color: ink,
      formatter: (value) =>
        p.yAxis.tickFormatter
          ? numberLabel(value, p.yAxis.tickFormatter)
          : genuiChartValue(value, p.series[0]),
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: p.showGrid !== false, lineStyle: { color: line, type: 'dashed' } },
  }
  const domain = (axis, bounds) => {
    if (!bounds) return
    if (bounds[0] !== 'auto') axis.min = bounds[0]
    if (bounds[1] !== 'auto') axis.max = bounds[1]
  }
  domain(categoryAxis, p.xAxis.domain)
  domain(valueAxis, p.yAxis.domain)
  const vertical = p.layout === 'vertical'
  option.grid = {
    left: 12,
    right: 16,
    top: p.showValueLabels ? 30 : 16,
    bottom: p.showLegend === false ? 12 : 54,
    containLabel: true,
  }
  option.xAxis = vertical ? valueAxis : categoryAxis
  option.yAxis = vertical ? { ...categoryAxis, inverse: true } : valueAxis
  option.series = p.series.map((s, index) => {
    const series = {
      name: s.dataKey,
      type: s.type === 'area' ? 'line' : s.type,
      stack: s.stack,
      connectNulls: false,
      showSymbol: p.showDots === true,
      symbolSize: s.type === 'scatter' ? 8 : 5,
      smooth: ['natural', 'monotone', 'monotoneX', 'monotoneY'].includes(s.curveType),
      ...(s.curveType?.startsWith('step')
        ? { step: { step: 'middle', stepBefore: 'start', stepAfter: 'end' }[s.curveType] }
        : {}),
      itemStyle: {
        color: s.color || PALETTE[index % PALETTE.length],
        ...(s.type === 'bar' ? { borderRadius: p.barRadius ?? 4 } : {}),
      },
      label: {
        show: p.showValueLabels === true,
        position: vertical ? 'right' : 'top',
        color: ink,
        formatter: (entry) => genuiChartValue(p.data[entry.dataIndex]?.[s.dataKey], s),
      },
      emphasis: { focus: 'series', ...(p.showHoverDots === false ? { disabled: true } : {}) },
      data: p.data.map((row) =>
        numericX
          ? vertical
            ? [row[s.dataKey], row[p.xAxis.dataKey]]
            : [row[p.xAxis.dataKey], row[s.dataKey]]
          : { value: row[s.dataKey], ...(row.fill ? { itemStyle: { color: row.fill } } : {}) },
      ),
    }
    if (s.type === 'area')
      series.areaStyle = {
        color: s.fillColor || s.color || PALETTE[index % PALETTE.length],
        opacity: 0.25,
      }
    if (s.type === 'bar') {
      if (p.maxBarSize != null) series.barMaxWidth = p.maxBarSize
      if (p.barCategoryGap != null) series.barCategoryGap = p.barCategoryGap
      if (p.barGap != null) series.barGap = p.barGap
    }
    return series
  })
  if (p.scrollable && !p.disableUserScroll) {
    const count =
      p.visiblePointCount ??
      (p.minPointWidth ? Math.max(1, Math.floor(360 / p.minPointWidth)) : p.data.length)
    // Value axes need actual coordinates; row indexes would hide observations
    // whose x values are dates, large numbers, or negative numbers.
    const coordinates = numericX
      ? [...new Set(p.data.map((row) => row[p.xAxis.dataKey]))].sort((a, b) => a - b)
      : p.data.map((_, index) => index)
    option.dataZoom = [
      {
        type: 'inside',
        ...(vertical ? { yAxisIndex: 0 } : { xAxisIndex: 0 }),
        filterMode: 'none',
        ...(coordinates.length
          ? {
              startValue: coordinates[0],
              endValue:
                coordinates[Math.max(0, Math.min(coordinates.length, Math.floor(count)) - 1)],
            }
          : {}),
      },
    ]
  }
  return option
}

export function mountGenuiChart(root, descriptor, { dark = false, engine = { init } } = {}) {
  const viewport = root.querySelector('.chatgptbox-genui-chart-viewport')
  const fallback = root.querySelector('.chatgptbox-genui-chart-data')
  if (!viewport) return () => {}
  let chart, observer
  try {
    const p = normalizeGenuiChart(descriptor.type, descriptor.props).props
    root.classList.add('chatgptbox-genui-chart-ready')
    const size = () => {
      viewport.style.maxWidth = p.width ? `${p.width}px` : '100%'
      viewport.style.height = `${
        p.height ||
        Math.round(
          Math.min(
            420,
            Math.max(
              220,
              Math.min(p.width || 1024, root.clientWidth || 360) / (p.aspectRatio || 4 / 3),
            ),
          ),
        )
      }px`
    }
    size()
    chart = engine.init(viewport, null, { renderer: 'svg' })
    chart.setOption(buildGenuiChartOption(descriptor, dark))
    if (fallback) fallback.open = false
    const Resize = root.ownerDocument.defaultView?.ResizeObserver
    if (Resize) {
      observer = new Resize(() => {
        size()
        chart.resize()
      })
      observer.observe(root)
    }
  } catch {
    chart?.dispose()
    chart = undefined
    root.classList.remove('chatgptbox-genui-chart-ready')
    if (fallback) fallback.open = true
  }
  return () => {
    observer?.disconnect()
    chart?.dispose()
    viewport.replaceChildren()
    root.classList.remove('chatgptbox-genui-chart-ready')
    if (fallback) fallback.open = true
  }
}

export function mountGenuiCharts(container, dark = false) {
  const cleanup = []
  for (const root of container.querySelectorAll(`[${GENUI_CHART_ATTRIBUTE}]`)) {
    try {
      cleanup.push(
        mountGenuiChart(root, parseGenuiChartDescriptor(root.getAttribute(GENUI_CHART_ATTRIBUTE)), {
          dark,
        }),
      )
    } catch {
      /* Invalid data keeps its readable table. */
    }
  }
  return () => cleanup.forEach((dispose) => dispose())
}
