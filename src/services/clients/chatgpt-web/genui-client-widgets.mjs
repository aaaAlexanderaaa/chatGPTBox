import { GenuiError, genuiOwnValue as own, recordGenuiError } from './genui-presentation.mjs'
import { normalizeGenuiNativeChart } from './genui-native-chart.mjs'

const node = (tag, props = {}, ...children) => ({ tag, props, children })
const text = (value) => (typeof value === 'string' ? value : '')
const body = (value) => node('text', { preserveWhitespace: true }, value)
const heading = (value) => (value ? node('title', {}, value) : null)
function sourceText(value) {
  // Never call toJSON/accessors on data. Native references arrive as JSON, but
  // enforce the same bounded, inert data contract for every entrypoint.
  let count = 0
  const copy = (entry, depth = 0) => {
    if (++count > 10000 || depth > 40) throw new GenuiError('resource-limit')
    if (entry == null || ['string', 'boolean'].includes(typeof entry)) return entry
    if (typeof entry === 'number' && Number.isFinite(entry)) return entry
    if (typeof entry !== 'object') throw new GenuiError('invalid-props', 'client-widget', 'content')
    if (Array.isArray(entry)) return entry.map((value) => copy(value, depth + 1))
    const result = Object.create(null)
    for (const key of Object.keys(entry)) result[key] = copy(own(entry, key), depth + 1)
    return result
  }
  const result = typeof value === 'string' ? value : JSON.stringify(copy(value), null, 2)
  if (typeof result !== 'string' || result.length > 131072) throw new GenuiError('resource-limit')
  return result
}
function staticSource(
  value,
  diagnostics,
  label = '此组件显示为静态源内容，交互请在原会话中使用。',
  language = 'text',
) {
  const source = sourceText(value)
  if (!source.trim()) throw new GenuiError('invalid-props', 'client-widget', 'content')
  diagnostics.localFallbacks += 1
  const content = own(value, 'content')
  return node(
    'col',
    {},
    node('caption', {}, label),
    node('code-block', {
      content: typeof content === 'string' ? content : source,
      language: typeof content === 'string' ? own(value, 'language') || language : language,
    }),
    typeof content === 'string'
      ? node('widget-source', { content: source, language: 'json' })
      : null,
  )
}
function mapNode(data) {
  const points = own(data, 'points')
  if (!Array.isArray(points) || points.length > 512) return null
  const rows = points.map((point) => {
    if (!point || typeof point !== 'object')
      throw new GenuiError('invalid-props', 'map-widget', 'points')
    const latitude = own(point, 'latitude'),
      longitude = own(point, 'longitude')
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180
    )
      throw new GenuiError('invalid-props', 'map-widget', 'points')
    return {
      name: text(own(point, 'name')),
      address: text(own(point, 'address')),
      latitude,
      longitude,
      notes: ['label', 'description', 'notes']
        .map((key) => text(own(point, key)))
        .filter(Boolean)
        .join('\n'),
    }
  })
  const route = own(data, 'route')
  const instructions = own(route, 'legs')
  if (instructions != null && (!Array.isArray(instructions) || instructions.length > 512))
    throw new GenuiError('invalid-props', 'map-widget', 'route')
  const directions = (instructions || [])
    .map((leg) => {
      const steps = own(leg, 'instructions')
      if (
        !Array.isArray(steps) ||
        steps.length > 512 ||
        steps.some((value) => typeof value !== 'string')
      )
        throw new GenuiError('invalid-props', 'map-widget', 'route')
      return steps.join('\n')
    })
    .join('\n')
  return node(
    'col',
    {},
    heading(text(own(data, 'title'))),
    body(text(own(data, 'narrative'))),
    body(text(own(data, 'answer'))),
    node('caption', {}, '地图的静态地点与路线；交互地图请在原会话中打开。'),
    node('table', {
      columns: [
        { key: 'name', label: '地点' },
        { key: 'address', label: '地址' },
        { key: 'latitude', label: '纬度' },
        { key: 'longitude', label: '经度' },
        { key: 'notes', label: '说明' },
      ],
      rows,
    }),
    directions ? body(directions) : null,
    // Retain groups, route geometry, distances, schedules and other source
    // details without pretending an offline table is an interactive map.
    node('widget-source', { content: sourceText(data), language: 'json' }),
  )
}

export function genuiClientWidgetTree(reference, diagnostics) {
  const data = own(reference, 'data')
  const type = own(data, 'widget_type') || own(reference, 'category')
  const content = own(data, 'content')
  if (type === 'code_block') {
    if (typeof content !== 'string')
      throw new GenuiError('invalid-props', 'client-widget', 'content')
    return node('code-block', { content, language: own(data, 'language') })
  }
  try {
    if (type === 'charts_widget_v2' || own(data, 'language') === 'recharts-json') {
      const descriptor = normalizeGenuiNativeChart(content)
      return node(descriptor.type, descriptor.props)
    }
    if (type === 'writing_block') {
      // Native writing references use top-level content and email metadata.
      const attributes = own(data, 'attributes') || own(content, 'attributes') || {}
      const value =
        typeof content === 'string' ? content : own(content, 'text') ?? own(data, 'text')
      if (typeof value !== 'string')
        throw new GenuiError('invalid-props', 'client-widget', 'content')
      return node(
        'col',
        {},
        node('writing-block', {
          content: value,
          subject: own(attributes, 'subject') ?? own(data, 'subject'),
          variant: own(attributes, 'variant') ?? own(data, 'variant'),
          title: own(data, 'title'),
          recipient: own(data, 'recipient'),
          cc: own(data, 'cc'),
          bcc: own(data, 'bcc'),
        }),
        node('widget-source', { content: sourceText(data), language: 'json' }),
      )
    }
    if (['translation_block', 'language_learning_block'].includes(type)) {
      const translated = own(data, 'translated_text')
      const source = own(data, 'source_text') ?? content
      if (typeof translated === 'string')
        return node(
          'col',
          {},
          source && source !== translated ? body(text(source)) : null,
          body(translated),
          node('widget-source', { content: sourceText(data), language: 'json' }),
        )
    }
    if (
      type === 'map' ||
      ['map_widget', 'map_widget_v2', 'map_widget_with_routes'].includes(type)
    ) {
      const result = mapNode(data)
      if (result) {
        diagnostics.localFallbacks += 1
        return result
      }
    }
    if (['app_block', 'learning_block', 'language_learning_block'].includes(type))
      return staticSource(data, diagnostics)
    throw new GenuiError('unsupported-component', 'client-widget')
  } catch (error) {
    if (error.reason === 'resource-limit') throw error
    recordGenuiError(diagnostics, error)
    return staticSource(
      data ?? own(reference, 'alt') ?? own(reference, 'matched_text'),
      diagnostics,
      type === 'charts_widget_v2' || own(data, 'language') === 'recharts-json'
        ? '此图表暂时无法绘制，以下保留完整源数据。'
        : undefined,
      'json',
    )
  }
}
