import { collectScriptUrls } from './evaluate.mjs'

function isScriptResourceName(name) {
  return typeof name === 'string' && /\.m?js(\?|#|$)/i.test(name)
}

/**
 * Collect every script URL the page has loaded so far: classic <script src>,
 * modulepreload / preload-as-script, and Performance resource entries
 * (covers dynamic import() chunks that never become a script tag).
 */
export function collectPageScriptSnapshot(
  doc = typeof document !== 'undefined' ? document : null,
  loc = typeof location !== 'undefined' ? location : null,
  perf = typeof performance !== 'undefined' ? performance : null,
) {
  const scriptSrcs = doc?.scripts ? [...doc.scripts].map((node) => node.src).filter(Boolean) : []
  const preloadHrefs = doc?.querySelectorAll
    ? [...doc.querySelectorAll('link[rel="modulepreload"], link[rel="preload"][as="script"]')]
        .map((node) => node.href)
        .filter(Boolean)
    : []
  let resourceUrls = []
  try {
    resourceUrls = (perf?.getEntriesByType?.('resource') || [])
      .map((entry) => entry?.name)
      .filter(isScriptResourceName)
  } catch {
    resourceUrls = []
  }
  const pageUrl = loc?.href || ''
  const hostname = loc?.hostname || ''
  const base = loc?.origin || pageUrl || 'https://example.invalid'
  return {
    pageUrl,
    hostname,
    scripts: collectScriptUrls({ scriptSrcs, preloadHrefs, resourceUrls, base }),
  }
}

/** Inlined into `scripting.executeScript` — keep this a closed function body. */
export function collectPageScriptSnapshotInPage() {
  const scriptSrcs = [...document.scripts].map((node) => node.src).filter(Boolean)
  const preloadHrefs = [
    ...document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"][as="script"]'),
  ]
    .map((node) => node.href)
    .filter(Boolean)
  let resourceUrls = []
  try {
    resourceUrls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => typeof name === 'string' && /\.m?js(\?|#|$)/i.test(name))
  } catch {
    resourceUrls = []
  }
  const seen = new Set()
  const scripts = []
  for (const raw of [...scriptSrcs, ...preloadHrefs, ...resourceUrls]) {
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    scripts.push(raw)
  }
  return { pageUrl: location.href, hostname: location.hostname, scripts }
}
