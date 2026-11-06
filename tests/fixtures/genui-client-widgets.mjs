// Synthetic data shaped like native references; no private answer/identifiers.
export function nativeChartSpec(chartType = 'pie') {
  return {
    chartType,
    nameKey: 'category',
    xKey: chartType === 'scatter' ? 'x' : 'category',
    valueKey: 'amount',
    data: [
      { category: 'Alpha', x: 10, amount: 20 },
      { category: 'Beta', x: 30, amount: 60 },
    ],
    meta: { title: 'Synthetic chart', description: 'Two observations', footer: 'Unit: sample' },
  }
}

export function nativeWidgetMessage(
  references = [
    {
      type: 'client_defined_widget',
      data: {
        widget_type: 'charts_widget_v2',
        language: 'recharts-json',
        content: nativeChartSpec(),
      },
    },
  ],
) {
  const widgets = references.map((reference, index) => ({
    ...reference,
    matched_text: `:widget-${index}:`,
  }))
  const fallbackMarkdown =
    'Before widgets\n\n' +
    widgets.map((widget) => widget.matched_text).join('\n\n') +
    '\n\nAfter widgets'
  for (const widget of widgets) {
    widget.start_idx = fallbackMarkdown.indexOf(widget.matched_text)
    widget.end_idx = widget.start_idx + widget.matched_text.length
  }
  return {
    id: 'synthetic-widget-answer',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: [fallbackMarkdown] },
    metadata: {
      content_references: [{ type: 'hidden' }, ...widgets],
      model_dil_v2: {
        code:
          'DIL.render(__dil.jsx(__dil.Fragment,null,__dil.jsx("title",null,"Before widgets"),' +
          widgets
            .map(
              (_, index) =>
                `__dil.jsx("__chatgptClientDefinedWidget",{invocationId:"widget-${index}"})`,
            )
            .join(',') +
          ',__dil.jsx("text",null,"After widgets")));',
        constants: {},
        fallbackMarkdown,
        clientDefinedWidgets: Object.fromEntries(
          widgets.map((_, index) => [
            `widget-${index}`,
            { status: 'resolved', refIndex: index + 1, isStreaming: false },
          ]),
        ),
      },
    },
  }
}

export function mixedNativeWidgetsMessage() {
  return nativeWidgetMessage([
    ...['pie', 'bar', 'line', 'scatter'].map((type) => ({
      type: 'client_defined_widget',
      data: {
        widget_type: 'charts_widget_v2',
        language: 'recharts-json',
        content: nativeChartSpec(type),
      },
    })),
    {
      type: 'client_defined_widget',
      category: 'writing_block',
      data: {
        variant: 'email',
        subject: 'Synthetic subject',
        recipient: 'reader@example.com',
        content: 'First line\nSecond line <literal>',
      },
    },
    {
      type: 'client_defined_widget',
      category: 'map',
      data: {
        widget_type: 'map_widget_v2',
        title: 'Synthetic places',
        points: [
          {
            name: 'Place A',
            address: 'Sample address',
            latitude: 10,
            longitude: -20,
            notes: 'Accessible entrance',
          },
        ],
        route: { legs: [{ instructions: ['Walk to Place A'] }], distance_meters: 120 },
      },
    },
    {
      type: 'client_defined_widget',
      category: 'translation_block',
      data: {
        content: 'Hello',
        translated_text: '你好',
        source_language: 'en',
        target_language: 'zh',
      },
    },
    {
      type: 'client_defined_widget',
      category: 'app_block',
      data: {
        content: '<button onclick="alert(1)">Sample app</button><script>alert(2)</script>',
      },
    },
    {
      type: 'client_defined_widget',
      category: 'learning_block',
      data: {
        content: 'Learning summary',
        encoded_content: 'opaque-data',
        follow_up: 'Study next',
      },
    },
  ])
}
