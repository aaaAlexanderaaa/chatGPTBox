/* eslint-env node */
import { JSDOM } from 'jsdom'
import mermaid from 'mermaid'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mountDraftsCodeDiagrams,
  prepareDiagramSvg,
  renderMermaidSvg,
} from '../src/components/MarkdownRender/drafts-code-diagrams.mjs'

const svg =
  '<svg viewBox="0 0 280 36" width="100%" height="36px" xmlns="http://www.w3.org/2000/svg"><path d="M0 0L280 36" stroke="currentColor"/></svg>'
const windows = []
function fixture(blocks, { load = true } = {}) {
  const dom = new JSDOM('<main style="color:rgb(232, 237, 242)"></main>')
  windows.push(dom.window)
  const doc = dom.window.document
  const root = doc.querySelector('main')
  for (const [language, source, onPre] of blocks) {
    const pre = doc.createElement('pre')
    const code = doc.createElement('code')
    ;(onPre ? pre : code).className = language
    code.textContent = source
    pre.append(code)
    root.append(pre)
  }
  // jsdom has no SVG image decoder. Exercise the DOM load/error boundary here;
  // native Preview acceptance separately covers actual SVG and Mermaid pixels.
  if (load) {
    const create = doc.createElement.bind(doc)
    vi.spyOn(doc, 'createElement').mockImplementation((name, ...args) => {
      const element = create(name, ...args)
      if (name === 'img')
        Object.defineProperty(element, 'src', {
          set(value) {
            this.setAttribute('src', value)
            queueMicrotask(() => this.dispatchEvent(new dom.window.Event('load')))
          },
        })
      return element
    })
  }
  return { root, win: dom.window }
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const win of windows.splice(0)) win.close()
})

describe('Drafts code-block diagrams', () => {
  it('disables Mermaid auto-start before the first image load can replace original source', () => {
    expect(mermaid.mermaidAPI.getConfig().startOnLoad).toBe(false)
  })
  it.each([
    '---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n  theme: dark\n  themeCSS: body{background:red}\n  fontFamily: unexpected-font\n---\n',
    '%%{init: {"securityLevel":"loose","htmlLabels":true,"theme":"dark","themeCSS":"body{background:red}","fontFamily":"unexpected-font"}}%%\n',
  ])('keeps host settings when Mermaid processes source configuration (%s)', async (prefix) => {
    const { root } = fixture([])
    vi.spyOn(mermaid, 'render').mockResolvedValue({ svg })
    await renderMermaidSvg('flowchart LR\n A-->B', root, false)
    await mermaid.parse(prefix + 'flowchart LR\n A-->B')
    const config = mermaid.mermaidAPI.getConfig()
    expect(config).toMatchObject({ securityLevel: 'strict', htmlLabels: false, theme: 'default' })
    expect(config.themeCSS).toBeUndefined()
    expect(config.fontFamily).not.toContain('unexpected-font')
  })
  it('keeps viewBox, absolute height and theme currentColor in an independent SVG image', () => {
    const { win } = fixture([])
    const output = prepareDiagramSvg(svg, win, 'rgb(232, 237, 242)')
    const image = new win.DOMParser().parseFromString(output, 'image/svg+xml').documentElement
    expect(image.getAttribute('viewBox')).toBe('0 0 280 36')
    expect(image.getAttribute('width')).toBe('280')
    expect(image.getAttribute('height')).toBe('36px')
    expect(image.style.color).toBe('rgb(232, 237, 242)')
    expect(image.querySelector('path').getAttribute('stroke')).toBe('currentColor')
    expect(image.namespaceURI).toBe('http://www.w3.org/2000/svg')
  })

  it('retains gradients, local references, style and the author color while cleaning active content', () => {
    const { win } = fixture([])
    const output = prepareDiagramSvg(
      `<svg viewBox="0 0 100 50" style="color: red" onload="alert(1)">
      <style>.box { fill: url(#paint); }</style>
      <defs><linearGradient id="paint"><stop offset="0" stop-color="blue"/></linearGradient></defs>
      <rect class="box" width="100" height="50" onclick="alert(1)"/>
      <script>alert(1)</script>
      <set attributeName="onload" to="alert(1)"/>
    </svg>`,
      win,
      'white',
    )
    expect(output).toContain('linearGradient')
    expect(output).toContain('url(#paint)')
    expect(output).toContain('color: red')
    expect(output).not.toMatch(/onload|onclick|<script|foreignObject|<set|active HTML/i)
  })

  it('preserves local use/symbol reuse and falls back for unavailable external symbols', () => {
    const { win } = fixture([])
    const source =
      '<svg viewBox="0 0 80 80"><defs><symbol id="dot"><circle r="10"/></symbol></defs><use href="#dot" x="40" y="40"/></svg>'
    const output = prepareDiagramSvg(source, win, 'black')
    expect(output).toContain('<use')
    expect(output).toContain('href="#dot"')
    expect(() =>
      prepareDiagramSvg(source.replace('#dot', 'https://example.com/s.svg#dot'), win, 'black'),
    ).toThrow('图形内已有')
    expect(() => prepareDiagramSvg(source.replace('#dot', '#missing'), win, 'black')).toThrow(
      '图形内已有',
    )
  })

  it.each([
    '<svg><path></svg>',
    '<html><body>text</body></html>',
    '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML label</div></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY x "entity">]><svg>&x;</svg>',
    '<svg>' + 'x'.repeat(131072) + '</svg>',
  ])('preserves the original block when SVG validation fails', async (source) => {
    const { root } = fixture([['svg', source]])
    const view = mountDraftsCodeDiagrams(root, false)
    await view.ready
    expect(root.querySelector('details').open).toBe(true)
    expect(root.querySelector('pre').textContent).toBe(source)
    expect(root.querySelector('[role="status"]').textContent).toContain('图形预览失败')
    expect(root.querySelector('img')).toBeNull()
  })

  it.each(['svg', 'language-svg', 'lang-SVG'])(
    'recognizes %s on MultiMarkdown code and pre elements without changing ordinary code',
    async (language) => {
      const { root } = fixture([
        [language, svg],
        [language, svg, true],
        ['html', svg],
      ])
      const view = mountDraftsCodeDiagrams(root, false)
      await view.ready
      expect(root.querySelectorAll('img')).toHaveLength(2)
      expect(root.querySelectorAll('details[open]')).toHaveLength(0)
      expect(root.lastElementChild.localName).toBe('pre')
      expect(root.lastElementChild.textContent).toBe(svg)
      expect(root.querySelector('svg')).toBeNull()
      view.dispose()
      expect(root.querySelectorAll(':scope > pre')).toHaveLength(3)
      expect(root.querySelector('figure')).toBeNull()
    },
  )

  it('continues after a Mermaid error, keeps exact source and cleans measuring elements', async () => {
    const { root } = fixture([
      ['language-mermaid', 'flowchart LR\n  A --> B'],
      ['mermaid', 'invalid graph'],
      ['lang-mermaid', 'sequenceDiagram\n  A->>B: 中文'],
    ])
    const renderMermaid = vi.fn(async (source) => {
      if (source === 'invalid graph') throw new Error('Parse error')
      return svg
    })
    const view = mountDraftsCodeDiagrams(root, true, { renderMermaid })
    await view.ready
    expect(renderMermaid).toHaveBeenCalledTimes(3)
    expect(renderMermaid.mock.calls.every((call) => call[2] === true)).toBe(true)
    expect(root.querySelectorAll('img')).toHaveLength(2)
    expect([...root.querySelectorAll('details')].map((d) => d.open)).toEqual([false, true, false])
    expect(root.querySelectorAll('pre')[2].textContent).toBe('sequenceDiagram\n  A->>B: 中文')
    expect(root.ownerDocument.querySelector('.chatgptbox-code-diagram-measure')).toBeNull()
  })

  it('keeps source open until image load and falls back when WebKit reports a decode error', async () => {
    const { root, win } = fixture(
      [
        ['svg', svg],
        ['svg', svg],
      ],
      { load: false },
    )
    const view = mountDraftsCodeDiagrams(root, false)
    expect(root.querySelector('details').open).toBe(true)
    root.querySelector('img').dispatchEvent(new win.Event('error'))
    await vi.waitFor(() => expect(root.querySelectorAll('img')).toHaveLength(1))
    root.querySelector('img').dispatchEvent(new win.Event('load'))
    await view.ready
    expect([...root.querySelectorAll('details')].map((d) => d.open)).toEqual([true, false])
    expect(root.querySelector('[role="status"]').textContent).toContain('图形加载失败')
  })

  it('discards an old theme render after disposal and restores each original block once', async () => {
    const { root } = fixture([['mermaid', 'flowchart LR\n  A --> B']])
    let finish
    const view = mountDraftsCodeDiagrams(root, false, {
      renderMermaid: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    view.dispose()
    finish(svg)
    await view.ready
    expect(root.querySelectorAll(':scope > pre')).toHaveLength(1)
    expect(root.querySelector('img')).toBeNull()
    expect(root.ownerDocument.querySelector('.chatgptbox-code-diagram-measure')).toBeNull()
  })

  it('bounds diagram count and Mermaid source size before calling the renderer', async () => {
    const { root } = fixture([
      ...Array.from({ length: 64 }, () => ['svg', svg]),
      ['mermaid', 'flowchart LR\n A-->B'],
    ])
    const renderMermaid = vi.fn()
    await mountDraftsCodeDiagrams(root, false, { renderMermaid }).ready
    expect(root.querySelectorAll('img')).toHaveLength(64)
    expect(root.lastElementChild.textContent).toContain('每页最多预览 64 个图形')
    expect(renderMermaid).not.toHaveBeenCalled()
    const large = fixture([['mermaid', 'x'.repeat(50001)]])
    await mountDraftsCodeDiagrams(large.root, false, { renderMermaid }).ready
    expect(renderMermaid).not.toHaveBeenCalled()
    expect(large.root.querySelector('pre').textContent).toHaveLength(50001)
  })
})
