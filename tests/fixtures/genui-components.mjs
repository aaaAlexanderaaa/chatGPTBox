// Synthetic data only; also used for portable HTML preview validation.
export function staticComponentsMessage() {
  return {
    id: 'demo-answer',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: ['Static component demonstration'] },
    metadata: {
      model_dil_v2: {
        code: `DIL.render(__dil.jsx(()=>{const __dilConstants=DIL.useConstants();return __dil.jsx(__dil.Fragment,null,
          __dil.jsx("grid",{columns:2,gap:3},
            __dil.jsx("card",null,__dil.jsx("badge",{label:"Complete",color:"success"}),__dil.jsx("title",null,"Metric card"),__dil.jsx("text",null,"Inline ",__dil.jsx("text",{inline:true,strong:true},"emphasis")),__dil.jsx("spacer",{minSize:12})),
            __dil.jsx("col",{gap:2},__dil.jsx("blockquote",null,"Quoted observation"),__dil.jsx("text",{textAlign:"right",preserveWhitespace:true},"First line\\nSecond line"),__dil.jsx("underline",null,"Underlined"),__dil.jsx("strikethrough",null,"Previous value"))),
          __dil.jsx("table",{columns:__dilConstants["columns"],rows:__dilConstants["rows"],columnSizing:"equal"}),
          __dil.jsx("table",null,__dil.jsx("table-section",{header:true},__dil.jsx("table-row",null,__dil.jsx("table-cell",{colSpan:2},"Grouped header"))),__dil.jsx("table-section",null,__dil.jsx("table-row",null,__dil.jsx("table-cell",{rowSpan:2},"Group"),__dil.jsx("table-cell",{align:"right"},12)),__dil.jsx("table-row",null,__dil.jsx("table-cell",{align:"right"},18)))),
          __dil.jsx("list",{marker:"number",start:3,items:__dilConstants["items"]}),
          __dil.jsx("flow",{columns:3,gap:2},__dil.jsx("flow-item",{span:2},__dil.jsx("card",null,"Wide item")),__dil.jsx("flow-item",null,__dil.jsx("card",null,"Side item"))),
          __dil.jsx(CodeBlock,{language:"js",content:__dilConstants["code"]}),
          __dil.jsx(WritingBlock,{variant:"email",subject:"Sample subject",content:"Opening line\\nClosing line"}),
          __dil.jsx(LinkCard,{__resolutionId:"demo-source"}),
          __dil.jsx("text",null,"End of component demonstration")
        );}));`,
        constants: {
          columns: [
            { key: 'name', label: 'Category' },
            { key: 'value', label: 'Value', align: 'right' },
          ],
          rows: [
            { name: 'Alpha', value: 12 },
            { name: 'Beta', value: 18 },
          ],
          items: [
            { label: 'First conclusion', description: 'Supporting detail' },
            'Second conclusion',
          ],
          code: 'const value = "<safe>";\nconsole.log(value);',
        },
        appData: {
          opGenui: {
            componentResults: {
              'demo-source': {
                status: 'resolved',
                safe_urls: ['https://example.com/report'],
                state: {
                  title: 'Sample report',
                  url: 'https://example.com/report',
                  source_label: 'Example',
                  snippet: 'A resolved source summary.',
                },
              },
            },
          },
        },
        fallbackMarkdown: 'Readable component demonstration',
      },
    },
  }
}
