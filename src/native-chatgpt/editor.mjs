// Site semantics live here; the provider module does not own native page UX.
export {
  readEditableRange as nativeRangeText,
  readEditableText as editorText,
} from '../utils/editable-text.mjs'
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
  // November 13 logged-in composer: the native markdown editor no longer has
  // prompt-textarea. Require its form/composer ancestry and native markers;
  // unrelated ProseMirror editors are not main chat inputs.
  const candidates = doc.querySelectorAll(
    '#prompt-textarea, textarea#mobile-composer-prompt, ' +
      'form [data-composer-body] [data-composer-input] ' +
      'div.ProseMirror[data-composer-markdown][role="textbox"][aria-multiline="true"][contenteditable="true"]',
  )
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
