import { rangeForAnnotation } from './context.mjs'
import { readEditableRange, readEditableText } from '../utils/editable-text.mjs'

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
  const value = () => readEditableText(element)
  const richSnapshotIsCurrent = () =>
    isField ||
    (element.innerHTML === input.html &&
      input.startNode?.isConnected &&
      input.endNode?.isConnected &&
      range?.startContainer === input.startNode &&
      range.startOffset === input.startOffset &&
      range.endContainer === input.endNode &&
      range.endOffset === input.endOffset)
  if (
    !element.isConnected ||
    doc.location.href !== url ||
    value() !== text ||
    !richSnapshotIsCurrent() ||
    element.disabled ||
    element.readOnly
  )
    throw new Error('The input changed. Run the rewrite again before applying it.')
  if (typeof replacement !== 'string' || !replacement.trim())
    throw new Error('The replacement is empty')
  const expected = isField ? text.slice(0, input.start) + replacement + text.slice(input.end) : null
  if (isField) {
    const probe = element.cloneNode(false)
    probe.value = expected
    if (probe.value !== expected)
      throw new Error('This input cannot preserve the replacement. Copy the result instead.')
  }
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
  if (!element.isConnected || value() !== text || !richSnapshotIsCurrent())
    throw new Error('The input changed. Run the rewrite again before applying it.')
  let undo
  let dispose = () => {}
  if (isField) {
    const write = (next) => {
      const proto =
        element.tagName === 'TEXTAREA'
          ? win.HTMLTextAreaElement.prototype
          : win.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, next)
    }
    write(expected)
    if (typeof element.selectionStart === 'number')
      element.setSelectionRange(input.start, input.start + replacement.length)
    undo = () => write(text)
  } else {
    if (!range || !element.contains(range.commonAncestorContainer))
      throw new Error('The selected input is no longer available')
    if (typeof doc.execCommand !== 'function')
      throw new Error('This editor did not allow the replacement. Copy the result instead.')
    const prefix = doc.createRange(),
      suffix = doc.createRange()
    prefix.selectNodeContents(element)
    prefix.setEnd(range.startContainer, range.startOffset)
    suffix.selectNodeContents(element)
    suffix.setStart(range.endContainer, range.endOffset)
    const beforeText = readEditableRange(prefix),
      afterText = readEditableRange(suffix)
    if (beforeText + readEditableRange(range) + afterText !== text)
      throw new Error('This editor did not allow the replacement. Copy the result instead.')
    element.focus({ preventScroll: true })
    if (
      !element.isConnected ||
      value() !== text ||
      !richSnapshotIsCurrent() ||
      (doc.activeElement !== element && !element.contains(doc.activeElement))
    )
      throw new Error('The input changed. Run the rewrite again before applying it.')
    const selection = win.getSelection()
    selection.removeAllRanges()
    selection.addRange(range.cloneRange())
    if (
      !doc.execCommand('insertText', false, replacement) ||
      value() !== beforeText + replacement + afterText
    )
      throw new Error('The editor did not confirm insertion. Check the draft before retrying.')
    let invalid = false,
      used = false
    const invalidate = () => {
      invalid = true
    }
    doc.addEventListener('beforeinput', invalidate, true)
    doc.addEventListener('input', invalidate, true)
    doc.addEventListener('compositionstart', invalidate, true)
    dispose = () => {
      doc.removeEventListener('beforeinput', invalidate, true)
      doc.removeEventListener('input', invalidate, true)
      doc.removeEventListener('compositionstart', invalidate, true)
    }
    undo = () => {
      if (invalid || used) throw new Error('The input changed. Undo is no longer available.')
      element.focus({ preventScroll: true })
      if (
        invalid ||
        value() !== applied ||
        element.innerHTML !== appliedHtml ||
        doc.location.href !== url ||
        element.disabled ||
        element.readOnly ||
        (doc.activeElement !== element && !element.contains(doc.activeElement))
      )
        throw new Error('The input changed. Undo is no longer available.')
      used = true
      dispose()
      if (!doc.execCommand('undo') || value() !== text || element.innerHTML !== input.html)
        throw new Error('The input changed. Undo is no longer available.')
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
  if (isField) notify()
  if (isField && value() !== expected)
    throw new Error('The editor did not confirm insertion. Check the draft before retrying.')
  const applied = value()
  const appliedHtml = isField ? null : element.innerHTML
  const restore = () => {
    if (
      !element.isConnected ||
      doc.location.href !== url ||
      value() !== applied ||
      element.disabled ||
      element.readOnly ||
      (!isField && element.innerHTML !== appliedHtml)
    )
      throw new Error('The input changed. Undo is no longer available.')
    undo()
    if (isField) notify()
  }
  restore.dispose = dispose
  return restore
}
