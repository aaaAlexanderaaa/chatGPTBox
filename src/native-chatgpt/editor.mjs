// Site semantics live here; the provider module does not own native page UX.
export function isNativeChatgptUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const { protocol, hostname, pathname, search } = url
  return (
    protocol === 'https:' &&
    hostname === 'chatgpt.com' &&
    /^\/(?:c\/[^/]+\/?)?$/.test(pathname) &&
    !new URLSearchParams(search).has('chatgptbox_proxy')
  )
}

export function isNativeChatgptPage(doc) {
  return isNativeChatgptUrl(doc.location.href) && doc.defaultView.top === doc.defaultView
}

export function nativeChatgptEditor(doc) {
  if (!isNativeChatgptPage(doc)) return null
  const candidates = doc.querySelectorAll('#prompt-textarea, textarea#mobile-composer-prompt')
  if (candidates.length !== 1) return null
  const element = candidates[0]
  if (
    !element.isConnected ||
    element.disabled ||
    element.readOnly ||
    element.closest('[hidden], [aria-hidden="true"], [inert], [role="dialog"]')
  )
    return null
  if (
    element.tagName !== 'TEXTAREA' &&
    !element.matches('[contenteditable="true"], [contenteditable="plaintext-only"]')
  )
    return null
  const style = doc.defaultView.getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden' ? null : element
}

// ChatGPT's paragraph/line-break structure must survive material capture.
const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE'])
export function nativeRangeText(range) {
  const read = (node) => {
    if (node.nodeType === 3) return node.nodeValue || ''
    if (['SCRIPT', 'STYLE'].includes(node.nodeName)) return ''
    if (node.nodeName === 'BR') return '\n'
    if (
      BLOCKS.has(node.nodeName) &&
      node.childNodes.length === 1 &&
      node.firstChild.nodeName === 'BR'
    )
      return ''
    let nodes = Array.from(node.childNodes)
    if (nodes.some((child) => BLOCKS.has(child.nodeName)))
      nodes = nodes.filter((child) => child.nodeType !== 3 || child.nodeValue.trim())
    return nodes
      .map(
        (child, index) =>
          (index && (BLOCKS.has(child.nodeName) || BLOCKS.has(nodes[index - 1].nodeName))
            ? '\n'
            : '') + read(child),
      )
      .join('')
  }
  return read(range.cloneContents())
}
export function editorText(element) {
  if (element.tagName === 'TEXTAREA') return element.value
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  return nativeRangeText(range)
}
