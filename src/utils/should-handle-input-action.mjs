// Click always sends/stops. Bare Enter (keyCode 13 / key === 'Enter') does
// too, unless IME composition is in progress. Shift+Enter inserts a newline.
// keyCode 229 is the Windows IME composition sentinel; macOS uses isComposing.
export function shouldHandleInputAction(event) {
  if (event.type === 'click') return true

  const isEnter = event.key === 'Enter' || event.keyCode === 13
  if (!isEnter || event.shiftKey) return false
  if (event.keyCode === 229) return false
  if (event.isComposing || event.nativeEvent?.isComposing) return false

  return true
}
