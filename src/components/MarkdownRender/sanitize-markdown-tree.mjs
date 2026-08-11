const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);/i
const GLOBAL_ALLOWED_ATTRS = new Set(['className'])
const TAG_ALLOWED_ATTRS = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  video: new Set(['src', 'poster', 'controls', 'width', 'height']),
  code: new Set(['className']),
  pre: new Set(['className']),
  span: new Set(['className']),
  div: new Set(['className']),
  p: new Set(['className']),
  table: new Set(['className']),
  tr: new Set(['className']),
  td: new Set(['className']),
  th: new Set(['className']),
}

// KaTeX lays math out with inline geometry, so its subtree keeps the declarations
// KaTeX actually emits. Everything else still loses `style` entirely.
//
// This list is the set of properties katex/dist/katex.mjs emits inline — both the
// `node.style.X = ...` assignments and the handful written with
// `setAttribute('style', ...)` — and nothing is allowed "just in case". Keeping it
// tight matters because `rehype-raw` runs before this plugin, so answer text can
// forge `class="katex"` and reach this allowlist with attacker-chosen declarations.
const KATEX_ALLOWED_STYLE_PROPS = new Set([
  'background-color',
  'border',
  'border-bottom-width',
  'border-color',
  'border-right-style',
  'border-right-width',
  'border-style',
  'border-top-width',
  'border-width',
  'bottom',
  'color',
  'height',
  'left',
  'margin',
  'margin-left',
  'margin-right',
  'margin-top',
  'min-width',
  'padding-left',
  'position',
  'text-shadow',
  'top',
  'vertical-align',
  'width',
])

// `position` is the one allowed property that can lift content out of the answer
// flow and cover the surrounding UI. KaTeX only ever emits `relative`, so every
// other value — `fixed`/`absolute`/`sticky` — is dropped.
const ALLOWED_STYLE_VALUES = {
  position: new Set(['relative', 'static']),
}

// Dropping `position:fixed` alone does not close the overlay primitive:
// `position:relative` with a large enough offset still paints over earlier
// conversation turns, which is enough to spoof UI inside the transcript. KaTeX's
// own offsets are typographic — small multiples of em/ex/pt — so bounding the
// magnitude keeps real math working while capping the displacement a forged
// `class="katex"` can buy.
const DISPLACEMENT_PROPS = new Set([
  'top',
  'bottom',
  'left',
  'margin',
  'margin-top',
  'margin-left',
  'margin-right',
  'vertical-align',
  'text-shadow',
])
const MAX_DISPLACEMENT_UNITS = 100
const NUMERIC_TOKEN = /-?\d+(?:\.\d+)?/g

function isWithinDisplacementBound(value) {
  const numbers = value.match(NUMERIC_TOKEN)
  if (!numbers) return true
  return numbers.every((entry) => Math.abs(Number(entry)) <= MAX_DISPLACEMENT_UNITS)
}

// The only class names rehype-katex puts on a math subtree root. An exact match
// beats a `katex` prefix test, which would also accept e.g. `katex-ish`.
const KATEX_ROOT_CLASSES = new Set([
  'katex',
  'katex-display',
  'katex-error',
  'katex-html',
  'katex-mathml',
])

const SAFE_STYLE_VALUE = /^[a-zA-Z0-9%.,()#+\-/_\s]*$/
const UNSAFE_STYLE_TOKEN = /url\s*\(|expression\s*\(|javascript:|@import|calc\s*\(|\\/i
// KaTeX sizes everything in em/ex/pt/px/%. A viewport unit only ever appears here
// as a way to scale a forged declaration up to the whole window.
const VIEWPORT_UNIT = /\d\s*(?:vw|vh|vmin|vmax|vi|vb)\b/i

function sanitizeStyle(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (UNSAFE_STYLE_TOKEN.test(value) || VIEWPORT_UNIT.test(value)) return null

  const kept = []
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator === -1) continue
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const propertyValue = declaration.slice(separator + 1).trim()
    if (!KATEX_ALLOWED_STYLE_PROPS.has(property)) continue
    if (!propertyValue || !SAFE_STYLE_VALUE.test(propertyValue)) continue
    const allowedValues = ALLOWED_STYLE_VALUES[property]
    if (allowedValues && !allowedValues.has(propertyValue.toLowerCase())) continue
    if (DISPLACEMENT_PROPS.has(property) && !isWithinDisplacementBound(propertyValue)) continue
    kept.push(`${property}:${propertyValue}`)
  }
  return kept.length > 0 ? kept.join(';') : null
}

function hasKatexClass(node) {
  const className = node?.properties?.className
  const classes = Array.isArray(className) ? className : String(className || '').split(/\s+/)
  return classes.some((entry) => KATEX_ROOT_CLASSES.has(String(entry)))
}

function sanitizeUrl(value, kind) {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  try {
    const url = new URL(raw, 'https://example.com')
    const protocol = url.protocol.toLowerCase()
    if (protocol === 'javascript:' || protocol === 'vbscript:') return null
    if (protocol === 'data:') {
      if (kind === 'src' && SAFE_DATA_IMAGE.test(raw)) return raw
      return null
    }
  } catch (e) {
    return null
  }
  return raw
}

function sanitizeProperties(node, allowKatexStyle) {
  if (!node.properties) return
  const allowed = new Set([
    ...GLOBAL_ALLOWED_ATTRS,
    ...(TAG_ALLOWED_ATTRS[node.tagName] ? Array.from(TAG_ALLOWED_ATTRS[node.tagName]) : []),
  ])
  for (const key of Object.keys(node.properties)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'style') {
      const safe = allowKatexStyle ? sanitizeStyle(node.properties[key]) : null
      if (safe) node.properties[key] = safe
      else delete node.properties[key]
      continue
    }
    if (lowerKey.startsWith('on')) {
      delete node.properties[key]
      continue
    }
    if (!allowed.has(key)) {
      delete node.properties[key]
      continue
    }
    if (key === 'href') {
      const safe = sanitizeUrl(node.properties[key], 'href')
      if (!safe) delete node.properties[key]
      else node.properties[key] = safe
    }
    if (key === 'src' || key === 'poster') {
      const safe = sanitizeUrl(node.properties[key], 'src')
      if (!safe) delete node.properties[key]
      else node.properties[key] = safe
    }
  }
}

/**
 * @param {{ allowKatexStyles?: boolean }} [options] Pass `allowKatexStyles: true`
 *   only from a pipeline that actually runs `rehype-katex`. Builds without math
 *   have nothing to gain from the allowlist, so they keep stripping every
 *   `style` attribute.
 */
export function sanitizeMarkdownTree(options = {}) {
  const allowKatexStyles = options?.allowKatexStyles === true
  const walk = (node, inKatex = false) => {
    if (!node || typeof node !== 'object') return
    const nodeInKatex =
      allowKatexStyles && (inKatex || (node.type === 'element' && hasKatexClass(node)))
    if (node.type === 'element') sanitizeProperties(node, nodeInKatex)
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => walk(child, nodeInKatex))
    }
  }
  return (tree) => walk(tree)
}
