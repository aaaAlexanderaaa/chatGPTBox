/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  renderDraftsMath,
  scanMathSegments,
  wrapDraftsTables,
} from '../src/components/MarkdownRender/drafts-math-runtime.mjs'
import { protectDraftsScript } from '../scripts/sync-drafts-preview.mjs'

function mount(html) {
  const dom = new JSDOM(`<!doctype html><html><body><main>${html}</main></body></html>`)
  const main = dom.window.document.querySelector('main')
  return { dom, main }
}

describe('Drafts HTML preview LaTeX math and common rendering', () => {
  it('renders inline and display LaTeX delimiters to native MathML', () => {
    const { dom, main } = mount(`
      <p>Inline $E = mc^2$ and \\(\\alpha + \\beta\\).</p>
      <p>$$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$</p>
      <p>\\[\\sum_{i=1}^n x_i\\]</p>
      <p>\\begin{align*}a &= 1 \\\\ b &= 2\\end{align*}</p>
    `)
    const count = renderDraftsMath(main)
    expect(count).toBe(5)
    expect(main.querySelectorAll('math')).toHaveLength(5)
    expect(main.querySelectorAll('.chatgptbox-math-display')).toHaveLength(3)
    expect(main.querySelectorAll('math[display="block"]')).toHaveLength(3)
    expect(main.textContent).not.toContain('$$')
    expect(main.textContent).not.toContain('\\[')
    expect(main.textContent).not.toContain('\\(')
    dom.window.close()
  })

  it('renders MultiMarkdown span.math, div.math, fenced ```math, and chatgptbox-math while leaving code blocks untouched', () => {
    const { dom, main } = mount(`
      <p><span class="math">\\(x^2 + y^2 = r^2\\)</span></p>
      <p><span class="math">\\[\\int_0^1 x\\,dx = \\frac{1}{2}\\]</span></p>
      <div class="math">\\boxed{F = ma}</div>
      <pre><code class="language-math">\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}</code></pre>
      <p>Gemini math: <code class="chatgptbox-math">\\nabla \\cdot E = \\frac{\\rho}{\\varepsilon_0}</code></p>
      <p>Normal code: <code>$HOME</code> and <code>$a + $b</code></p>
      <pre><code class="language-latex">\\frac{1}{2}</code></pre>
      <pre><code>$$not math$$</code></pre>
    `)
    const count = renderDraftsMath(main)
    expect(count).toBe(5)
    expect(main.querySelectorAll('math')).toHaveLength(5)
    expect(main.querySelectorAll('.chatgptbox-math-display')).toHaveLength(3)
    expect(main.querySelector('pre > code.language-latex')?.textContent).toBe('\\frac{1}{2}')
    expect(main.querySelectorAll('code')).toHaveLength(4)
    expect(main.textContent).toContain('$HOME')
    expect(main.textContent).toContain('$$not math$$')
    dom.window.close()
  })

  it('recovers multi-line block math split by <br> and CommonMark-eaten row breaks and cmark-gfm <em> subscripts', () => {
    const { dom, main } = mount(`
      <p><em>Keep</em>: $x<em>1 + y</em>2 = z$ and <em>italic</em></p>
      <p>$$<br>\\begin{aligned}<br>a<em>1 &= b</em>1 \\<br>a<em>2 &= b</em>2<br>\\end{aligned}<br>$$</p>
    `)
    const count = renderDraftsMath(main)
    expect(count).toBe(2)
    expect(main.querySelectorAll('math')).toHaveLength(2)
    const remainingEm = [...main.querySelectorAll('em')].map((el) => el.textContent)
    expect(remainingEm).toEqual(['Keep', 'italic'])
    const displayMath = main.querySelector('.chatgptbox-math-display math')
    expect(displayMath?.querySelectorAll('mtr').length).toBe(2)
    dom.window.close()
  })

  it('does not misparse currency amounts, spaces around $, or escaped dollars as LaTeX', () => {
    const { dom, main } = mount(`
      <p>Costs $100 to $200, or $5-$10.</p>
      <p>Price is $50, and formula is $x^2 + 1$.</p>
      <p>Spaced $ a + b $ and escaped \\$x\\$.</p>
      <p>Price is $10 and <em>discount</em> is $5.</p>
    `)
    const count = renderDraftsMath(main)
    expect(count).toBe(1)
    expect(main.querySelectorAll('math')).toHaveLength(1)
    expect(main.querySelector('math annotation')?.textContent).toBe('x^2 + 1')
    expect(main.textContent).toContain('Costs $100 to $200, or $5-$10.')
    expect(main.textContent).toContain('Price is $50, and formula is')
    expect(main.textContent).toContain('Spaced $ a + b $')
    expect(main.querySelector('em')?.textContent).toBe('discount')
    dom.window.close()
  })

  it('blocks untrusted TeX commands and leaves invalid inline $...$ prose untouched', () => {
    const { dom, main } = mount(`
      <p>$$\\href{javascript:alert(1)}{click}$$</p>
      <p>Not valid TeX: $\\unknowncommand{x}$ stays literal.</p>
    `)
    renderDraftsMath(main)
    expect(main.querySelector('a, [href]')).toBeNull()
    expect(main.querySelector('math mtext')?.textContent).toBe('\\href')
    expect(main.textContent).toContain('Not valid TeX: $\\unknowncommand{x}$ stays literal.')
    dom.window.close()
  })

  it('wraps non-GenUI tables (including nested Gemini tables) for horizontal scroll without duplicating GenUI wrappers', () => {
    const { dom, main } = mount(`
      <div><table><tr><td>Gemini cell</td></tr></table></div>
      <div class="chatgptbox-genui-table-scroll"><table class="chatgptbox-genui-table"><tr><td>GenUI</td></tr></table></div>
    `)
    wrapDraftsTables(main)
    expect(main.querySelectorAll('.chatgptbox-table-scroll')).toHaveLength(1)
    expect(main.querySelector('.chatgptbox-table-scroll > table')?.textContent).toContain(
      'Gemini cell',
    )
    expect(main.querySelectorAll('.chatgptbox-genui-table-scroll')).toHaveLength(1)
    dom.window.close()
  })

  it('handles delimiter scanning edge cases accurately', () => {
    expect(scanMathSegments('$10 and $20')).toEqual([])
    expect(scanMathSegments('Cost $50, then $a+b$')).toMatchObject([{ tex: 'a+b', display: false }])
  })

  it('protects Drafts delimiters inside strings, templates, and regexes without altering semantics', () => {
    const src =
      'globalThis.out = { a: "{{x}}", b: `{{y}} [[z]] %%w%%`, r1: /[[]/.test("["), r2: /[{{]/.test("{"), r3: /%%/.test("%%") };'
    const safe = protectDraftsScript(src)
    expect(safe).not.toMatch(/\[\[|\{\{|%%|<\/script/i)
    const origCtx = {}
    const safeCtx = {}
    vm.runInNewContext(src, origCtx)
    vm.runInNewContext(safe, safeCtx)
    expect(safeCtx.out).toEqual(origCtx.out)
  })

  it('executes the actual packaged offline preview script to render LaTeX MathML and wrap tables', () => {
    const template = fs.readFileSync(
      new URL('../docs/drafts/templates/chatgptbox-preview.html', import.meta.url),
      'utf8',
    )
    expect(template).toContain('The MIT License (MIT)')
    const match = template.match(/<script>([\s\S]*?)<\/script>/)
    expect(match).toBeTruthy()
    const renderedHtml = template
      .replace(/<script>[\s\S]*?<\/script>/, '')
      .replace(
        '%%[[draft]]%%',
        () =>
          '<p>Inline $a^2 + b^2 = c^2$</p><p>$$\\frac{1}{2}$$</p><div><table><tr><td>T</td></tr></table></div>',
      )
    const dom = new JSDOM(renderedHtml, { url: 'https://example.invalid/' })
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {} })
    const context = vm.createContext({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      DOMParser: dom.window.DOMParser,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
      cancelAnimationFrame: clearTimeout,
      console,
    })
    vm.runInContext(match[1], context)
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
    const main = dom.window.document.querySelector('main')
    expect(main.querySelectorAll('math')).toHaveLength(2)
    expect(main.querySelectorAll('.chatgptbox-math-display')).toHaveLength(1)
    expect(main.querySelectorAll('.chatgptbox-table-scroll')).toHaveLength(1)
    dom.window.close()
  })
})
