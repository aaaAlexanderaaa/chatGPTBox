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
      if (
        url.origin !== 'https://gemini.gstatic.com' ||
        (!url.pathname.startsWith('/_/js/') &&
          !url.pathname.startsWith('/_/mss/boq-gemini-web-uiserver/_/js/'))
      )
        continue
      const version = url.pathname.match(/\/k=([^/]+)\//)?.[1]
      let decodedPath
      try {
        decodedPath = decodeURIComponent(url.pathname)
      } catch {
        return { ok: false }
      }
      if (
        !version ||
        !/^boq-gemini-web-uiserver\.BardChatUi\.[a-zA-Z0-9_.-]{1,180}$/.test(version) ||
        /(?:^|\/)\.\.?(?:\/|$)/.test(decodedPath) ||
        url.username ||
        url.password ||
        (url.search && !/^\?wli=BardChatUi\.[a-zA-Z0-9_.%:-]{1,200}$/.test(url.search)) ||
        url.hash
      )
        return { ok: false }
      urls.add(url.href)
      versions.add(version)
    } catch {
      /* unrelated resources */
    }
  }
  if (versions.size !== 1 || !urls.size) return { ok: false }
  const allUrls = [...urls].sort()
  let sourceUrls = allUrls
  let scope
  if (allUrls.length > 4) {
    const runtimeUrls = allUrls.filter((raw) => /\/m=_b(?:\/|$)/.test(new URL(raw).pathname))
    const vLefieUrls = allUrls.filter((raw) => {
      const pathname = new URL(raw).pathname
      return !/\/m=_b(?:\/|$)/.test(pathname) && /\/m=vLefie(?:\/|$)/.test(pathname)
    })
    const appUrls =
      vLefieUrls.length === 1
        ? vLefieUrls
        : allUrls.filter((raw) => {
            const pathname = new URL(raw).pathname
            return !/\/m=_b(?:\/|$)/.test(pathname) && /\/exm=_b\//.test(pathname)
          })
    if (runtimeUrls.length !== 1 || appUrls.length !== 1) return { ok: false }
    sourceUrls = [...runtimeUrls, ...appUrls].sort()
    scope = 'core'
  }
  const nonce = crypto.randomUUID(),
    version = [...versions][0]
  window.__chatgptboxGeminiCodeProofV1 = scope
    ? { runtime, nonce, version, sourceUrls, scope }
    : { runtime, nonce, version, sourceUrls }
  return scope
    ? { ok: true, nonce, version, sourceUrls, scope }
    : { ok: true, nonce, version, sourceUrls }
}
