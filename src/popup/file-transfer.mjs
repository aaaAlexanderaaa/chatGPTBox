// Small file-pick/download helpers shared by the settings tabs (config
// export/import, ChatGPT history backup). Extracted from PopupNew when the
// history backup moved into the chatgptweb module card (roadmap C1) so both
// call sites share one focus-safe picker implementation.

export const CHATGPT_HISTORY_VOLUME_DOWNLOAD_DELAY_MS = 400

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadJsonFile(data, filename, { pretty = true } = {}) {
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  downloadTextFile(json, filename)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildChatgptHistoryVolumeFilename(exportedAt, volumeIndex, volumeCount) {
  const stamp = String(exportedAt || new Date().toISOString()).replace(/[:.]/g, '-')
  const part = String(volumeIndex).padStart(2, '0')
  const of = String(volumeCount).padStart(2, '0')
  return `chatgptbox-chatgpt-history-${stamp}-part${part}-of-${of}.json`
}

async function writeTextFilesToDirectory(directoryHandle, files = []) {
  for (const file of files) {
    const handle = await directoryHandle.getFileHandle(file.filename, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(file.contents)
    } finally {
      await writable.close()
    }
  }
}

export async function downloadChatgptHistoryVolumes(
  exportResult,
  { delayMs = CHATGPT_HISTORY_VOLUME_DOWNLOAD_DELAY_MS } = {},
) {
  const volumes = Array.isArray(exportResult) ? exportResult : exportResult?.volumes || []
  const files = volumes.map((volume) => {
    const index = Number(volume?.volume?.index) || 1
    const count = Number(volume?.volume?.count) || volumes.length || 1
    return {
      filename: buildChatgptHistoryVolumeFilename(volume?.exportedAt, index, count),
      contents: JSON.stringify(volume),
    }
  })

  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      await writeTextFilesToDirectory(directoryHandle, files)
      return { method: 'directory', count: files.length, cancelled: false }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { method: 'directory', count: 0, cancelled: true }
      }
      throw error
    }
  }

  for (let index = 0; index < files.length; index += 1) {
    downloadTextFile(files[index].contents, files[index].filename)
    if (index < files.length - 1) await sleep(delayMs)
  }
  return { method: 'download', count: files.length, cancelled: false }
}

function pickJsonFilesInternal({ multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.multiple = multiple === true
    let settled = false
    let focusTimer = null

    const snapshotFiles = () => Array.from(input.files || [])

    const finish = (files = []) => {
      if (settled) return
      settled = true
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer)
      }
      window.removeEventListener('focus', handleWindowFocus, true)
      input.removeEventListener('cancel', handleCancel)
      resolve(multiple ? files : files[0] || null)
    }

    const handleCancel = () => finish([])

    const handleWindowFocus = () => {
      focusTimer = window.setTimeout(() => {
        finish(snapshotFiles())
      }, 400)
    }

    input.onchange = () => finish(snapshotFiles())
    input.addEventListener('cancel', handleCancel)
    window.addEventListener('focus', handleWindowFocus, true)
    input.click()
  })
}

export function pickJsonFile() {
  return pickJsonFilesInternal({ multiple: false })
}

export function pickJsonFiles() {
  return pickJsonFilesInternal({ multiple: true })
}
