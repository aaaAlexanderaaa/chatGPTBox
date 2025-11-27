import { getPossibleElementByQuerySelector } from './get-possible-element-by-query-selector.mjs'
import { Readability, isProbablyReaderable } from '@mozilla/readability'

const adapters = {
  'scholar.google': ['#gs_res_ccl_mid'],
  google: ['#search'],
  csdn: ['#content_views'],
  bing: ['#b_results'],
  wikipedia: ['#mw-content-text'],
  faz: ['.atc-Text'],
  golem: ['article'],
  eetimes: ['article'],
  'new.qq.com': ['.content-article'],
}

function getArea(e) {
  const rect = e.getBoundingClientRect()
  return rect.width * rect.height
}

function findLargestElement(e) {
  if (!e) {
    return null
  }
  let maxArea = 0
  let largestElement = null
  const limitedArea = 0.8 * getArea(e)

  function traverseDOM(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const area = getArea(node)

      if (area > maxArea && area < limitedArea) {
        maxArea = area
        largestElement = node
      }

      Array.from(node.children).forEach(traverseDOM)
    }
  }

  traverseDOM(e)
  return largestElement
}

function getTextFrom(e) {
  return e.innerText || e.textContent
}

function postProcessText(text) {
  return text
    .trim()
    .replaceAll('  ', '')
    .replaceAll('\t', '')
    .replaceAll('\n\n', '')
    .replaceAll(',,', '')
}

/**
 * Remove elements matching exclude selectors from a cloned element
 * @param {Element} element - The element to process (will be cloned)
 * @param {string} excludeSelectors - Comma-separated CSS selectors
 * @returns {Element} - Cloned element with excluded elements removed
 */
function removeExcludedElements(element, excludeSelectors) {
  if (!excludeSelectors) return element
  const clone = element.cloneNode(true)
  const selectors = excludeSelectors
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const selector of selectors) {
    try {
      const elements = clone.querySelectorAll(selector)
      elements.forEach((el) => el.remove())
    } catch (e) {
      console.warn('Invalid exclude selector:', selector, e)
    }
  }
  return clone
}

/**
 * Execute a custom extraction script safely
 * @param {string} script - JavaScript function body
 * @returns {string|null} - Extracted text or null if failed
 */
function executeCustomScript(script) {
  if (!script) return null
  try {
    // Create a function from the script body
    const fn = new Function('document', 'window', script)
    const result = fn(document, window)
    return typeof result === 'string' ? result : null
  } catch (e) {
    console.error('Custom extraction script error:', e)
    return null
  }
}

/**
 * Find matching custom extractor for current URL
 * @param {Array} customExtractors - Array of custom extractor configurations
 * @returns {Object|null} - Matching extractor or null
 */
function findMatchingExtractor(customExtractors) {
  if (!customExtractors || !Array.isArray(customExtractors)) return null

  const currentUrl = location.href
  for (const extractor of customExtractors) {
    if (!extractor.name || !extractor.urlPattern || extractor.active === false) continue
    try {
      const regex = new RegExp(extractor.urlPattern, 'i')
      if (regex.test(currentUrl)) {
        return extractor
      }
    } catch (e) {
      console.warn('Invalid URL pattern:', extractor.urlPattern, e)
    }
  }
  return null
}

/**
 * Extract content using CSS selectors
 * @param {string} selectorsStr - Comma-separated CSS selectors
 * @param {string} excludeSelectors - Comma-separated exclude selectors
 * @returns {{content: string, selector: string}|null}
 */
function extractBySelectors(selectorsStr, excludeSelectors) {
  if (!selectorsStr) return null
  const selectors = selectorsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const selector of selectors) {
    try {
      // Use querySelectorAll to get ALL matching elements
      const elements = document.querySelectorAll(selector)
      if (elements.length > 0) {
        // Collect text from all matching elements
        const textParts = []
        elements.forEach((element) => {
          const processedElement = removeExcludedElements(element, excludeSelectors)
          const text = getTextFrom(processedElement)
          if (text && text.trim()) {
            textParts.push(text.trim())
          }
        })

        if (textParts.length > 0) {
          return {
            content: postProcessText(textParts.join('\n\n')),
            selector,
            matchCount: elements.length,
          }
        }
      }
    } catch (e) {
      console.warn('Invalid selector:', selector, e)
    }
  }
  return null
}

/**
 * Extract content using Readability library
 * @param {string} excludeSelectors - Comma-separated exclude selectors
 * @returns {{content: string, method: string}|null}
 */
function extractByReadability(excludeSelectors) {
  if (!isProbablyReaderable(document)) return null

  const docClone = document.cloneNode(true)

  // Remove excluded elements from clone before parsing
  if (excludeSelectors) {
    const selectors = excludeSelectors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const selector of selectors) {
      try {
        const elements = docClone.querySelectorAll(selector)
        elements.forEach((el) => el.remove())
      } catch (e) {
        console.warn('Invalid exclude selector:', selector, e)
      }
    }
  }

  const article = new Readability(docClone, { keepClasses: true }).parse()
  if (article?.textContent) {
    return {
      content: postProcessText(article.textContent),
      method: 'readability',
    }
  }
  return null
}

/**
 * Extract content using largest element heuristic
 * @param {string} excludeSelectors - Comma-separated exclude selectors
 * @returns {{content: string, method: string}}
 */
function extractByLargestElement(excludeSelectors) {
  const largestElement = findLargestElement(document.body)
  const secondLargestElement = findLargestElement(largestElement)

  let element
  let method
  if (!largestElement) {
    element = document.body
    method = 'document.body'
  } else if (
    secondLargestElement &&
    getArea(secondLargestElement) > 0.5 * getArea(largestElement)
  ) {
    element = secondLargestElement
    method = 'second-largest'
  } else {
    element = largestElement
    method = 'largest'
  }

  const processedElement = removeExcludedElements(element, excludeSelectors)
  return {
    content: postProcessText(getTextFrom(processedElement)),
    method,
  }
}

/**
 * Perform auto extraction with optional exclude selectors
 * @param {string} excludeSelectors - Comma-separated exclude selectors
 * @param {Object} metadata - Metadata object to update
 * @returns {{content: string, metadata: Object}}
 */
function performAutoExtraction(excludeSelectors, metadata) {
  // Try built-in site adapters
  for (const [siteName, selectors] of Object.entries(adapters)) {
    if (location.hostname.includes(siteName)) {
      const element = getPossibleElementByQuerySelector(selectors)
      if (element) {
        const processedElement = removeExcludedElements(element, excludeSelectors)
        metadata.method = 'builtin-adapter'
        metadata.selector = selectors[0]
        if (!metadata.matchedRule) metadata.matchedRule = siteName
        return { content: postProcessText(getTextFrom(processedElement)), metadata }
      }
      break
    }
  }

  // Try article element
  const articleElement = document.querySelector('article')
  if (articleElement) {
    const processedElement = removeExcludedElements(articleElement, excludeSelectors)
    metadata.method = 'article-tag'
    metadata.selector = 'article'
    return { content: postProcessText(getTextFrom(processedElement)), metadata }
  }

  // Try Readability
  const readResult = extractByReadability(excludeSelectors)
  if (readResult) {
    metadata.method = readResult.method
    return { content: readResult.content, metadata }
  }

  // Fallback to largest element
  const largestResult = extractByLargestElement(excludeSelectors)
  metadata.method = largestResult.method
  return { content: largestResult.content, metadata }
}

/**
 * Enhanced content extraction with custom rules support and metadata
 * @param {Array} customExtractors - Array of custom extractor configurations
 * @returns {{content: string, metadata: Object}}
 */
export function getExtractedContentWithMetadata(customExtractors = []) {
  const metadata = {
    url: location.href,
    title: document.title,
    method: 'auto',
    selector: null,
    matchedRule: null,
  }

  // Check for matching custom extractor
  const matchedExtractor = findMatchingExtractor(customExtractors)
  if (matchedExtractor) {
    metadata.matchedRule = matchedExtractor.name
    const method = matchedExtractor.method || 'auto'
    const excludeSelectors = matchedExtractor.excludeSelectors || ''

    // Try custom script first if method is 'custom'
    if (method === 'custom' && matchedExtractor.customScript) {
      const customResult = executeCustomScript(matchedExtractor.customScript)
      if (customResult) {
        metadata.method = 'custom-script'
        return { content: postProcessText(customResult), metadata }
      }
    }

    // Try selectors if provided (for 'selectors' method or as primary extraction)
    if (matchedExtractor.selectors) {
      const selectorResult = extractBySelectors(matchedExtractor.selectors, excludeSelectors)
      if (selectorResult) {
        metadata.method = 'selectors'
        metadata.selector = selectorResult.selector
        metadata.matchCount = selectorResult.matchCount
        return { content: selectorResult.content, metadata }
      }
      // If selectors method was explicitly chosen but selectors didn't match, that's an error
      if (method === 'selectors') {
        metadata.method = 'selectors-failed'
        // Fall through to auto extraction as fallback
      }
    }

    // Handle specific extraction methods
    if (method === 'readability') {
      const readResult = extractByReadability(excludeSelectors)
      if (readResult) {
        metadata.method = readResult.method
        return { content: readResult.content, metadata }
      }
    } else if (method === 'largest') {
      const largestResult = extractByLargestElement(excludeSelectors)
      metadata.method = largestResult.method
      return { content: largestResult.content, metadata }
    }

    // For 'auto' method or fallback: use auto extraction WITH the custom rule's excludeSelectors
    return performAutoExtraction(excludeSelectors, metadata)
  }

  // No custom rule matched - use default extraction without exclude selectors
  return performAutoExtraction('', metadata)
}

export function getCoreContentText() {
  for (const [siteName, selectors] of Object.entries(adapters)) {
    if (location.hostname.includes(siteName)) {
      const element = getPossibleElementByQuerySelector(selectors)
      if (element) return postProcessText(getTextFrom(element))
      break
    }
  }

  const element = document.querySelector('article')
  if (element) {
    return postProcessText(getTextFrom(element))
  }

  if (isProbablyReaderable(document)) {
    let article = new Readability(document.cloneNode(true), {
      keepClasses: true,
    }).parse()
    if (article?.textContent) {
      console.log('readerable: successfully extracted content')
      return postProcessText(article.textContent)
    } else {
      console.log('readerable: parsing failed despite probability check')
    }
  }

  const largestElement = findLargestElement(document.body)
  const secondLargestElement = findLargestElement(largestElement)
  console.log(largestElement)
  console.log(secondLargestElement)

  let ret
  if (!largestElement) {
    ret = getTextFrom(document.body)
    console.log('use document.body')
  } else if (
    secondLargestElement &&
    getArea(secondLargestElement) > 0.5 * getArea(largestElement)
  ) {
    ret = getTextFrom(secondLargestElement)
    console.log('use second')
  } else {
    ret = getTextFrom(largestElement)
    console.log('use first')
  }
  return postProcessText(ret)
}
