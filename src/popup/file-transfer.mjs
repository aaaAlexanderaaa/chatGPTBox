// Small file-pick/download helpers shared by the settings tabs (config
// export/import, ChatGPT history backup). Extracted from PopupNew when the
// history backup moved into the chatgptweb module card (roadmap C1) so both
// call sites share one focus-safe picker implementation.

export function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    let settled = false
    let focusTimer = null

    const finish = (file = null) => {
      if (settled) return
      settled = true
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer)
      }
      window.removeEventListener('focus', handleWindowFocus, true)
      input.removeEventListener('cancel', handleCancel)
      resolve(file)
    }

    const handleCancel = () => finish(null)

    const handleWindowFocus = () => {
      focusTimer = window.setTimeout(() => {
        finish(input.files?.[0] || null)
      }, 400)
    }

    input.onchange = (event) => finish(event.target.files?.[0] || null)
    input.addEventListener('cancel', handleCancel)
    window.addEventListener('focus', handleWindowFocus, true)
    input.click()
  })
}
