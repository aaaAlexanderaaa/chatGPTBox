const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE'])

// Preserve editor paragraph/BR boundaries without collecting rendered page text.
export function readEditableRange(range) {
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

export function readEditableText(element) {
  if (['INPUT', 'TEXTAREA'].includes(element.tagName)) return element.value
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  return readEditableRange(range)
}
