import { getExtractedContentWithMetadata, getCoreContentText } from './get-core-content-text.mjs'
import { clampTokenBudget, estimateTokenCount, truncateToTokenBudget } from './token-budget.mjs'

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g

const MAX_SELECTION_CHARS = 12000
const MAX_CONTENT_CHARS = 18000
const MAX_FULL_HTML_CHARS = 50000
const MAX_BODY_HTML_CHARS = 35000
const MAX_DOM_TREE_LINES = 300
const MAX_LINKS = 48
const MAX_HEADINGS = 24
const MAX_INTERACTIVE_ELEMENTS = 64

const DEFAULT_PRELOAD_CONTEXT_TOKEN_CAP = 64000
const DEFAULT_CONTEXT_TOKEN_CAP = 128000

export const promptTemplateVariables = [
  'selection',
  'content',
  'domTree',
  'title',
  'url',
  'description',
  'language',
  'headings',
  'links',
  'interactiveElements',
  'styleSummary',
  'extractionMethod',
  'fullHtml',
  'bodyHtml',
]

const keyAliases = {
  selection: 'selection',
  selectedtext: 'selection',

  content: 'content',
  pagecontent: 'content',

  domtree: 'domtree',
  dom: 'domtree',

  title: 'title',
  url: 'url',
  description: 'description',
  language: 'language',
  lang: 'language',

  headings: 'headings',
  links: 'links',
  interactiveelements: 'interactiveelements',
  interactives: 'interactiveelements',
  stylesummary: 'stylesummary',

  extractionmethod: 'extractionmethod',
  extractormethod: 'extractionmethod',

  fullhtml: 'fullhtml',
  html: 'fullhtml',
  bodyhtml: 'bodyhtml',
}

const variablePriority = {
  selection: 1,
  content: 2,
  domtree: 3,
  title: 1,
  url: 1,
  description: 2,
  language: 1,
  headings: 4,
  links: 5,
  interactiveelements: 3,
  stylesummary: 2,
  extractionmethod: 3,
  fullhtml: 10,
  bodyhtml: 8,
}

const variableMinimumTokens = {
  selection: 64,
  content: 128,
  domtree: 96,
  stylesummary: 80,
  interactiveelements: 64,
  fullhtml: 0,
  bodyhtml: 0,
}

const variableInitialTokenCap = {
  selection: 3000,
  content: 4500,
  domtree: 3000,
  title: 128,
  url: 128,
  description: 256,
  language: 64,
  headings: 512,
  links: 900,
  interactiveelements: 2000,
  stylesummary: 2500,
  extractionmethod: 96,
  fullhtml: 10000,
  bodyhtml: 7000,
}

function hasDomAccess() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function normalizeKey(rawKey) {
  return String(rawKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function normalizeText(value, maxLength = 2000) {
  const text = typeof value === 'string' ? value : ''
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}\n...[truncated]` : trimmed
}

function safeGetMetaDescription() {
  if (!hasDomAccess()) return ''
  const value = document.querySelector('meta[name="description"]')?.getAttribute('content') || ''
  return normalizeText(value, 600)
}

function summarizeHeadingsFromDom() {
  if (!hasDomAccess()) return ''
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
    .map((element) => normalizeText(element.textContent || '', 180))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS)
  if (headings.length === 0) return ''
  return headings.map((heading, index) => `${index + 1}. ${heading}`).join('\n')
}

function summarizeLinksFromDom() {
  if (!hasDomAccess()) return ''
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((element) => {
      const label = normalizeText(element.textContent || element.getAttribute('aria-label') || '', 120)
      const href = normalizeText(element.getAttribute('href') || '', 300)
      if (!href) return ''
      return label ? `- ${label}: ${href}` : `- ${href}`
    })
    .filter(Boolean)
    .slice(0, MAX_LINKS)
  return links.join('\n')
}

function summarizeInteractiveElementsFromDom() {
  if (!hasDomAccess()) return ''
  const elements = Array.from(
    document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex]'),
  )
    .slice(0, MAX_INTERACTIVE_ELEMENTS)
    .map((element) => {
      const tag = String(element.tagName || '').toLowerCase()
      const id = element.id ? `#${element.id.slice(0, 24)}` : ''
      const role = element.getAttribute('role')
      const roleText = role ? ` role=${role.slice(0, 24)}` : ''
      const href = normalizeText(element.getAttribute('href') || '', 140)
      const value = normalizeText(element.getAttribute('value') || '', 80)
      const label = normalizeText(
        element.textContent ||
          element.getAttribute('aria-label') ||
          element.getAttribute('placeholder') ||
          '',
        120,
      )

      const suffixParts = []
      if (label) suffixParts.push(`label="${label}"`)
      if (href) suffixParts.push(`href="${href}"`)
      if (value) suffixParts.push(`value="${value}"`)
      return `- ${tag}${id}${roleText}${suffixParts.length > 0 ? ` (${suffixParts.join(', ')})` : ''}`
    })

  return elements.join('\n')
}

function nodeLabel(element) {
  const tag = String(element.tagName || '').toLowerCase()
  const id = element.id ? `#${element.id.slice(0, 30)}` : ''
  const classNames = typeof element.className === 'string' ? element.className.trim().split(/\s+/) : []
  const classSuffix = classNames
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => `.${name.slice(0, 24)}`)
    .join('')
  const role = element.getAttribute('role')
  const roleSuffix = role ? ` [role=${role.slice(0, 24)}]` : ''
  const text = normalizeText(element.textContent || '', 52)
  const textSuffix = text ? ` "${text}"` : ''
  return `${tag}${id}${classSuffix}${roleSuffix}${textSuffix}`
}

function buildDomTreeSummaryFromDom(root) {
  if (!root) return ''
  const lines = []
  const stack = [{ node: root, depth: 0 }]

  while (stack.length > 0 && lines.length < MAX_DOM_TREE_LINES) {
    const current = stack.pop()
    if (!current || !current.node) continue

    const element = current.node
    if (current.depth > 9) continue
    lines.push(`${'  '.repeat(current.depth)}- ${nodeLabel(element)}`)

    const children = Array.from(element.children || [])
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 })
    }
  }

  if (stack.length > 0) lines.push('...[dom tree truncated]')
  return lines.join('\n')
}

function safeDocumentOuterHtml() {
  if (!hasDomAccess()) return ''
  return normalizeText(document.documentElement?.outerHTML || '', MAX_FULL_HTML_CHARS)
}

function safeBodyHtml() {
  if (!hasDomAccess()) return ''
  return normalizeText(document.body?.innerHTML || '', MAX_BODY_HTML_CHARS)
}

function resolveContentSnapshot(customExtractors) {
  if (!hasDomAccess()) return null
  try {
    return getExtractedContentWithMetadata(Array.isArray(customExtractors) ? customExtractors : [])
  } catch (error) {
    console.debug('Failed to resolve extracted content:', error)
    return null
  }
}

function getPageContextValue(pageContext, key) {
  if (!pageContext || typeof pageContext !== 'object') return ''

  switch (key) {
    case 'selection':
      return normalizeText(pageContext.selection || '', MAX_SELECTION_CHARS)
    case 'content':
      return normalizeText(pageContext.content || '', MAX_CONTENT_CHARS)
    case 'domtree':
      return normalizeText(pageContext.domTree || pageContext.design?.domTree || '', 24000)
    case 'title':
      return normalizeText(pageContext.title || '', 300)
    case 'url':
      return normalizeText(pageContext.url || '', 500)
    case 'description':
      return normalizeText(pageContext.description || '', 600)
    case 'language':
      return normalizeText(pageContext.language || '', 40)
    case 'headings': {
      if (Array.isArray(pageContext.design?.headingPreview)) {
        return pageContext.design.headingPreview
          .map((value, index) => `${index + 1}. ${normalizeText(value, 140)}`)
          .filter(Boolean)
          .join('\n')
      }
      return normalizeText(pageContext.headings || '', 1800)
    }
    case 'links':
      return normalizeText(pageContext.links || '', 4000)
    case 'interactiveelements':
      return normalizeText(pageContext.interactiveElements || '', 12000)
    case 'stylesummary':
      return normalizeText(pageContext.styleSummary || pageContext.design?.styleSummary || '', 14000)
    case 'extractionmethod':
      return normalizeText(pageContext.extraction?.method || '', 120)
    case 'fullhtml':
      return normalizeText(pageContext.fullHtml || '', MAX_FULL_HTML_CHARS)
    case 'bodyhtml':
      return normalizeText(pageContext.bodyHtml || '', MAX_BODY_HTML_CHARS)
    default:
      return ''
  }
}

function summarizeStyleFromDom() {
  if (!hasDomAccess()) return ''

  const root = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body || document.documentElement)
  const colors = new Set()
  const fonts = new Set()

  const sample = document.querySelectorAll(
    'body, main, header, nav, section, article, aside, footer, button, a, h1, h2, h3, p, span, div',
  )
  const sampleSize = Math.min(sample.length, 160)

  for (let index = 0; index < sampleSize; index += 1) {
    const style = getComputedStyle(sample[index])
    const family = normalizeText(style.fontFamily || '', 120)
    if (family) fonts.add(family)

    const picks = [style.color, style.backgroundColor, style.borderColor]
      .map((value) => normalizeText(value || '', 60))
      .filter((value) => value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)')

    for (const color of picks) {
      colors.add(color)
      if (colors.size >= 14) break
    }
  }

  const lines = []
  const fontSize = normalizeText(body.fontSize || '', 24)
  const lineHeight = normalizeText(body.lineHeight || '', 24)
  const radius = normalizeText(root.getPropertyValue('--radius') || '', 40)

  if (fonts.size > 0) lines.push(`Fonts: ${Array.from(fonts).slice(0, 8).join(', ')}`)
  if (colors.size > 0) lines.push(`Color tokens: ${Array.from(colors).slice(0, 12).join(', ')}`)
  if (fontSize) lines.push(`Base font-size: ${fontSize}`)
  if (lineHeight) lines.push(`Base line-height: ${lineHeight}`)
  if (radius) lines.push(`Design radius token: ${radius}`)

  return lines.join('\n')
}

function normalizeVariablesMap(entries) {
  return Object.fromEntries(
    Object.entries(entries)
      .map(([key, value]) => [key, typeof value === 'string' ? value : ''])
      .filter(([, value]) => value !== undefined),
  )
}

function getShrinkOrder(keys) {
  return [...keys].sort((left, right) => {
    const leftPriority = variablePriority[left] ?? 6
    const rightPriority = variablePriority[right] ?? 6
    if (leftPriority !== rightPriority) return rightPriority - leftPriority
    return left.localeCompare(right)
  })
}

function enforceVariableBudget(values, keys, totalTokenCap) {
  const effectiveCap = clampTokenBudget(totalTokenCap, 1, 256000, totalTokenCap)
  if (!Number.isFinite(effectiveCap)) return values

  const result = { ...values }
  const computeTotal = () =>
    keys.reduce((sum, key) => sum + estimateTokenCount(result[key] || ''), 0)

  let total = computeTotal()
  if (total <= effectiveCap) return result

  const shrinkOrder = getShrinkOrder(keys)
  for (const key of shrinkOrder) {
    if (total <= effectiveCap) break
    const current = result[key] || ''
    if (!current) continue

    const currentTokens = estimateTokenCount(current)
    const minTokens = variableMinimumTokens[key] || 0
    if (currentTokens <= minTokens) continue

    const overflow = total - effectiveCap
    const removable = currentTokens - minTokens
    const removeTokens = Math.min(removable, overflow)
    const targetTokens = Math.max(minTokens, currentTokens - removeTokens)
    result[key] = truncateToTokenBudget(current, targetTokens)
    total = computeTotal()
  }

  return result
}

export function extractTemplateVariables(template) {
  const sourceTemplate = typeof template === 'string' ? template : ''
  if (!sourceTemplate.includes('{{')) return []

  const found = []
  const seen = new Set()
  sourceTemplate.replace(PLACEHOLDER_PATTERN, (fullMatch, rawKey) => {
    const canonical = keyAliases[normalizeKey(rawKey)]
    if (!canonical || seen.has(canonical)) return fullMatch
    seen.add(canonical)
    found.push(canonical)
    return fullMatch
  })
  return found
}

function createProviders(options = {}) {
  const selection = normalizeText(options.selection || '', MAX_SELECTION_CHARS)
  const pageContext = options.pageContext && typeof options.pageContext === 'object' ? options.pageContext : null
  const customExtractors = options.customExtractors
  const allowFullHtml = options.allowFullHtml !== false

  let extractedCache
  const getExtracted = () => {
    if (extractedCache !== undefined) return extractedCache
    extractedCache = resolveContentSnapshot(customExtractors)
    return extractedCache
  }

  return {
    selection: () => {
      if (selection) return selection
      return getPageContextValue(pageContext, 'selection')
    },
    content: () => {
      const fromContext = getPageContextValue(pageContext, 'content')
      if (fromContext) return fromContext
      const extracted = getExtracted()
      const fromExtractor = normalizeText(extracted?.content || '', MAX_CONTENT_CHARS)
      if (fromExtractor) return fromExtractor
      return hasDomAccess() ? normalizeText(getCoreContentText(), MAX_CONTENT_CHARS) : ''
    },
    domtree: () => {
      const fromContext = getPageContextValue(pageContext, 'domtree')
      if (fromContext) return fromContext
      return hasDomAccess() ? buildDomTreeSummaryFromDom(document.body || document.documentElement) : ''
    },
    title: () => {
      const fromContext = getPageContextValue(pageContext, 'title')
      if (fromContext) return fromContext
      return hasDomAccess() ? normalizeText(document.title || '', 300) : ''
    },
    url: () => {
      const fromContext = getPageContextValue(pageContext, 'url')
      if (fromContext) return fromContext
      return hasDomAccess() ? normalizeText(window.location?.href || '', 500) : ''
    },
    description: () => {
      const fromContext = getPageContextValue(pageContext, 'description')
      if (fromContext) return fromContext
      return safeGetMetaDescription()
    },
    language: () => {
      const fromContext = getPageContextValue(pageContext, 'language')
      if (fromContext) return fromContext
      return hasDomAccess() ? normalizeText(document.documentElement?.lang || '', 40) : ''
    },
    headings: () => {
      const fromContext = getPageContextValue(pageContext, 'headings')
      if (fromContext) return fromContext
      return summarizeHeadingsFromDom()
    },
    links: () => {
      const fromContext = getPageContextValue(pageContext, 'links')
      if (fromContext) return fromContext
      return summarizeLinksFromDom()
    },
    interactiveelements: () => {
      const fromContext = getPageContextValue(pageContext, 'interactiveelements')
      if (fromContext) return fromContext
      return summarizeInteractiveElementsFromDom()
    },
    stylesummary: () => {
      const fromContext = getPageContextValue(pageContext, 'stylesummary')
      if (fromContext) return fromContext
      return summarizeStyleFromDom()
    },
    extractionmethod: () => {
      const fromContext = getPageContextValue(pageContext, 'extractionmethod')
      if (fromContext) return fromContext
      return normalizeText(getExtracted()?.metadata?.method || '', 80)
    },
    fullhtml: () => {
      if (!allowFullHtml) return ''
      const fromContext = getPageContextValue(pageContext, 'fullhtml')
      if (fromContext) return fromContext
      return safeDocumentOuterHtml()
    },
    bodyhtml: () => {
      if (!allowFullHtml) return ''
      const fromContext = getPageContextValue(pageContext, 'bodyhtml')
      if (fromContext) return fromContext
      return safeBodyHtml()
    },
  }
}

export function resolvePromptTemplate(template, options = {}) {
  const sourceTemplate = typeof template === 'string' ? template : ''
  if (!sourceTemplate.includes('{{')) return sourceTemplate

  const referencedKeys = extractTemplateVariables(sourceTemplate)
  if (referencedKeys.length === 0) return sourceTemplate

  const preloadTokenCap = clampTokenBudget(
    options.preloadTokenCap,
    1000,
    256000,
    DEFAULT_PRELOAD_CONTEXT_TOKEN_CAP,
  )
  const contextTokenCap = clampTokenBudget(
    options.contextTokenCap,
    1000,
    256000,
    DEFAULT_CONTEXT_TOKEN_CAP,
  )

  const providers = createProviders(options)
  const resolvedRawValues = {}

  for (const key of referencedKeys) {
    const provider = providers[key]
    if (typeof provider !== 'function') {
      resolvedRawValues[key] = ''
      continue
    }
    try {
      resolvedRawValues[key] = provider() || ''
    } catch (error) {
      console.debug(`Failed to resolve template variable ${key}:`, error)
      resolvedRawValues[key] = ''
    }
  }

  let resolvedValues = normalizeVariablesMap(resolvedRawValues)

  for (const key of referencedKeys) {
    const text = resolvedValues[key] || ''
    if (!text) continue
    const perVarCap = variableInitialTokenCap[key]
    if (Number.isFinite(perVarCap) && perVarCap > 0) {
      resolvedValues[key] = truncateToTokenBudget(text, perVarCap)
    }
  }

  const staticText = sourceTemplate.replace(PLACEHOLDER_PATTERN, '')
  const staticTokens = estimateTokenCount(staticText)
  const maxDynamicTokens = Math.max(1, contextTokenCap - staticTokens)
  const dynamicBudget = Math.min(preloadTokenCap, maxDynamicTokens)
  resolvedValues = enforceVariableBudget(resolvedValues, referencedKeys, dynamicBudget)

  const resolved = sourceTemplate.replace(PLACEHOLDER_PATTERN, (fullMatch, rawKey) => {
    const canonical = keyAliases[normalizeKey(rawKey)]
    if (!canonical) return fullMatch
    return resolvedValues[canonical] || ''
  })

  if (estimateTokenCount(resolved) <= contextTokenCap) return resolved
  return truncateToTokenBudget(resolved, contextTokenCap)
}
