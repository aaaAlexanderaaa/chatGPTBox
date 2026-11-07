// Serialized into MAIN. Inspect public module code only: never return account
// snapshots, challenge results, request bodies, or token values to the extension.
export async function inspectChatgptWebRuntimeInPage(
  contracts,
  loadModule = (url) => import(/* webpackIgnore: true */ url),
) {
  if (location.origin !== 'https://chatgpt.com' || window.top !== window) return []
  const urls = new Map()
  const conflictingUrls = new Set()
  // Startup script/preload nodes and resource timing may no longer expose
  // imports. The current React Router entry/root manifest still names them.
  // Do not inspect other routes or application bootstrap/account data.
  const manifest = window.__reactRouterManifest
  const entries = [manifest?.entry, manifest?.routes?.root]
  for (const raw of [
    ...[...document.scripts].map((node) => node.src),
    ...[...document.querySelectorAll('link[rel="modulepreload"]')].map((node) => node.href),
    ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ...entries.flatMap((entry) => [
      entry?.module,
      ...(Array.isArray(entry?.imports) ? entry.imports.slice(0, 256) : []),
    ]),
  ]) {
    try {
      if (typeof raw !== 'string' || !raw) continue
      const url = new URL(raw, location.origin)
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        ['chatgpt.com', 'cdn.oaistatic.com'].includes(url.hostname) &&
        /\/assets\/[^/]+\.js$/.test(url.pathname)
      ) {
        const key = url.origin + url.pathname
        if (urls.has(key) && urls.get(key) !== url.href) conflictingUrls.add(key)
        else urls.set(key, url.href)
      }
    } catch {
      // Ignore non-script resources.
    }
  }
  const observedUrls = [...urls].filter(([key]) => !conflictingUrls.has(key)).map(([, url]) => url)
  const knownFilenames = new Set(contracts.map((entry) => entry.filename))
  const prefixes = new Set(contracts.map((entry) => entry.filename.split(/[.-]/)[0]))
  const hinted = observedUrls.filter((url) =>
    prefixes.has(new URL(url).pathname.split('/').pop().split(/[.-]/)[0]),
  )
  const others = observedUrls.filter((url) => !hinted.includes(url))
  const runtimes = []
  const seen = new Set()
  let inspectedBytes = 0
  const deadline = Date.now() + 20000
  for (const url of [...hinted, ...others]) {
    if (Date.now() > deadline) break
    try {
      // Prefixes prioritize discovery, but only an exact verified filename can
      // skip source inspection. Importing an unknown module executes its code.
      if (!knownFilenames.has(new URL(url).pathname.split('/').pop())) {
        if (inspectedBytes > 4000000) break
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2500)
        let source = ''
        try {
          const response = await fetch(url, {
            credentials: 'omit',
            signal: controller.signal,
          })
          if (!response.ok || Number(response.headers.get('content-length')) > 500000) continue
          const reader = response.body?.getReader()
          if (!reader) continue
          const decoder = new TextDecoder()
          let bytes = 0
          try {
            while (bytes <= 500000) {
              const chunk = await reader.read()
              if (chunk.done) break
              bytes += chunk.value.byteLength
              inspectedBytes += chunk.value.byteLength
              source += decoder.decode(chunk.value, { stream: true })
            }
          } finally {
            await reader.cancel().catch(() => {})
            reader.releaseLock()
          }
          if (bytes > 500000 || !/export\s*\{[^}]*\b__webpack_require__\b/.test(source)) continue
        } finally {
          clearTimeout(timer)
        }
      }
      const runtime = await loadModule(url)
      const require = runtime.__webpack_require__
      if (typeof require !== 'function' || !require.m || seen.has(require)) continue
      seen.add(require)
      const graph = {}
      const modules = []
      for (const [id, factory] of Object.entries(require.m)) {
        if (typeof factory !== 'function') continue
        const source = Function.prototype.toString.call(factory)
        const parameters = source.match(/^[^(]*\(([^)]*)\)/)?.[1].split(',') || []
        const loader = parameters[2]?.trim()
        if (loader && /^[\w$]+$/.test(loader)) {
          const escaped = loader.replace(/\$/g, '\\$')
          graph[id] = [
            ...source.matchAll(new RegExp(`\\b${escaped}\\(["']([^"']+)["']\\)`, 'g')),
          ].map((match) => match[1])
        }
        const requestRole =
          /\bRequest\s*:/.test(source) && source.includes('getChatGptRequestProfile')
        const authRole =
          ['loadBrowserChatGptAuth', 'getBrowserChatGptAuthSnapshot'].every((name) =>
            source.includes(name),
          ) &&
          (source.includes('isSameBrowserRequestAuthContext') ||
            ['getBrowserChatGptAuthGeneration', 'isBrowserWorkspaceSwitchPending'].every((name) =>
              source.includes(name),
            ))
        const integrityRole = [
          'OpenAI-Sentinel-Chat-Requirements-Token',
          'OpenAI-Sentinel-Proof-Token',
          'OpenAI-Sentinel-Turnstile-Token',
        ].every((name) => source.includes(name))
        const fetchRole = source.includes('.expectedIdentity') && source.includes('.retry')
        const wrapperRole = source.includes('new WeakMap') && /\bfetch\s*[(,)]/.test(source)
        const delegateRole = source.includes('ces_diag_id') && source.includes('/ces/v1/rgstr')
        if (
          !requestRole &&
          !authRole &&
          !integrityRole &&
          !fetchRole &&
          !wrapperRole &&
          !delegateRole
        )
          continue
        try {
          const exports = require.c?.[id]?.exports || require(id)
          const functions = {}
          for (const key of Object.keys(exports)) {
            const value = exports[key]
            if (typeof value !== 'function') continue
            const body = Function.prototype.toString.call(value)
            if (body.length <= 40000) functions[key] = body
          }
          const request = exports.Request
          const requestMethods = {}
          if (requestRole && request) {
            for (const key of ['getRequestTarget', 'safePost']) {
              if (typeof request[key] === 'function')
                requestMethods[key] = Function.prototype.toString.call(request[key])
            }
          }
          modules.push({
            id,
            source: source.length <= 150000 ? source : '',
            functions,
            requestMethods,
          })
        } catch {
          // An unrelated or not-yet-ready factory is not a compatible candidate.
        }
      }
      runtimes.push({ url, graph, modules })
    } catch {
      // Try another observed official runtime; no question has been sent.
    }
  }
  return runtimes
}
