import { describe, expect, it } from 'vitest'
import { sanitizeMarkdownTree } from '../src/components/MarkdownRender/sanitize-markdown-tree.mjs'

function el(tagName, properties = {}, children = []) {
  return { type: 'element', tagName, properties, children }
}

function sanitize(tree) {
  const fn = sanitizeMarkdownTree()
  fn(tree)
  return tree
}

// The katex-enabled pipeline (markdown.jsx) is the only caller that opts in.
function sanitizeWithKatex(tree) {
  const fn = sanitizeMarkdownTree({ allowKatexStyles: true })
  fn(tree)
  return tree
}

describe('sanitizeMarkdownTree', () => {
  it('strips on* event handler attributes', () => {
    const tree = el('a', { href: 'https://example.com', onClick: 'alert(1)' })
    sanitize(tree)
    expect(tree.properties.onClick).toBeUndefined()
    expect(tree.properties.href).toBe('https://example.com')
  })

  it('strips inline style attributes', () => {
    const tree = el('div', { className: 'ok', style: 'color:red' })
    sanitize(tree)
    expect(tree.properties.style).toBeUndefined()
    expect(tree.properties.className).toBe('ok')
  })

  it('rejects javascript: URLs in href', () => {
    const tree = el('a', { href: 'javascript:alert(1)' })
    sanitize(tree)
    expect(tree.properties.href).toBeUndefined()
  })

  it('rejects vbscript: URLs in href', () => {
    const tree = el('a', { href: 'vbscript:msgbox(1)' })
    sanitize(tree)
    expect(tree.properties.href).toBeUndefined()
  })

  it('rejects non-image data: URLs in src', () => {
    const tree = el('img', { src: 'data:text/html,<script>alert(1)</script>' })
    sanitize(tree)
    expect(tree.properties.src).toBeUndefined()
  })

  it('accepts image data: URLs in src', () => {
    const tree = el('img', { src: 'data:image/png;base64,iVBORw0K' })
    sanitize(tree)
    expect(tree.properties.src).toBe('data:image/png;base64,iVBORw0K')
  })

  it('strips attributes not in the allowlist for a tag', () => {
    const tree = el('a', { href: '/ok', sandbox: 'allow-scripts', target: '_blank' })
    sanitize(tree)
    expect(tree.properties.sandbox).toBeUndefined()
    expect(tree.properties.target).toBeUndefined()
    expect(tree.properties.href).toBe('/ok')
  })

  it('recurses into children', () => {
    const tree = el('div', {}, [
      el('a', { href: 'javascript:bad()', className: 'keep' }),
      el('img', { src: 'javascript:bad()' }),
    ])
    sanitize(tree)
    expect(tree.children[0].properties.href).toBeUndefined()
    expect(tree.children[0].properties.className).toBe('keep')
    expect(tree.children[1].properties.src).toBeUndefined()
  })

  it('ignores non-element nodes', () => {
    const tree = { type: 'text', value: 'plain text' }
    expect(() => sanitize(tree)).not.toThrow()
  })

  it('strips an uppercase STYLE attribute', () => {
    const tree = el('div', { STYLE: 'color:red' })
    sanitize(tree)
    expect(tree.properties.STYLE).toBeUndefined()
  })
})

describe('sanitizeMarkdownTree with allowKatexStyles', () => {
  it('keeps KaTeX layout styles inside a katex subtree', () => {
    const tree = el('span', { className: ['katex'] }, [
      el('span', { className: ['strut'], style: 'height:0.8em;vertical-align:-0.2em' }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBe('height:0.8em;vertical-align:-0.2em')
  })

  it('keeps the colour declarations KaTeX emits for \\textcolor and \\fbox', () => {
    const tree = el('span', { className: ['katex'] }, [
      el('span', {
        style: 'color:#cc0000;background-color:#eee;border-style:solid;border-width:0.04em',
      }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBe(
      'color:#cc0000;background-color:#eee;border-style:solid;border-width:0.04em',
    )
  })

  it('drops declarations KaTeX never emits inline', () => {
    const tree = el('span', { className: ['katex'] }, [
      el('span', { style: 'height:1em;display:block;transform:scale(40);font-family:Impact' }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBe('height:1em')
  })

  it('keeps position:relative but rejects position:fixed and absolute', () => {
    const relative = el('span', { className: ['katex'] }, [
      el('span', { style: 'position:relative;top:-0.2em' }),
    ])
    sanitizeWithKatex(relative)
    expect(relative.children[0].properties.style).toBe('position:relative;top:-0.2em')

    for (const value of ['fixed', 'absolute', 'sticky', 'FIXED']) {
      const tree = el('span', { className: ['katex'] }, [
        el('span', { style: `position:${value};top:0;left:0;width:100%;height:100%` }),
      ])
      sanitizeWithKatex(tree)
      expect(tree.children[0].properties.style).toBe('top:0;left:0;width:100%;height:100%')
    }
  })

  it('rejects a katex style that carries a url() reference', () => {
    const tree = el('span', { className: ['katex'] }, [
      el('span', { style: 'height:1em;background-image:url(https://evil.example/x.png)' }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBeUndefined()
  })

  it('rejects viewport units and calc(), which KaTeX never emits', () => {
    for (const value of ['width:100vw', 'height:100vh', 'top:50vmin', 'left:calc(100% - 2px)']) {
      const tree = el('span', { className: ['katex'] }, [el('span', { style: value })])
      sanitizeWithKatex(tree)
      expect(tree.children[0].properties.style).toBeUndefined()
    }
  })

  it('bounds displacement so position:relative cannot become a transcript overlay', () => {
    // The overlay shape the sanitizer has to refuse: a relatively positioned,
    // opaque box dragged far enough to paint over earlier conversation turns.
    const tree = el('span', { className: ['katex'] }, [
      el('span', {
        style: 'position:relative;top:-600px;left:-400px;background-color:#ffffff;height:80em',
      }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBe(
      'position:relative;background-color:#ffffff;height:80em',
    )
  })

  it('keeps the small typographic offsets KaTeX actually emits', () => {
    const tree = el('span', { className: ['katex'] }, [
      el('span', { style: 'top:-0.2em;margin-left:-0.1667em;vertical-align:-0.35em' }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBe(
      'top:-0.2em;margin-left:-0.1667em;vertical-align:-0.35em',
    )
  })

  it('sanitizes rather than drops an uppercase STYLE inside a katex subtree', () => {
    const tree = el('span', { className: ['katex'] }, [
      el('span', { STYLE: 'height:0.8em;position:fixed' }),
    ])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.STYLE).toBe('height:0.8em')
  })

  it('still strips style outside a katex subtree', () => {
    const tree = el('span', { className: ['not-math'] }, [el('span', { style: 'height:1em' })])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBeUndefined()
  })

  it('does not treat a katex-lookalike class as a math root', () => {
    const tree = el('span', { className: ['katex-ish'] }, [el('span', { style: 'height:1em' })])
    sanitizeWithKatex(tree)
    expect(tree.children[0].properties.style).toBeUndefined()
  })

  it('strips every style when the option is off, even inside a katex subtree', () => {
    const tree = el('span', { className: ['katex'] }, [el('span', { style: 'height:0.8em' })])
    sanitize(tree)
    expect(tree.children[0].properties.style).toBeUndefined()
  })
})
