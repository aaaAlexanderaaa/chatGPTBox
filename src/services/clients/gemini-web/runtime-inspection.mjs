// Serialized into MAIN. Only the loaded public compilation inventory leaves
// the page. Never read accounts, conversation state, credentials or payloads.
export function inspectGeminiPublicCompilation() {
  if (
    location.origin !== 'https://gemini.google.com' ||
    window.top !== window ||
    !/^\/app(?:\/[a-zA-Z0-9_-]+)?\/?$/.test(location.pathname)
  )
    return { ok: false }
  const runtime = window.default_BardChatUi
  if (!runtime || typeof runtime !== 'object') return { ok: false }
  const urls = new Set(),
    versions = new Set()
  for (const raw of [...document.scripts]
    .map((script) => script.src)
    .concat(performance.getEntriesByType('resource').map((entry) => entry.name))) {
    try {
      const url = new URL(raw)
      if (url.origin !== 'https://gemini.gstatic.com' || !url.pathname.startsWith('/_/js/'))
        continue
      const version = url.pathname.match(/\/k=([^/]+)\//)?.[1]
      if (
        !version ||
        !/^boq-gemini-web-uiserver\.BardChatUi\.[a-zA-Z0-9_.-]{1,180}$/.test(version) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return { ok: false }
      urls.add(url.href)
      versions.add(version)
    } catch {
      /* unrelated resources */
    }
  }
  if (versions.size !== 1 || !urls.size || urls.size > 4) return { ok: false }
  const nonce = crypto.randomUUID(),
    version = [...versions][0],
    sourceUrls = [...urls].sort()
  window.__chatgptboxGeminiCodeProofV1 = { runtime, nonce, version, sourceUrls }
  return { ok: true, nonce, version, sourceUrls }
}
