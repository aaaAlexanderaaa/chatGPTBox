/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { init } from 'echarts/core'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import { renderChatgptWebGenuiResult } from '../src/services/clients/chatgpt-web/genui.mjs'
import { normalizeGenuiNativeChart } from '../src/services/clients/chatgpt-web/genui-native-chart.mjs'
import { parseGenuiChartDescriptor } from '../src/services/clients/chatgpt-web/genui-charts.mjs'
import { buildGenuiChartOption } from '../src/components/MarkdownRender/genui-chart-runtime.mjs'
import { sanitizeMarkdownTree } from '../src/components/MarkdownRender/sanitize-markdown-tree.mjs'
import {
  extractChatgptWebMessagePresentation,
  formatChatgptWebConversationSnapshot,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'
import { createChatgptWebResumeDeltaAccumulator } from '../src/services/clients/chatgpt-web/resume-delta.mjs'
import {
  nativeChartSpec,
  nativeWidgetMessage,
  mixedNativeWidgetsMessage,
} from './fixtures/genui-client-widgets.mjs'

function nodes(tree) {
  return [tree, ...(tree.children || []).flatMap(nodes)]
}
function sanitized(text) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(sanitizeMarkdownTree)
  return processor.runSync(processor.parse(text))
}
function descriptor(text) {
  return parseGenuiChartDescriptor(
    nodes(sanitized(text)).find((n) => n.properties?.dataChatgptboxChart).properties
      .dataChatgptboxChart,
  )
}
function snapshot(message) {
  return formatChatgptWebConversationSnapshot({
    conversation_id: 'synthetic',
    current_node: message.id,
    mapping: { [message.id]: { id: message.id, parent: null, children: [], message } },
  })
}

describe('native client widgets', () => {
  it.each(['pie', 'bar', 'line', 'scatter'])(
    'renders native %s objects and JSON strings with full source data',
    (type) => {
      for (const content of [nativeChartSpec(type), JSON.stringify(nativeChartSpec(type))]) {
        const message = nativeWidgetMessage([
          {
            type: 'client_defined_widget',
            data: {
              widget_type: 'charts_widget_v2',
              language: 'recharts-json',
              content,
            },
          },
        ])
        const result = renderChatgptWebGenuiResult(message)
        expect(result).toMatchObject({ format: 'html', status: 'rendered' })
        const parsed = descriptor(result.text)
        expect(parsed.props.data.map((row) => row.amount)).toEqual([20, 60])
        expect(parsed.props.meta.footer).toBe('Unit: sample')
        expect(buildGenuiChartOption(parsed).series[0].type).toBe(type)
        expect(result.text).toContain('Before widgets')
        expect(result.text).toContain('After widgets')
        expect(result.text).toContain('Two observations')
      }
    },
  )
  it('converts reference markers without DIL, preserving emoji, sources and nearby code', () => {
    const message = nativeWidgetMessage()
    delete message.metadata.model_dil_v2
    message.content.parts[0] =
      '😀\n\n' + message.content.parts[0] + '\n\n```js\nconst chart = 1;\n```'
    const result = extractChatgptWebMessagePresentation(message)
    expect(result.rendering.status).toBe('rendered')
    expect(descriptor(result.text).type).toBe('pie-chart')
    expect(result.text).toContain('😀')
    expect(result.text).toContain('```js\nconst chart = 1;\n```')
  })
  it('keeps mixed writing, map, translation, app and learning content inert and readable', () => {
    const result = renderChatgptWebGenuiResult(mixedNativeWidgetsMessage())
    expect(result.status).toBe('partial')
    const tree = nodes(sanitized(result.text))
    expect(tree.filter((n) => n.properties?.dataChatgptboxChart)).toHaveLength(4)
    expect(tree.some((n) => ['script', 'iframe', 'button', 'img'].includes(n.tagName))).toBe(false)
    for (const text of [
      'Synthetic subject',
      'reader@example.com',
      'Place A',
      'Walk to Place A',
      '你好',
      'Learning summary',
      'After widgets',
    ])
      expect(result.text).toContain(text)
    expect(result.text).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(result.text).toContain('交互请在原会话中使用')
  })
  it('does not apply citation cleanup to source text inside a converted widget', () => {
    const message = nativeWidgetMessage([
      {
        type: 'client_defined_widget',
        category: 'app_block',
        data: { content: 'Keep this source text' },
      },
    ])
    delete message.metadata.model_dil_v2
    message.metadata.content_references.push({
      type: 'hidden',
      matched_text: 'Keep this source text',
    })
    const result = extractChatgptWebMessagePresentation(message)
    expect(result.text).toContain('Keep this source text')
    expect(result.text).not.toContain('\u0000')
  })
  it.each([
    'unknown chart type',
    'unknown field',
    'invalid number',
    'multiple axes',
    'oversized data',
  ])('uses a local source alternative for %s without dropping neighbors', (mode) => {
    const message = nativeWidgetMessage(),
      spec = message.metadata.content_references[1].data.content
    if (mode === 'unknown chart type') spec.chartType = 'radar'
    if (mode === 'unknown field') spec.callback = 'untrusted()'
    if (mode === 'invalid number') spec.data[0].amount = '20'
    if (mode === 'multiple axes') spec.axes = [{ dimension: 'y' }, { dimension: 'y' }]
    if (mode === 'oversized data')
      spec.data = Array.from({ length: 513 }, () => ({ category: 'A', amount: 1 }))
    const result = renderChatgptWebGenuiResult(message)
    expect(result).toMatchObject({ format: 'html', status: 'partial', localFallbacks: 1 })
    expect(result.text).not.toContain('data-chatgptbox-chart')
    expect(result.text).toContain('保留完整源数据')
    expect(result.text).toContain('After widgets')
  })
  it('does not execute source accessors or activate resource URLs in an unknown widget', () => {
    const message = nativeWidgetMessage()
    const data = { widget_type: 'future_widget', content: '<img src="https://example.com/track">' }
    Object.defineProperty(data, 'danger', {
      enumerable: true,
      get() {
        throw Error('must not execute')
      },
    })
    message.metadata.content_references[1].data = data
    const result = renderChatgptWebGenuiResult(message)
    expect(result.status).toBe('partial')
    expect(nodes(sanitized(result.text)).some((n) => n.tagName === 'img')).toBe(false)
  })
  it('publishes the same widgets through resume, history and both Drafts refresh scripts', () => {
    const message = mixedNativeWidgetsMessage(),
      payload = snapshot(message)
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta', { p: '', o: 'add', v: { message } })
    expect(accumulator.getResult().bestMessage.text).toBe(payload.message.text)
    for (const action of [
      'action-2-open-checked-conversation.js',
      'action-3-send-waiting-reply.js',
    ]) {
      const draft = {
        content:
          '# Conversation\n\nConversation ID: synthetic\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start {"conversationId":"synthetic"} -->\n<!-- chatgptbox-waiting-reply:end -->',
        update() {},
      }
      vm.runInNewContext(
        fs.readFileSync(new URL('../docs/drafts/' + action, import.meta.url), 'utf8'),
        {
          draft,
          app: {
            displayErrorMessage(m) {
              throw Error(m)
            },
            displaySuccessMessage() {},
          },
          HTTP: {
            create: () => ({
              request: () => ({ success: true, statusCode: 200, responseData: payload }),
            }),
          },
        },
      )
      expect(draft.content).toContain(payload.message.text)
      expect(draft.content.match(/data-chatgptbox-chart=/g)).toHaveLength(4)
    }
  })
})

describe('native chart geometry and interaction', () => {
  it('keeps exact fractional source values in the data table even when the legend uses compact labels', () => {
    const message = nativeWidgetMessage()
    message.metadata.content_references[1].data.content.data[0].amount = 1.25
    const result = renderChatgptWebGenuiResult(message)
    expect(result.text).toContain('>1.25</td>')
    expect(descriptor(result.text).props.data[0].amount).toBe(1.25)
  })
  function intervalSpec() {
    return {
      chartType: 'line',
      xKey: 'time',
      xAxisScale: 'linear',
      axes: [
        {
          dimension: 'x',
          label: 'Time',
          domain: [0, 10],
          ticks: [
            { value: 2, label: 'Early' },
            { value: 7, label: 'Late' },
          ],
        },
        { dimension: 'y', label: 'Amount', domain: [-10, 10] },
      ],
      data: [
        { time: 2, value: -3, low: -6, high: 1 },
        { time: 7, value: 2, low: -1, high: 5 },
        { time: 8, value: null, low: null, high: null },
        { time: 9, value: 4, low: 3, high: 6 },
      ],
      series: [{ dataKey: 'value', band: { lowerKey: 'low', upperKey: 'high' } }],
    }
  }
  it('preserves custom ticks and a zero-crossing interval without bridging gaps', () => {
    const option = buildGenuiChartOption(normalizeGenuiNativeChart(intervalSpec()))
    expect(option.xAxis.axisLabel.customValues).toEqual([2, 7])
    expect(option.xAxis.axisLabel.formatter(2)).toBe('Early')
    expect(option.xAxis.name).toBe('Time')
    expect(option.yAxis.name).toBe('Amount')
    expect(option.series[0].data[2]).toEqual([8, null])
    const band = option.series[1]
    expect(band.data).toEqual([[2, -6, 1, 7, -1, 5]])
    const polygon = band.renderItem(
      { coordSys: { x: -20, y: -20, width: 40, height: 40 } },
      {
        value: (i) => band.data[0][i],
        coord: (point) => point,
      },
    )
    expect(polygon.shape.points).toEqual([
      [2, -6],
      [2, 1],
      [7, 5],
      [7, -1],
    ])
    const chart = init(null, null, { renderer: 'svg', ssr: true, width: 720, height: 360 })
    try {
      chart.setOption(option)
      expect(chart.renderToSVGString()).toContain('<path')
    } finally {
      chart.dispose()
    }
  })
  it('includes interval bounds in the no-JavaScript data table and rejects reversed bounds', () => {
    const spec = intervalSpec()
    const message = nativeWidgetMessage([
      { type: 'client_defined_widget', data: { language: 'recharts-json', content: spec } },
    ])
    const result = renderChatgptWebGenuiResult(message)
    expect(result.text).toContain('value (下界)')
    expect(result.text).toContain('>-6</td>')
    spec.data[0].low = 7
    expect(renderChatgptWebGenuiResult(message).status).toBe('partial')
  })
  it('honors tooltip switches and monotone direction', () => {
    const d = normalizeGenuiNativeChart(nativeChartSpec('line'))
    Object.assign(d.props, { showTooltipLabel: false, showTooltipMarkers: false })
    d.props.series[0].curveType = 'monotoneY'
    let option = buildGenuiChartOption(d)
    expect(option.tooltip.formatter([{ dataIndex: 0, seriesIndex: 0, marker: '{marker|}' }])).toBe(
      'amount: 20',
    )
    expect(option.series[0].smoothMonotone).toBe('y')
    d.props.showTooltipMarkers = true
    option = buildGenuiChartOption(d)
    expect(option.tooltip.formatter([{ dataIndex: 0, seriesIndex: 0, marker: '{marker|}' }])).toBe(
      '{marker|}amount: 20',
    )
  })
})
