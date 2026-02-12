import { getExtractedContentWithMetadata } from './get-core-content-text.mjs'

const MAX_CONTENT_CHARS = 3200
const MAX_HEADINGS = 12
const MAX_FONTS = 8
const MAX_COLORS = 12
const MAX_STYLE_SAMPLE_ELEMENTS = 180
const MAX_DOM_TREE_LINES = 280
const MAX_INTERACTIVE_ELEMENTS = 60
const MAX_LINKS = 48
const MAX_FULL_HTML_CHARS = 40000
const MAX_BODY_HTML_CHARS = 26000

function normalizeText(value, maxLength = 400) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text
}

function normalizeColor(value) {
  const color = normalizeText(value, 64)
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return ''
  return color
}

function getMetaContent(name) {
  const element = document.querySelector(`meta[name="${name}"]`)
  return normalizeText(element?.getAttribute('content') || '', 400)
}

function collectHeadingPreview() {
  return Array.from(document.querySelectorAll('h1, h2, h3'))
    .map((element) => normalizeText(element.textContent || '', 120))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS)
}

function collectFontFamilies() {
  const selectors = ['body', 'h1', 'h2', 'h3', 'p', 'button', 'nav', 'main']
  const families = new Set()

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (!element) continue
    const family = normalizeText(getComputedStyle(element).fontFamily || '', 120)
    if (!family) continue
    families.add(family)
    if (families.size >= MAX_FONTS) break
  }

  return Array.from(families)
}

function collectColorPalette() {
  const counts = new Map()
  const sample = document.querySelectorAll(
    'body, main, header, nav, section, article, aside, footer, button, a, h1, h2, h3, p, span, div',
  )
  const sampleSize = Math.min(sample.length, MAX_STYLE_SAMPLE_ELEMENTS)

  for (let index = 0; index < sampleSize; index += 1) {
    const style = getComputedStyle(sample[index])
    for (const color of [style.color, style.backgroundColor, style.borderColor]) {
      const normalized = normalizeColor(color)
      if (!normalized) continue
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_COLORS)
    .map(([color]) => color)
}

function nodeLabel(element) {
  const tag = String(element.tagName || '').toLowerCase()
  const id = element.id ? `#${element.id.slice(0, 24)}` : ''
  const classNames = typeof element.className === 'string' ? element.className.trim().split(/\s+/) : []
  const classSuffix = classNames
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => `.${name.slice(0, 20)}`)
    .join('')
  const role = element.getAttribute('role')
  const roleSuffix = role ? ` [role=${role.slice(0, 20)}]` : ''
  const text = normalizeText(element.textContent || '', 56)
  const textSuffix = text ? ` "${text}"` : ''
  return `${tag}${id}${classSuffix}${roleSuffix}${textSuffix}`
}

function buildDomTreeSummary(root) {
  if (!root) return ''
  const lines = []
  const stack = [{ node: root, depth: 0 }]

  while (stack.length > 0 && lines.length < MAX_DOM_TREE_LINES) {
    const current = stack.pop()
    if (!current?.node) continue
    if (current.depth > 8) continue

    const element = current.node
    lines.push(`${'  '.repeat(current.depth)}- ${nodeLabel(element)}`)

    const children = Array.from(element.children || [])
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 })
    }
  }

  if (stack.length > 0) lines.push('...[dom tree truncated]')
  return lines.join('\n')
}

function collectInteractiveElements() {
  const selectors = 'a[href], button, input, select, textarea, [role="button"], [tabindex]'
  return Array.from(document.querySelectorAll(selectors))
    .slice(0, MAX_INTERACTIVE_ELEMENTS)
    .map((element) => {
      const tag = String(element.tagName || '').toLowerCase()
      const id = element.id ? `#${element.id.slice(0, 20)}` : ''
      const role = element.getAttribute('role')
      const roleSegment = role ? ` role=${role.slice(0, 20)}` : ''
      const label = normalizeText(
        element.textContent ||
          element.getAttribute('aria-label') ||
          element.getAttribute('placeholder') ||
          '',
        80,
      )
      const href = normalizeText(element.getAttribute('href') || '', 120)
      const suffix = []
      if (label) suffix.push(`label="${label}"`)
      if (href) suffix.push(`href="${href}"`)
      return `- ${tag}${id}${roleSegment}${suffix.length > 0 ? ` (${suffix.join(', ')})` : ''}`
    })
    .join('\n')
}

function collectLinksSummary() {
  return Array.from(document.querySelectorAll('a[href]'))
    .map((element) => {
      const label = normalizeText(element.textContent || element.getAttribute('aria-label') || '', 100)
      const href = normalizeText(element.getAttribute('href') || '', 260)
      if (!href) return ''
      return label ? `- ${label}: ${href}` : `- ${href}`
    })
    .filter(Boolean)
    .slice(0, MAX_LINKS)
    .join('\n')
}

function buildStyleSummary(design) {
  const lines = []
  if (Array.isArray(design.fonts) && design.fonts.length > 0) {
    lines.push(`Fonts: ${design.fonts.join(', ')}`)
  }
  if (Array.isArray(design.palette) && design.palette.length > 0) {
    lines.push(`Color tokens: ${design.palette.join(', ')}`)
  }
  if (design.bodyTextColor) lines.push(`Body text: ${design.bodyTextColor}`)
  if (design.bodyBackgroundColor) lines.push(`Body background: ${design.bodyBackgroundColor}`)
  if (design.baseFontSize) lines.push(`Base font-size: ${design.baseFontSize}`)
  if (design.baseLineHeight) lines.push(`Base line-height: ${design.baseLineHeight}`)
  if (design.viewport) lines.push(`Viewport: ${design.viewport}`)
  const counts = [
    ['links', Number(design.linkCount)],
    ['buttons', Number(design.buttonCount)],
    ['images', Number(design.imageCount)],
    ['sections', Number(design.sectionCount)],
  ].filter(([, value]) => Number.isFinite(value) && value >= 0)
  if (counts.length > 0) {
    lines.push(`Element counts: ${counts.map(([name, value]) => `${name}=${value}`).join(', ')}`)
  }
  return lines.join('\n')
}

function safeFullHtml() {
  return normalizeText(document.documentElement?.outerHTML || '', MAX_FULL_HTML_CHARS)
}

function safeBodyHtml() {
  return normalizeText(document.body?.innerHTML || '', MAX_BODY_HTML_CHARS)
}

export function canCapturePageContextSnapshot() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  return window.location?.protocol === 'http:' || window.location?.protocol === 'https:'
}

export function buildPageContextSnapshot(customExtractors = [], options = {}) {
  if (!canCapturePageContextSnapshot()) return null

  let extracted = null
  try {
    extracted = getExtractedContentWithMetadata(
      Array.isArray(customExtractors) ? customExtractors : [],
    )
  } catch (error) {
    console.debug('Failed to extract page content for agent context:', error)
  }

  const bodyStyle = getComputedStyle(document.body || document.documentElement)

  const design = {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    bodyBackgroundColor: normalizeColor(bodyStyle.backgroundColor),
    bodyTextColor: normalizeColor(bodyStyle.color),
    baseFontSize: normalizeText(bodyStyle.fontSize || '', 32),
    baseLineHeight: normalizeText(bodyStyle.lineHeight || '', 32),
    fonts: collectFontFamilies(),
    palette: collectColorPalette(),
    headingPreview: collectHeadingPreview(),
    linkCount: document.querySelectorAll('a').length,
    buttonCount: document.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]',
    ).length,
    imageCount: document.querySelectorAll('img, svg, picture').length,
    sectionCount: document.querySelectorAll('section, article, main, nav, aside, header, footer')
      .length,
  }

  const context = {
    capturedAt: new Date().toISOString(),
    url: normalizeText(window.location.href, 400),
    title: normalizeText(document.title, 240),
    description: getMetaContent('description'),
    language: normalizeText(document.documentElement?.lang || '', 40),
    extraction: {
      method: normalizeText(extracted?.metadata?.method || '', 80),
      selector: normalizeText(extracted?.metadata?.selector || '', 160),
      matchedRule: normalizeText(extracted?.metadata?.matchedRule || '', 120),
    },
    content: normalizeText(extracted?.content || '', MAX_CONTENT_CHARS),
    headings: design.headingPreview
      .map((value, index) => `${index + 1}. ${normalizeText(value, 120)}`)
      .join('\n'),
    links: collectLinksSummary(),
    domTree: buildDomTreeSummary(document.body || document.documentElement),
    interactiveElements: collectInteractiveElements(),
    styleSummary: buildStyleSummary(design),
    design,
  }

  if (options?.includeFullHtml === true) {
    context.fullHtml = safeFullHtml()
    context.bodyHtml = safeBodyHtml()
  }

  return context
}
