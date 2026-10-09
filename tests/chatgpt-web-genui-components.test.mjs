/* eslint-env node */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { renderChatgptWebGenuiResult } from '../src/services/clients/chatgpt-web/genui.mjs'
import {
  extractChatgptWebMessagePresentation,
  formatChatgptWebConversationSnapshot,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'
import { createChatgptWebResumeDeltaAccumulator } from '../src/services/clients/chatgpt-web/resume-delta.mjs'
import { sanitizeMarkdownTree } from '../src/components/MarkdownRender/sanitize-markdown-tree.mjs'
import { syncDraftsPreview } from '../scripts/sync-drafts-preview.mjs'
import { staticComponentsMessage } from './fixtures/genui-components.mjs'

function resultFor(code) {
  const message = staticComponentsMessage()
  message.metadata.model_dil_v2.code = code
  return renderChatgptWebGenuiResult(message)
}

function sanitizedTree(html, allowKatexStyles) {
  const processor = unified().use(remarkParse)
  if (allowKatexStyles) processor.use(remarkMath)
  processor.use(remarkGfm).use(remarkBreaks).use(remarkRehype, { allowDangerousHtml: true })
  if (allowKatexStyles) processor.use(rehypeKatex)
  processor
    .use(rehypeRaw)
    .use(rehypeHighlight, { detect: true, ignoreMissing: true })
    .use(sanitizeMarkdownTree, { allowKatexStyles })
  return processor.runSync(processor.parse(html))
}

function elements(tree, tag) {
  const found = []
  function visit(node) {
    if (node.tagName === tag) found.push(node)
    node.children?.forEach(visit)
  }
  visit(tree)
  return found
}

describe('static GenUI component adapters', () => {
  it.each([
    [false, '\n'],
    [true, '\n'],
    [false, '\r\n'],
    [true, '\r\n'],
  ])('preserves code text through Markdown parsing (math=%s, newline=%j)', (math, newline) => {
    const content = [
      '',
      'const a = 1;',
      '',
      'const b = "**bold**";',
      '// <tag> & &#10; `backticks` $math$',
      '',
      '',
    ].join(newline)
    const message = staticComponentsMessage()
    message.metadata.model_dil_v2.constants.code = content
    const tree = sanitizedTree(renderChatgptWebGenuiResult(message).text, math)
    const codes = elements(tree, 'code')
    expect(codes).toHaveLength(1)
    // Pre's copy action reads this code element's textContent, including spans
    // added by syntax highlighting.
    const textContent = (node) => node.value ?? (node.children || []).map(textContent).join('')
    expect(textContent(codes[0])).toBe(content)
  })

  it('keeps data tables, inline text, writing/code blocks and resolved cards in the same answer', () => {
    const result = renderChatgptWebGenuiResult(staticComponentsMessage())
    expect(result).toMatchObject({
      format: 'html',
      status: 'rendered',
      unsupportedComponents: [],
      unsupportedProperties: [],
    })
    expect(result.text).toContain('Alpha')
    expect(result.text).toContain('Beta')
    expect(result.text).toContain('>12</td>')
    expect(result.text).toContain('chatgptbox-genui-align-right')
    expect(result.text).toContain('chatgptbox-genui-inline')
    expect(result.text).toContain('chatgptbox-genui-textAlign-right')
    expect(result.text).toContain('chatgptbox-genui-preserve-whitespace')
    expect(result.text).toContain('<pre ')
    expect(result.text).toContain('&lt;safe&gt;')
    expect(result.text).toContain('Sample subject')
    expect(result.text).toContain('A resolved source summary.')
    expect(result.text).toContain('href="https://example.com/report"')
    expect(result.text).toContain('End of component demonstration')
  })

  it.each([false, true])(
    'preserves sections, inherited headers, cell spans, list starts and flow geometry through both pipelines (%s)',
    (allowKatexStyles) => {
      const tree = sanitizedTree(
        renderChatgptWebGenuiResult(staticComponentsMessage()).text,
        allowKatexStyles,
      )
      const headers = elements(tree, 'th')
      expect(headers).toHaveLength(3)
      expect(headers[2].properties).toMatchObject({ colSpan: '2', scope: 'col' })
      expect(elements(tree, 'td').some((node) => String(node.properties.rowSpan) === '2')).toBe(
        true,
      )
      expect(String(elements(tree, 'ol')[0].properties.start)).toBe('3')
      expect(elements(tree, 'li')).toHaveLength(2)
      expect(
        elements(tree, 'span').some((node) =>
          node.properties.className?.includes('chatgptbox-genui-inline'),
        ),
      ).toBe(true)
      expect(
        elements(tree, 'div').some((node) => node.properties.style?.includes('grid-column:span 2')),
      ).toBe(true)
    },
  )

  it('uses an empty label only for a genuinely empty table', () => {
    const result = resultFor(
      'DIL.render(__dil.jsx("table",{columns:[{key:"value",label:"Value"}],rows:[],emptyLabel:"No observations"}));',
    )
    expect(result.status).toBe('rendered')
    expect(result.text).toContain('No observations')
    expect(result.text).toContain('Value')
  })

  it.each([
    ['missing columns', 'rows:[{value:1}]'],
    ['nonarray rows', 'columns:[{key:"value"}],rows:{value:1}'],
    ['invalid key', 'columns:[{key:1}],rows:[]'],
    ['invalid row', 'columns:[{key:"value"}],rows:[null]'],
    ['object cell', 'columns:[{key:"value"}],rows:[{value:{hidden:"content"}}]'],
    ['unknown column data', 'columns:[{key:"value",formatter:"unknown"}],rows:[]'],
  ])(
    'falls back instead of silently emitting an empty or incomplete table (%s)',
    (_, properties) => {
      const result = resultFor(`DIL.render(__dil.jsx("table",{${properties}}));`)
      expect(result).toMatchObject({
        status: 'fallback',
        format: 'markdown',
        text: 'Readable component demonstration',
      })
    },
  )

  it('reports an unsupported data property rather than hiding its content', () => {
    const result = resultFor('DIL.render(__dil.jsx("text",{data:"Important hidden content"}));')
    expect(result).toMatchObject({
      status: 'fallback',
      fallbackReason: 'unsupported-property',
      unsupportedProperties: ['text.data'],
    })
    expect(JSON.stringify(result)).not.toContain('Important hidden content')
  })

  it('distinguishes overall fallback, explicit local fallback and successful HTML', () => {
    expect(resultFor('DIL.render(__dil.jsx("map",null));')).toMatchObject({
      status: 'fallback',
      format: 'markdown',
      unsupportedComponents: ['map'],
    })
    const result = resultFor(
      'DIL.render(__dil.jsx(__dil.Fragment,null,__dil.jsx("text",null,"Before"),__dil.jsx("map",{fallback:__dil.jsx("text",null,"Chart data summary")}),__dil.jsx("text",null,"After")));',
    )
    expect(result).toMatchObject({
      status: 'partial',
      format: 'html',
      localFallbacks: 1,
      unsupportedComponents: ['map'],
    })
    expect(result.text).toContain('Before')
    expect(result.text).toContain('Chart data summary')
    expect(result.text).toContain('After')
  })

  it('interprets literal locals, conditional content and template labels without calling generated code', () => {
    const result = resultFor(
      'DIL.render(__dil.jsx(()=>{const items=[{label:"Alpha"}];return __dil.jsx("list",null,items.map(item=>__dil.jsx("list-item",null,item.label ? `Label: ${item.label}` : "Missing")));}));',
    )
    expect(result.status).toBe('rendered')
    expect(result.text).toContain('Label: Alpha')
  })

  it('ignores the unused native data-binding wrapper hook and rejects a view that actually depends on it', () => {
    const wrapper =
      'const __dilConstants=DIL.useConstants();const __dilModelDataBindings=DIL.useAppData(data=>data.opGenui?.modelDataBindings??{});'
    expect(
      resultFor(
        `DIL.render(__dil.jsx(()=>{${wrapper}return __dil.jsx("text",null,"Static body");}));`,
      ).status,
    ).toBe('rendered')
    expect(
      resultFor(
        `DIL.render(__dil.jsx(()=>{${wrapper}return __dil.jsx("text",null,__dilModelDataBindings.value);}));`,
      ).status,
    ).toBe('fallback')
  })

  it('keeps data properties when React-style children contain only null or false', () => {
    const result = resultFor(
      'DIL.render(__dil.jsx("table",{columns:[{key:"name"}],rows:[{name:"Visible row"}]},null,false));',
    )
    expect(result.status).toBe('rendered')
    expect(result.text).toContain('Visible row')
  })

  it('uses an explicit fallback when a known component has an unsupported data property', () => {
    const result = resultFor(
      'DIL.render(__dil.jsx("text",{data:"Hidden",fallback:__dil.jsx("text",null,"Readable replacement")}));',
    )
    expect(result).toMatchObject({
      status: 'partial',
      localFallbacks: 1,
      unsupportedProperties: ['text.data'],
    })
    expect(result.text).toContain('Readable replacement')
  })

  it('exports only the static view when a supported component contains an event handler', () => {
    const result = resultFor(
      'DIL.render(__dil.jsx("card",{onVisible:()=>{globalThis.genuiExecuted=true;fetch("https://example.com");}},"Visible content"));',
    )
    expect(result.status).toBe('rendered')
    expect(result.text).toContain('Visible content')
    expect(result.text).not.toContain('fetch')
    expect(globalThis.genuiExecuted).toBeUndefined()
  })

  it('does not activate unresolved/unapproved source cards', () => {
    const result = resultFor(
      'DIL.render(__dil.jsx(LinkCard,{url:"https://unapproved.example",title:"<script>"}));',
    )
    expect(result.text).toContain('&lt;script&gt;')
    expect(result.text).not.toContain('href=')
    expect(result.omittedLinks).toBe(1)
  })

  it.each([
    'DIL.render(__dil.jsx("flow-item",{aspectMode:"fixed",aspectRatio:"1 / 1;position:fixed"},"Body"));',
    'DIL.render(__dil.jsx("table-cell",{colSpan:99999},"Body"));',
    'DIL.render(__dil.jsx("grid-item",{span:"1;position:fixed"},"Body"));',
    'DIL.render(__dil.jsx("spacer",{minSize:"100vw"}));',
    'DIL.render(__dil.jsx("table",{columns:[{key:"constructor"}],rows:[{}]}));',
  ])('rejects invalid geometry, attribute values and prototype access', (code) => {
    expect(resultFor(code).status).toBe('fallback')
  })

  it('keeps array expansion bounded and gives a reason for unavailable HTML', () => {
    const message = staticComponentsMessage()
    message.metadata.model_dil_v2.constants.rows = Array(513).fill({ name: 'Alpha', value: 1 })
    expect(renderChatgptWebGenuiResult(message).status).toBe('fallback')
    delete message.metadata.model_dil_v2.fallbackMarkdown
    expect(renderChatgptWebGenuiResult(message)).toMatchObject({
      text: null,
      status: 'unavailable',
      fallbackReason: 'invalid-props',
    })
  })

  it('carries the same rendering facts through history and resume extraction', () => {
    const message = staticComponentsMessage()
    const presentation = extractChatgptWebMessagePresentation(message)
    const conversation = {
      conversation_id: 'demo',
      current_node: message.id,
      mapping: {
        'demo-user': {
          id: 'demo-user',
          parent: null,
          children: [message.id],
          message: {
            id: 'demo-user',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Component demonstration'] },
          },
        },
        [message.id]: { id: message.id, parent: 'demo-user', children: [], message },
      },
    }
    const snapshot = formatChatgptWebConversationSnapshot(conversation)
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('delta', { p: '', o: 'add', v: { message } })
    expect(snapshot.message.rendering).toEqual(presentation.rendering)
    expect(snapshot.messages[1].rendering).toEqual(presentation.rendering)
    expect(accumulator.getResult().bestMessage.rendering).toEqual(presentation.rendering)
    expect(snapshot.message.text).toBe(presentation.text)
  })

  it('ships the shared stylesheet and packaged runtime inside the standalone Drafts template', async () => {
    expect(await syncDraftsPreview({ check: true })).toBe(false)
    const template = fs.readFileSync(
      new URL('../docs/drafts/chatgptbox-preview.html', import.meta.url),
      'utf8',
    )
    expect(template).toContain('%%[[draft]]%%')
    expect(template).not.toMatch(/<script[^>]+src=|<link/i)
    expect(template).toContain("script-src 'sha256-")
    expect(template).toContain("default-src 'none'")
  }, 30000)
})
