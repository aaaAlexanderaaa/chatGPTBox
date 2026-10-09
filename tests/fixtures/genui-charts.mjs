// Public synthetic observations; no account or conversation identifiers.
export function chartComponentsMessage() {
  const monthly = [
    { month: 'Jan', actual: 12, plan: 14 },
    { month: 'Feb', actual: 18, plan: 16 },
    { month: 'Mar', actual: -4, plan: 20 },
    { month: 'Apr', actual: 24, plan: 22 },
    { month: 'May', actual: null, plan: 25 },
    { month: 'Jun', actual: 30, plan: 28 },
  ]
  const charts = [
    {
      title: '柱状图：实际与计划',
      type: 'chart',
      props: {
        data: monthly,
        xAxis: 'month',
        series: [
          { type: 'bar', dataKey: 'actual', label: '实际', color: 'blue' },
          { type: 'bar', dataKey: 'plan', label: '计划', color: 'teal' },
        ],
        showYAxis: true,
        enableLegendSeriesToggle: true,
      },
    },
    {
      title: '折线图：缺失值保持断点',
      type: 'chart',
      props: {
        data: monthly,
        xAxis: 'month',
        series: [
          { type: 'line', dataKey: 'actual', label: '实际', color: 'orange', curveType: 'linear' },
          { type: 'line', dataKey: 'plan', label: '计划', color: 'teal' },
        ],
        showYAxis: true,
        showDots: true,
        enableLegendSeriesToggle: true,
      },
    },
    {
      title: '面积图：堆叠观察',
      type: 'chart',
      props: {
        data: monthly.slice(0, 2),
        xAxis: 'month',
        series: [
          { type: 'area', dataKey: 'actual', label: '实际', stack: 'total', color: 'blue' },
          { type: 'area', dataKey: 'plan', label: '计划', stack: 'total', color: 'teal' },
        ],
        showYAxis: true,
        enableLegendSeriesToggle: true,
      },
    },
    {
      title: '散点图：数值坐标',
      type: 'chart',
      props: {
        data: [
          { x: 1, y: 4 },
          { x: 2, y: 7 },
          { x: 3, y: 5 },
          { x: 4, y: 9 },
        ],
        xAxis: { dataKey: 'x', type: 'number' },
        series: [{ type: 'scatter', dataKey: 'y', label: '观察值', color: 'purple' }],
        showYAxis: true,
      },
    },
    {
      title: '饼图：类别占比',
      type: 'pie-chart',
      props: {
        data: [
          { name: 'Alpha', value: 12 },
          { name: 'Beta', value: 18 },
          { name: 'Gamma', value: 30 },
        ],
        xAxis: 'name',
        series: [{ dataKey: 'value' }],
        innerRadius: '40%',
        outerRadius: '70%',
        tooltipValueMode: 'both',
        showValueLabels: true,
      },
    },
    {
      title: '横向柱状图：滚动与缩放',
      type: 'chart',
      props: {
        data: monthly,
        xAxis: 'month',
        series: [
          { type: 'bar', dataKey: 'plan', label: '计划', color: 'teal', valueSuffix: ' units' },
        ],
        layout: 'vertical',
        showYAxis: true,
        showValueLabels: true,
        scrollable: true,
        visiblePointCount: 4,
      },
    },
  ]
  return {
    id: 'demo-chart-answer',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: ['Chart demonstration'] },
    metadata: {
      model_dil_v2: {
        code: 'DIL.render(__dil.jsx(__dil.Fragment,null,__dil.jsx("grid",{columns:2,gap:3},__dilConstants["charts"].map(item=>__dil.jsx("grid-item",null,__dil.jsx("title",null,item.title),__dil.jsx(item.type,item.props)))),__dil.jsx("text",null,"End of chart demonstration")));',
        constants: { charts },
        fallbackMarkdown: 'Readable chart demonstration',
      },
    },
  }
}
