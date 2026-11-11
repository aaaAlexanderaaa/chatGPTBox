export const EXTENSION_UI_SELECTOR =
  '[data-chatgptbox-assistant], [class*="chatgptbox-"], #chatgptbox-container'

export function isExtensionUi(element) {
  return !!element.closest(EXTENSION_UI_SELECTOR)
}

export function pageTextOutsideExtensionUi(element, limit) {
  const doc = element.ownerDocument
  const walker = doc.createTreeWalker(element, 5, {
    acceptNode(node) {
      if (node.nodeType === 1) return isExtensionUi(node) ? 2 : 3
      return 1
    },
  })
  let text = ''
  while (walker.nextNode() && text.length < limit)
    text += walker.currentNode.textContent.slice(0, limit - text.length)
  return text
}
