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
})
