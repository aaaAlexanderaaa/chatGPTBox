export async function copyTextWhenReady(readText) {
  const content = Promise.resolve()
    .then(readText)
    .then((text) => new Blob([text], { type: 'text/plain' }))
  const writing = (async () => {
    if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
      // Start the write during the click, before loading the conversation can
      // outlast the browser's user activation window.
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })])
    }
    return navigator.clipboard.writeText(await (await content).text())
  })()
  const [prepared, copied] = await Promise.allSettled([content, writing])
  if (prepared.status === 'rejected') throw prepared.reason
  if (copied.status === 'rejected') {
    throw new Error('Could not copy to clipboard. Please try again.', { cause: copied.reason })
  }
}
