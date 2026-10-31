import { captureContext } from '../browser-assistant/context.mjs'
import { editorText, isNativeChatgptPage, nativeChatgptEditor, nativeRangeText } from './editor.mjs'

// Receives the existing assistant launcher; it does not own model execution.
export function installNativeDraftEntry({ doc = document, enabled, t, onRewrite }) {
  if (!enabled || !isNativeChatgptPage(doc)) return () => {}
  const win = doc.defaultView
  const root = doc.createElement('div')
  root.className = 'chatgptbox-native-actions'
  root.setAttribute('data-chatgptbox-native-draft', '')
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = t('Rewrite draft')
  root.append(button)
  const status = doc.createElement('span')
  status.setAttribute('role', 'status')
  root.append(status)
  let editor,
    captured,
    scheduled,
    lastAnchor,
    stopped = false,
    composing = false,
    capturedText = null
  const capture = () => {
    if (editor?.isConnected && !composing) {
      captured = captureContext({ target: editor, doc })
      if (captured.input?.range) captured.input.selectedText = nativeRangeText(captured.input.range)
      capturedText = editorText(editor)
    }
  }
  const refresh = () => {
    scheduled = null
    if (stopped || !enabled) return
    const next = nativeChatgptEditor(doc)
    if (next !== editor) {
      editor = next
      captured = null
      composing = false
      status.textContent = ''
    }
    if (!editor) {
      root.remove()
      return
    }
    const anchor = editor.closest('form') || editor
    if (lastAnchor !== anchor || !root.isConnected) {
      lastAnchor = anchor
      anchor.after(root)
    }
    button.disabled = composing || !editorText(editor).trim()
  }
  const schedule = () => {
    if (!stopped && !scheduled) scheduled = win.requestAnimationFrame(refresh)
  }
  const remember = (event) => {
    if (editor && (editor === event.target || editor.contains(event.target))) capture()
  }
  const selection = () => {
    if (editor && (doc.activeElement === editor || editor.contains(doc.activeElement))) capture()
  }
  const pointerDown = (event) => {
    if (event.button === 0) {
      capture()
      event.preventDefault() // Keep the native editor selection until click.
    }
  }
  const click = async (event) => {
    if (!event.isTrusted) return
    status.textContent = ''
    if (composing) {
      status.textContent = t('Finish composing before rewriting.')
      return
    }
    const current = nativeChatgptEditor(doc)
    if (!current || current !== editor) {
      status.textContent = t('The input changed. Open the assistant again.')
      schedule()
      return
    }
    if (!captured || capturedText !== editorText(editor)) capture()
    button.disabled = true
    try {
      await onRewrite(captured)
    } catch {
      status.textContent = t('Could not open the assistant. Reload the page and try again.')
    } finally {
      schedule()
    }
  }
  const composition = (event) => {
    if (editor && (event.target === editor || editor.contains(event.target))) {
      composing = event.type === 'compositionstart'
      if (!composing) capture()
      else captured = null
      refresh()
    }
  }
  doc.addEventListener('compositionstart', composition, true)
  doc.addEventListener('compositionend', composition, true)
  button.addEventListener('pointerdown', pointerDown)
  button.addEventListener('click', click)
  doc.addEventListener('focusout', remember, true)
  doc.addEventListener('selectionchange', selection)
  doc.addEventListener('select', remember, true)
  doc.addEventListener('input', schedule, true)
  const observer = new win.MutationObserver((records) => {
    if (records.some((record) => !root.contains(record.target))) schedule()
  })
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['id', 'contenteditable', 'hidden', 'disabled', 'readonly'],
  })
  win.addEventListener('popstate', schedule)
  const dispose = () => {
    stopped = true
    if (scheduled) win.cancelAnimationFrame(scheduled)
    observer.disconnect()
    button.removeEventListener('pointerdown', pointerDown)
    button.removeEventListener('click', click)
    doc.removeEventListener('focusout', remember, true)
    doc.removeEventListener('selectionchange', selection)
    doc.removeEventListener('select', remember, true)
    doc.removeEventListener('input', schedule, true)
    doc.removeEventListener('compositionstart', composition, true)
    doc.removeEventListener('compositionend', composition, true)
    win.removeEventListener('popstate', schedule)
    win.removeEventListener('pagehide', dispose)
    root.remove()
    captured = editor = null
  }
  win.addEventListener('pagehide', dispose, { once: true })
  if (enabled) refresh()
  return dispose
}
