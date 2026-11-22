import createDOMPurify from 'dompurify'
import mermaid from 'mermaid'

// Mermaid registers a window.load listener during import. Disable its automatic
// pass before awaiting any SVG image; our ordered pass owns the original code.
mermaid.initialize({ startOnLoad: false })

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_DIAGRAMS = 64
const MAX_SVG_LENGTH = 131072
const MAX_MERMAID_LENGTH = 50000
let nextId = 0

function language(pre) {
  const code = pre.firstElementChild
  if (code?.localName !== 'code') return null
  for (const element of [code, pre]) {
    for (const name of element.classList) {
      const match = /^(?:language-|lang-)?(svg|mermaid)$/i.exec(name)
      if (match) return match[1].toLowerCase()
    }
  }
  return null
}

// An image gives each SVG its own styles and IDs. Keep source SVGs out of the
// preview DOM; only Mermaid's trusted renderer uses a temporary measuring node.
export function prepareDiagramSvg(source, win, color, fontSize = '16px') {
  if (source.length > MAX_SVG_LENGTH) throw new Error('SVG 超过 131072 字符。')
  if (/<!DOCTYPE/i.test(source)) throw new Error('SVG 含有文档类型声明。')
  const parsed = new win.DOMParser().parseFromString(source, 'image/svg+xml')
  const root = parsed.documentElement
  if (
    parsed.querySelector('parsererror') ||
    root.localName !== 'svg' ||
    (root.namespaceURI && root.namespaceURI !== SVG_NS)
  )
    throw new Error('SVG 格式有误，请检查源码。')
  if (root.querySelector('foreignObject')) throw new Error('此图形含有 HTML 标签，请查看源码。')
  const clean = createDOMPurify(win).sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    FORBID_TAGS: ['foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set'],
    RETURN_DOM_FRAGMENT: true,
  })
  const svg = clean.firstElementChild
  if (svg?.localName !== 'svg') throw new Error('SVG 缺少有效的图形。')
  svg.setAttribute('xmlns', SVG_NS)
  // Only local symbol reuse is supported. Remote use can otherwise disappear
  // silently in image mode; report it through the original-source fallback.
  for (const use of svg.querySelectorAll('use')) {
    const href =
      use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (
      !href ||
      !/^#[^\s]+$/.test(href) ||
      ![...svg.querySelectorAll('[id]')].some((node) => node.id === href.slice(1))
    )
      throw new Error('SVG use 需要引用图形内已有的 #id。')
  }
  // SVG images inherit neither currentColor nor fonts from the surrounding page.
  if (!svg.style.color && !svg.hasAttribute('color')) svg.style.color = color
  if (!svg.style.fontFamily && !svg.hasAttribute('font-family'))
    svg.style.fontFamily = '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  if (!svg.style.fontSize && !svg.hasAttribute('font-size')) svg.style.fontSize = fontSize
  // Percentage-only dimensions have no intrinsic ratio in WebKit image mode.
  // A viewBox supplies that ratio while preserving absolute height/width choices.
  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    for (const [name, value] of [
      ['width', viewBox[2]],
      ['height', viewBox[3]],
    ]) {
      const dimension = svg.getAttribute(name)
      if (!dimension || dimension.endsWith('%')) svg.setAttribute(name, String(value))
    }
  }
  return new win.XMLSerializer().serializeToString(svg)
}

export async function renderMermaidSvg(source, container, dark) {
  // Lock every configuration key, including nested htmlLabels and themeCSS.
  // Per-diagram directives/frontmatter remain data, not preview configuration.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    theme: dark ? 'dark' : 'default',
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    maxTextSize: MAX_MERMAID_LENGTH,
    maxEdges: 500,
    // Optional keys such as htmlLabels are absent from defaultConfig's keys.
    secure: [
      ...Object.keys(mermaid.mermaidAPI.defaultConfig),
      'htmlLabels',
      'altFontFamily',
      'dompurifyConfig',
    ],
  })
  const { svg } = await mermaid.render('chatgptbox-diagram-' + ++nextId, source, container)
  return svg
}

export function mountDraftsCodeDiagrams(root, dark, { renderMermaid = renderMermaidSvg } = {}) {
  const doc = root.ownerDocument
  const win = doc.defaultView
  const mounted = []
  let disposed = false
  let cancelImage = () => {}

  const ready = (async () => {
    let count = 0
    for (const pre of root.querySelectorAll('pre')) {
      if (disposed) break
      const type = language(pre)
      if (!type || pre.closest('.chatgptbox-code-diagram')) continue
      const source = pre.textContent
      const figure = doc.createElement('figure')
      figure.className = 'chatgptbox-code-diagram'
      const status = doc.createElement('p')
      status.className = 'chatgptbox-code-diagram-status'
      status.setAttribute('role', 'status')
      status.textContent = '正在渲染 ' + (type === 'svg' ? 'SVG' : 'Mermaid') + '…'
      const details = doc.createElement('details')
      details.open = true
      const summary = doc.createElement('summary')
      summary.textContent = (type === 'svg' ? 'SVG' : 'Mermaid') + ' 源码'
      pre.before(figure)
      details.append(summary, pre)
      figure.append(status, details)
      mounted.push({ figure, pre })
      let scratch
      try {
        if (++count > MAX_DIAGRAMS) throw new Error('每页最多预览 64 个图形。')
        if (type === 'mermaid' && source.length > MAX_MERMAID_LENGTH)
          throw new Error('Mermaid 超过 50000 字符。')
        let svg = source
        if (type === 'mermaid') {
          scratch = doc.createElement('div')
          scratch.className = 'chatgptbox-code-diagram-measure'
          scratch.setAttribute('aria-hidden', 'true')
          scratch.style.width = Math.max(240, root.clientWidth) + 'px'
          doc.body.append(scratch)
          svg = await renderMermaid(source, scratch, dark)
        }
        if (disposed) break
        const textStyle = win.getComputedStyle(root)
        svg = prepareDiagramSvg(svg, win, textStyle.color, textStyle.fontSize)
        const image = doc.createElement('img')
        image.alt = type === 'svg' ? 'SVG 图形；源码见下方。' : 'Mermaid 图形；源码见下方。'
        image.className = 'chatgptbox-code-diagram-image'
        const viewport = doc.createElement('div')
        viewport.className = 'chatgptbox-code-diagram-viewport'
        viewport.tabIndex = 0
        viewport.setAttribute('role', 'group')
        viewport.setAttribute('aria-label', '图形预览，宽图可横向滚动。')
        viewport.append(image)
        await new Promise((resolve, reject) => {
          const finish = (error) => {
            image.onload = image.onerror = null
            cancelImage = () => {}
            if (error) reject(error)
            else resolve()
          }
          cancelImage = () => finish()
          image.onload = () => finish()
          image.onerror = () => finish(new Error('图形加载失败，请查看源码。'))
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
          status.before(viewport)
        })
        if (disposed) break
        details.open = false
        status.remove()
      } catch (error) {
        status.textContent = '图形预览失败：' + String(error.message || error).slice(0, 200)
        details.open = true
        figure.querySelector('.chatgptbox-code-diagram-viewport')?.remove()
      } finally {
        scratch?.remove()
      }
    }
  })()

  return {
    ready,
    dispose() {
      disposed = true
      cancelImage()
      for (const { figure, pre } of mounted) figure.replaceWith(pre)
    },
  }
}
