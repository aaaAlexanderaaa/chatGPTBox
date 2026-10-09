/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import {
  normalizeGenuiChart,
  parseGenuiChartDescriptor,
} from '../src/services/clients/chatgpt-web/genui-charts.mjs'
import {
  buildGenuiChartOption,
  mountGenuiChart,
} from '../src/components/MarkdownRender/genui-chart-runtime.mjs'
import { sanitizeMarkdownTree } from '../src/components/MarkdownRender/sanitize-markdown-tree.mjs'
import { renderChatgptWebGenuiResult } from '../src/services/clients/chatgpt-web/genui.mjs'
import {
  extractChatgptWebMessagePresentation,
  formatChatgptWebConversationSnapshot,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'
import { createChatgptWebResumeDeltaAccumulator } from '../src/services/clients/chatgpt-web/resume-delta.mjs'
import { protectDraftsScript } from '../scripts/sync-drafts-preview.mjs'
import { chartComponentsMessage } from './fixtures/genui-charts.mjs'

function descriptors() {
  return chartComponentsMessage().metadata.model_dil_v2.constants.charts.map((chart) =>
    normalizeGenuiChart(chart.type, chart.props),
  )
}
function allNodes(tree) {
  return [tree, ...(tree.children || []).flatMap(allNodes)]
}
function processHtml(html, math = false) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(sanitizeMarkdownTree, { allowKatexStyles: math })
  return processor.runSync(processor.parse(html))
}

describe('portable GenUI charts', () => {
  it('exports every basic chart and its data table without executing generated code', () => {
    const result = renderChatgptWebGenuiResult(chartComponentsMessage())
    expect(result).toMatchObject({
      format: 'html',
      status: 'rendered',
      unsupportedComponents: [],
      unsupportedProperties: [],
    })
    expect(result.text.match(/data-chatgptbox-chart=/g)).toHaveLength(6)
    expect(result.text.match(/<table>/g)).toHaveLength(6)
    expect(result.text).toContain('End of chart demonstration')
    expect(result.text).toContain('Alpha')
    expect(result.text).toContain('>—</td>')
    expect(result.text).not.toContain('<script')
  })
  it.each([false, true])(
    'keeps validated descriptors and open data tables in both Markdown pipelines (%s)',
    (math) => {
      const nodes = allNodes(
        processHtml(renderChatgptWebGenuiResult(chartComponentsMessage()).text, math),
      )
      const charts = nodes.filter((n) => n.properties?.dataChatgptboxChart)
      expect(charts).toHaveLength(6)
      expect(parseGenuiChartDescriptor(charts[4].properties.dataChatgptboxChart).type).toBe(
        'pie-chart',
      )
      expect(nodes.filter((n) => n.tagName === 'details' && 'open' in n.properties)).toHaveLength(6)
    },
  )
  it('keeps missing observations as gaps and negative values as negative', () => {
    const option = buildGenuiChartOption(descriptors()[1])
    expect(option.series[0].data.map((point) => point.value)).toEqual([12, 18, -4, 24, null, 30])
    expect(option.series[0].connectNulls).toBe(false)
    expect(option.legend.selectedMode).toBe(true)
  })
  it('maps stack, numeric scatter coordinates, pie labels and horizontal axes', () => {
    expect(buildGenuiChartOption(descriptors()[2]).series[0]).toMatchObject({
      type: 'line',
      stack: 'total',
      areaStyle: { opacity: 0.25 },
    })
    expect(buildGenuiChartOption(descriptors()[3]).series[0].data).toEqual([
      [1, 4],
      [2, 7],
      [3, 5],
      [4, 9],
    ])
    expect(buildGenuiChartOption(descriptors()[4]).series[0].data[1]).toMatchObject({
      name: 'Beta',
      value: 18,
    })
    const horizontal = buildGenuiChartOption(descriptors()[5])
    expect(horizontal.xAxis.type).toBe('value')
    expect(horizontal.yAxis.type).toBe('category')
    expect(horizontal.dataZoom[0]).toMatchObject({ yAxisIndex: 0, endValue: 3 })
  })
  it('uses plain tooltip text, including angle brackets and percentage units', () => {
    const descriptor = descriptors()[4]
    descriptor.props.data[0].name = '<script>[[date]]</script>'
    const option = buildGenuiChartOption(descriptor)
    expect(option.tooltip.renderMode).toBe('richText')
    expect(option.tooltip.formatter({ dataIndex: 0, seriesIndex: 0, percent: 20 })).toBe(
      '<script>[[date]]</script>: 12 (20.0%)',
    )
  })
  it.each(['horizontal', 'vertical'])(
    'keeps numeric coordinates visible when zooming (%s)',
    (layout) => {
      const descriptor = descriptors()[3]
      Object.assign(descriptor.props, {
        layout,
        scrollable: true,
        visiblePointCount: 2,
        data: [
          { x: 1700000200, y: 4 },
          { x: 1700000000, y: 7 },
          { x: 1700000100, y: 5 },
        ],
      })
      const option = buildGenuiChartOption(descriptor)
      expect(option.dataZoom[0]).toMatchObject({
        [layout === 'vertical' ? 'yAxisIndex' : 'xAxisIndex']: 0,
        startValue: 1700000000,
        endValue: 1700000100,
      })
    },
  )
  it.each([
    [
      'invalid number',
      (p) => {
        p.data[0].actual = Infinity
      },
    ],
    [
      'text number',
      (p) => {
        p.data[0].actual = '12'
      },
    ],
    [
      'remote color',
      (p) => {
        p.series[0].color = 'url(https://example.com)'
      },
    ],
    [
      'inherited color',
      (p) => {
        p.series[0].color = 'constructor'
      },
    ],
    [
      'unknown formatter',
      (p) => {
        p.yAxis = { tickFormatter: { function: 'evil' } }
      },
    ],
    [
      'too much data',
      (p) => {
        p.data = Array.from({ length: 513 }, () => p.data[0])
      },
    ],
    [
      'prototype key',
      (p) => {
        p.xAxis = 'constructor'
      },
    ],
    [
      'duplicate series',
      (p) => {
        p.series.push(p.series[0])
      },
    ],
  ])('rejects malformed or executable chart data (%s)', (_, mutate) => {
    const props = descriptors()[0].props
    mutate(props)
    expect(() => normalizeGenuiChart('chart', props)).toThrow()
  })
  it('falls back on unimplemented native data contracts instead of drawing a misleading chart', () => {
    const message = chartComponentsMessage()
    message.metadata.model_dil_v2.constants.charts[0].props.yAxis = { ticks: [0, 20] }
    expect(renderChatgptWebGenuiResult(message)).toMatchObject({
      format: 'markdown',
      status: 'fallback',
      unsupportedProperties: ['chart.yAxis'],
    })
  })
  it('strips forged invalid chart attributes while retaining readable content', () => {
    const tree = processHtml(
      '<div class="chatgptbox-genui-chart" data-chatgptbox-chart="{&quot;version&quot;:2}">Visible fallback</div>',
    )
    expect(allNodes(tree).some((n) => n.properties?.dataChatgptboxChart)).toBe(false)
    expect(JSON.stringify(tree)).toContain('Visible fallback')
  })
  it('publishes identical descriptors through history and resume', () => {
    const message = chartComponentsMessage(),
      presentation = extractChatgptWebMessagePresentation(message)
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta', { p: '', o: 'add', v: { message } })
    const snapshot = formatChatgptWebConversationSnapshot({
      conversation_id: 'demo',
      current_node: message.id,
      mapping: { [message.id]: { id: message.id, parent: null, children: [], message } },
    })
    expect(snapshot.message.text).toBe(presentation.text)
    expect(accumulator.getResult().bestMessage.text).toBe(presentation.text)
  })

  it.each(['action-2-open-checked-conversation.js', 'action-3-send-waiting-reply.js'])(
    'preserves chart descriptors and data tables in the Drafts transcript (%s)',
    (file) => {
      const message = chartComponentsMessage()
      const payload = formatChatgptWebConversationSnapshot({
        conversation_id: 'demo',
        current_node: message.id,
        async_status: null,
        mapping: { [message.id]: { id: message.id, parent: null, children: [], message } },
      })
      const draft = {
        content:
          'Conversation ID: demo\n<!-- chatgptbox-waiting-reply:start {"conversationId":"demo"} -->\n<!-- chatgptbox-waiting-reply:end -->',
        update() {},
      }
      vm.runInNewContext(
        fs.readFileSync(new URL('../docs/drafts/' + file, import.meta.url), 'utf8'),
        {
          draft,
          app: {
            displayErrorMessage(m) {
              throw new Error(m)
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
      expect(draft.content.match(/data-chatgptbox-chart=/g)).toHaveLength(6)
      expect(draft.content).toContain('End of chart demonstration')
      expect(draft.content).toContain('<table>')
    },
  )
  it('cleans up chart instances and observers, and preserves the data table on renderer failure', () => {
    const viewport = { style: {}, replaceChildren: vi.fn() },
      fallback = { open: true }
    const observer = { observe: vi.fn(), disconnect: vi.fn() }
    const root = {
      clientWidth: 360,
      ownerDocument: {
        defaultView: {
          ResizeObserver: function () {
            return observer
          },
        },
      },
      querySelector: (selector) => (selector.includes('viewport') ? viewport : fallback),
      classList: { add: vi.fn(), remove: vi.fn() },
    }
    const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
    const dispose = mountGenuiChart(root, descriptors()[0], { engine: { init: () => chart } })
    expect(fallback.open).toBe(false)
    dispose()
    expect(chart.dispose).toHaveBeenCalledOnce()
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(fallback.open).toBe(true)
    mountGenuiChart(root, descriptors()[0], {
      engine: {
        init: () => {
          throw new Error('Unavailable')
        },
      },
    })
    expect(fallback.open).toBe(true)
  })
  it('protects the bundled code from Drafts tags without changing arrays or string values', () => {
    const source = 'globalThis.result = {arrays:[[1],[2]],text:"[[draft]] %%text%% </script>"};'
    const protectedCode = protectDraftsScript(source),
      original = {},
      protectedContext = {}
    vm.runInNewContext(source, original)
    vm.runInNewContext(protectedCode, protectedContext)
    expect(JSON.stringify(protectedContext.result)).toBe(JSON.stringify(original.result))
    expect(protectedCode).not.toMatch(/\[\[|%%|<\/script/)
  })
  it('ships a single offline script with an exact CSP hash and no unexpected template tags', () => {
    const template = fs.readFileSync(
      new URL('../docs/drafts/chatgptbox-preview.html', import.meta.url),
      'utf8',
    )
    const scripts = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    const hash = createHash('sha256').update(scripts[0][1]).digest('base64')
    expect(template).toContain(`script-src 'sha256-${hash}'`)
    expect(template.match(/\[\[/g)).toHaveLength(1)
    expect(template.match(/%%/g)).toHaveLength(2)
    expect(template).not.toMatch(/<script[^>]+src=|<link|connect-src/i)
    expect(template).toContain('Apache ECharts')
    const action = JSON.parse(
      fs.readFileSync(
        new URL('../docs/drafts/chatgptbox-preview.draftsAction', import.meta.url),
        'utf8',
      ),
    )
    expect(action.steps).toHaveLength(1)
    expect(action.steps[0]).toMatchObject({
      type: 'htmlpreview',
      platforms: 3,
      data: { template, hideInterface: 'false' },
    })
    expect(action.name).toBe('ChatGPTBox Preview')
  })
})
