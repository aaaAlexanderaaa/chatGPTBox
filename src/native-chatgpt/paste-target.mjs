import { nativeChatgptEditor, editorText } from './editor.mjs'

export function capturePasteTarget(element) {
  const doc = element.ownerDocument
  if (nativeChatgptEditor(doc) !== element) throw new Error('This editor is not supported.')
  const field = element.tagName === 'TEXTAREA'
  let range = null
  if (!field) {
    const selection = doc.defaultView.getSelection()
    if (!selection?.rangeCount) throw new Error('Select a paste position in the input.')
    range = selection.getRangeAt(0).cloneRange()
    if (!element.contains(range.commonAncestorContainer))
      throw new Error('Select a paste position in the input.')
    if (element.querySelector('img, video, audio, [contenteditable="false"]'))
      throw new Error('Only plain-text drafts are supported.')
  }
  return {
    element,
    doc,
    url: doc.location.href,
    text: editorText(element),
    html: field ? '' : element.innerHTML,
    range,
    start: field ? element.selectionStart : range.startOffset,
    end: field ? element.selectionEnd : range.endOffset,
    startNode: range?.startContainer,
    endNode: range?.endContainer,
  }
}

const selectionIsCurrent = (target) => {
  const { element, doc } = target
  if (element.tagName === 'TEXTAREA')
    return element.selectionStart === target.start && element.selectionEnd === target.end
  // Window focus may temporarily move to the extension review, not the caret.
  if (!doc.hasFocus()) return true
  if (doc.activeElement !== element && !element.contains(doc.activeElement)) return false
  const selection = doc.defaultView.getSelection()
  if (!selection?.rangeCount) return false
  const live = selection.getRangeAt(0)
  return (
    live.startContainer === target.startNode &&
    live.endContainer === target.endNode &&
    live.startOffset === target.start &&
    live.endOffset === target.end
  )
}

export function pasteTargetIsCurrent(target) {
  const { element, doc, range } = target
  return !!(
    element.isConnected &&
    doc.location.href === target.url &&
    nativeChatgptEditor(doc) === element &&
    editorText(element) === target.text &&
    selectionIsCurrent(target) &&
    (element.tagName === 'TEXTAREA' ||
      (element.innerHTML === target.html &&
        target.startNode.isConnected &&
        target.endNode.isConnected &&
        range.startContainer === target.startNode &&
        range.endContainer === target.endNode &&
        range.startOffset === target.start &&
        range.endOffset === target.end))
  )
}

export function insertNativePaste(target, value) {
  if (!pasteTargetIsCurrent(target)) throw new Error('The input changed. Paste again.')
  const { element, doc, range } = target
  element.focus({ preventScroll: true })
  if (!pasteTargetIsCurrent(target)) throw new Error('The input changed. Paste again.')
  if (element.tagName === 'TEXTAREA') element.setSelectionRange(target.start, target.end)
  else {
    const selection = doc.defaultView.getSelection()
    selection.removeAllRanges()
    selection.addRange(range.cloneRange())
  }
  // Use the browser's editing path, including native undo and editor observers.
  // Never fall back to raw clipboard insertion or retry a partial effect.
  if (!doc.execCommand('insertText', false, value))
    throw new Error('The editor did not confirm insertion. Check the draft before retrying.')
}
