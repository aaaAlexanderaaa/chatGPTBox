import { rangeForAnnotation } from './context.mjs'

export function showAnnotations(snapshot, annotations, id) {
  const win = snapshot.document.defaultView
  if (!win.Highlight || !win.CSS?.highlights)
    throw new Error(
      'This browser does not support page highlights. Use “View source” to select a passage.',
    )
  const ranges = annotations.map((item) => rangeForAnnotation(snapshot, item))
  const name = `chatgptbox-${id.replace(/[^a-z0-9-]/gi, '')}`
  const style = snapshot.document.createElement('style')
  style.textContent = `::highlight(${name}) { background-color: #fde68a; color: #292524; }`
  snapshot.document.head.append(style)
  win.CSS.highlights.set(name, new win.Highlight(...ranges))
  return () => {
    win.CSS.highlights.delete(name)
    style.remove()
  }
}

export function revealAnnotation(snapshot, annotation) {
  const range = rangeForAnnotation(snapshot, annotation)
  const selection = snapshot.document.defaultView.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function applyInputReplacement(input, replacement) {
  const { element, text, url, range } = input
  const doc = element.ownerDocument
  const isField = ['INPUT', 'TEXTAREA'].includes(element.tagName)
  const value = () => (isField ? element.value : element.textContent)
  if (
    !element.isConnected ||
    doc.location.href !== url ||
    value() !== text ||
    element.disabled ||
    element.readOnly
  )
    throw new Error('The input changed. Run the rewrite again before applying it.')
  if (typeof replacement !== 'string' || !replacement.trim())
    throw new Error('The replacement is empty')
  if (
    !isField &&
    Array.from(element.querySelectorAll('img, video, audio, [contenteditable="false"]')).some(
      (node) => range?.intersectsNode(node),
    )
  ) {
    throw new Error('This selection contains non-text content. Copy the result instead.')
  }
  const win = doc.defaultView
  const before = new win.InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertReplacementText',
    data: replacement,
  })
  if (!element.dispatchEvent(before))
    throw new Error('This editor did not allow the replacement. Copy the result instead.')
  if (!element.isConnected || value() !== text)
    throw new Error('The input changed. Run the rewrite again before applying it.')
  let undo
  if (isField) {
    const write = (next) => {
      const proto =
        element.tagName === 'TEXTAREA'
          ? win.HTMLTextAreaElement.prototype
          : win.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, next)
    }
    const next = text.slice(0, input.start) + replacement + text.slice(input.end)
    write(next)
    undo = () => write(text)
  } else {
    if (!range || !element.contains(range.commonAncestorContainer))
      throw new Error('The selected input is no longer available')
    const original = range.cloneContents()
    const node = doc.createTextNode(replacement)
    range.deleteContents()
    range.insertNode(node)
    undo = () => {
      if (!node.isConnected) throw new Error('The input changed. Undo is no longer available.')
      node.replaceWith(original)
    }
  }
  const notify = () => {
    element.dispatchEvent(
      new win.InputEvent('input', {
        bubbles: true,
        inputType: 'insertReplacementText',
        data: replacement,
      }),
    )
    element.dispatchEvent(new win.Event('change', { bubbles: true }))
  }
  notify()
  const applied = value()
  return () => {
    if (!element.isConnected || doc.location.href !== url || value() !== applied)
      throw new Error('The input changed. Undo is no longer available.')
    undo()
    notify()
  }
}
