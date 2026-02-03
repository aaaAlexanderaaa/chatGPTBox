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

function sanitizeProperties(node) {
  if (!node.properties) return
  const allowed = new Set([
    ...GLOBAL_ALLOWED_ATTRS,
    ...(TAG_ALLOWED_ATTRS[node.tagName] ? Array.from(TAG_ALLOWED_ATTRS[node.tagName]) : []),
  ])
  for (const key of Object.keys(node.properties)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.startsWith('on') || key === 'style') {
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

export function sanitizeMarkdownTree() {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'element') sanitizeProperties(node)
    if (Array.isArray(node.children)) {
      node.children.forEach(walk)
    }
  }
  return (tree) => walk(tree)
}
