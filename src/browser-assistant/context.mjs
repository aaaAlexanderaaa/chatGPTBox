const EDITABLE =
  '[contenteditable="true" i], [contenteditable="plaintext-only" i], [contenteditable=""]'
const EXCLUDED = `script, style, noscript, nav, header, footer, aside, button, input, textarea, select, ${EDITABLE}, [hidden], [aria-hidden="true"], [data-chatgptbox-assistant], [class*="chatgptbox-"], #chatgptbox-container`

export function selectedInputText(target) {
  if (!target || target.type === 'password') return ''
  if (typeof target.selectionStart === 'number')
    return target.value.slice(target.selectionStart, target.selectionEnd)
  return ''
}

export function captureInput(target, doc = document) {
  const element = target?.closest?.(`textarea, input, ${EDITABLE}`)
  if (!element || element.closest('[data-chatgptbox-assistant], [class*="chatgptbox-"]'))
    return null
  const isField = ['INPUT', 'TEXTAREA'].includes(element.tagName)
  if (
    isField &&
    (element.disabled ||
      element.readOnly ||
      (element.tagName === 'INPUT' &&
        !['text', 'search', 'url', 'tel', 'email', ''].includes(element.type)))
  )
    return null
  const text = isField ? element.value : element.textContent
  let start = 0,
    end = text.length,
    range = null
  if (isField && element.selectionEnd > element.selectionStart) {
    start = element.selectionStart
    end = element.selectionEnd
  } else if (!isField) {
    const selection = doc.defaultView.getSelection()
    if (
      selection?.rangeCount &&
      !selection.isCollapsed &&
      element.contains(selection.anchorNode) &&
      element.contains(selection.focusNode)
    )
      range = selection.getRangeAt(0).cloneRange()
    else {
      range = doc.createRange()
      range.selectNodeContents(element)
    }
  }
  return {
    element,
    text,
    start,
    end,
    range,
    selectedText: isField ? text.slice(start, end) : range.toString(),
    url: doc.location.href,
  }
}

export function captureContext({ target, selection, doc = document } = {}) {
  const input = captureInput(target, doc)
  const nativeSelection = doc.defaultView.getSelection()
  const range = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0).cloneRange() : null
  const selectedText = input
    ? ['INPUT', 'TEXTAREA'].includes(input.element.tagName)
      ? selectedInputText(input.element)
      : input.element.contains(nativeSelection?.anchorNode)
      ? nativeSelection?.toString() || ''
      : ''
    : nativeSelection?.toString() || ''
  return {
    url: doc.location.href,
    title: doc.title,
    document: doc,
    selection: selection ?? selectedText,
    range,
    input,
  }
}

export function captureReadingSnapshot(context, scope = 'page', { maxChars = 30000 } = {}) {
  const doc = context.document
  if (doc.location.href !== context.url)
    throw new Error('The page changed. Open the assistant again.')
  const selected = scope === 'selection'
  if (
    selected &&
    (!context.range ||
      context.range.collapsed ||
      !context.selection.trim() ||
      context.range.toString().trim() !== context.selection.trim())
  )
    throw new Error('Select text in the page to annotate it')
  const root = selected
    ? context.range.commonAncestorContainer
    : doc.querySelector('article, main, [role="main"]') || doc.body
  const groups = new Map()
  const walker = doc.createTreeWalker(root, 4)
  const nodes = root.nodeType === 3 ? [root] : []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  for (const node of nodes) {
    const parent = node.parentElement
    if (!parent || parent.closest(EXCLUDED) || !node.textContent.trim()) continue
    let hidden = false
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
      const style = doc.defaultView.getComputedStyle(ancestor)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.contentVisibility === 'hidden'
      ) {
        hidden = true
        break
      }
    }
    if (hidden) continue
    if (selected && !context.range.intersectsNode(node)) continue
    const key = parent.closest('p, li, h1, h2, h3, h4, blockquote, pre, td, th') || parent
    if (!groups.has(key)) groups.set(key, [])
    let start = 0,
      end = node.textContent.length
    if (selected && node === context.range.startContainer) start = context.range.startOffset
    if (selected && node === context.range.endContainer) end = context.range.endOffset
    groups.get(key).push({ node, start, end, text: node.textContent.slice(start, end) })
  }
  const blocks = []
  let remaining = maxChars,
    truncated = false
  for (const entries of groups.values()) {
    const raw = entries.map((entry) => entry.text).join('')
    if (!raw.trim()) continue
    if (remaining <= 0) {
      truncated = true
      break
    }
    const text = raw.slice(0, remaining)
    truncated ||= raw.length > remaining
    blocks.push({ ref: `b${blocks.length + 1}`, text, raw, entries })
    remaining -= text.length
  }
  if (!blocks.length) throw new Error('No readable text was found. Select a passage instead.')
  return { url: context.url, document: doc, blocks, truncated }
}

export function rangeForAnnotation(snapshot, annotation) {
  if (snapshot.document.location.href !== snapshot.url) throw new Error('The page changed')
  const block = snapshot.blocks.find((item) => item.ref === annotation.ref)
  if (!block) throw new Error('Source block was not provided to the AI')
  if (
    block.entries.some(({ node }) => !node.isConnected) ||
    block.entries.map(({ node, start, end }) => node.textContent.slice(start, end)).join('') !==
      block.raw
  )
    throw new Error('The original passage has changed')
  const start = block.text.indexOf(annotation.quote)
  if (start < 0) throw new Error('Quote does not match the original text')
  if (block.text.indexOf(annotation.quote, start + 1) >= 0)
    throw new Error('Quote matches more than one passage')
  const finish = start + annotation.quote.length
  let offset = 0,
    startPoint,
    endPoint
  for (const entry of block.entries) {
    const length = entry.text.length
    if (!startPoint && start >= offset && start < offset + length)
      startPoint = [entry.node, entry.start + start - offset]
    if (finish > offset && finish <= offset + length) {
      endPoint = [entry.node, entry.start + finish - offset]
      break
    }
    offset += length
  }
  if (!startPoint || !endPoint) throw new Error('Cannot locate the original passage')
  const range = snapshot.document.createRange()
  range.setStart(...startPoint)
  range.setEnd(...endPoint)
  return range
}
