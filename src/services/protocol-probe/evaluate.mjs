export function filenameFromScriptUrl(url) {
  if (typeof url !== 'string' || !url) return ''
  try {
    const path = new URL(url, 'https://example.invalid').pathname
    const name = path.split('/').pop() || ''
    return name.split('?')[0]
  } catch {
    const cleaned = url.split('?')[0]
    return cleaned.split('/').pop() || ''
  }
}

export function collectScriptUrls({
  scriptSrcs = [],
  preloadHrefs = [],
  resourceUrls = [],
  base = 'https://example.invalid',
} = {}) {
  const seen = new Set()
  const urls = []
  for (const raw of [...scriptSrcs, ...preloadHrefs, ...resourceUrls]) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    let href = raw.trim()
    try {
      href = new URL(href, base).href
    } catch {
      // keep the raw token
    }
    if (seen.has(href)) continue
    seen.add(href)
    urls.push(href)
  }
  return urls
}

export function listKnownFilenames(spec) {
  const fromRoles = (spec?.roles || []).flatMap((role) => role.knownFilenames || [])
  return [...new Set([...(spec?.knownFilenames || []), ...fromRoles])]
}

export function isExcludedScriptUrl(url, spec) {
  const hay = String(url || '').toLowerCase()
  return (spec?.excludeUrlIncludes || []).some((item) => hay.includes(String(item).toLowerCase()))
}

export function isStaticHostUrl(url, spec) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (spec?.staticHosts || []).some((candidate) => {
      const needle = String(candidate || '').toLowerCase()
      return needle && (host === needle || host.endsWith(`.${needle}`))
    })
  } catch {
    return false
  }
}

export function isAllowedProbeFetchUrl(url, spec) {
  if (!isStaticHostUrl(url, spec)) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export function looksLikeAppBundle(filename, spec) {
  if (typeof filename !== 'string' || !filename.endsWith('.js')) return false
  if ((spec?.urlHints || []).some((hint) => filename.includes(hint))) return true
  return /^[a-f0-9]{8}-[a-z0-9]+\.js$/i.test(filename)
}

export function summarizeScripts(scriptUrls, spec) {
  const known = new Set(listKnownFilenames(spec))
  const hints = spec?.urlHints || []
  const scripts = []
  for (const url of scriptUrls || []) {
    if (typeof url !== 'string' || !url) continue
    if (isExcludedScriptUrl(url, spec)) continue
    const filename = filenameFromScriptUrl(url)
    scripts.push({
      url,
      filename,
      known: known.has(filename),
      hinted: hints.some((hint) => url.includes(hint) || filename.includes(hint)),
    })
  }
  return scripts
}

export function shouldDeepScan({
  spec,
  scripts,
  previous = null,
  now = Date.now(),
  periodicMs = 0,
  trigger = '',
} = {}) {
  if (!scripts?.length) return false
  if (trigger === 'manual') return true
  if (!previous?.deepScannedAt) return true
  if (periodicMs > 0) {
    const last = Date.parse(previous.deepScannedAt)
    if (Number.isFinite(last) && now - last >= periodicMs) return true
  }
  // Already recorded today's drift. Do not refetch the same page on every load.
  if (['url_drift', 'marker_drift'].includes(previous.status)) return false
  const known = listKnownFilenames(spec)
  const present = new Set((scripts || []).map((script) => script.filename))
  return known.some((name) => !present.has(name))
}

export function selectFetchCandidates({ spec, scripts, maxFetch = 12 } = {}) {
  const selected = []
  const seen = new Set()
  const limit = Math.max(1, Number(maxFetch) || 12)

  const push = (script) => {
    if (!script?.url || seen.has(script.url) || selected.length >= limit) return
    if (!isAllowedProbeFetchUrl(script.url, spec)) return
    seen.add(script.url)
    selected.push(script)
  }

  for (const script of scripts || []) {
    if (script.hinted || script.known) push(script)
  }
  for (const script of scripts || []) {
    if (looksLikeAppBundle(script.filename, spec)) push(script)
  }
  return selected
}

export function classifyFetchedScripts(spec, fetched = []) {
  const files = (fetched || []).filter((file) => typeof file?.text === 'string')
  const claimed = new Set()
  const roles = {}

  for (const role of spec?.roles || []) {
    const identify = role.identifyAll || []
    const required = role.requiredMarkers || identify
    const match =
      files.find(
        (file) =>
          !claimed.has(file.url || file.filename) &&
          identify.every((marker) => file.text.includes(marker)),
      ) || null
    if (match) claimed.add(match.url || match.filename)
    roles[role.id] = {
      id: role.id,
      label: role.label,
      url: match?.url || null,
      filename: match?.filename || null,
      missing: required.filter((marker) => !match?.text.includes(marker)),
    }
  }

  return roles
}

export function allRolesIdentified(spec, roles) {
  return (spec?.roles || []).every((role) => Boolean(roles?.[role.id]?.filename))
}

export function formatProtocolProbeFilenameUpdates(report) {
  const mapped = (report?.roleUpdates || [])
    .filter((item) => item.current && !(item.expected || []).includes(item.current))
    .map((item) => `${(item.expected || [])[0] || '—'} → ${item.current}`)
  if (mapped.length) return mapped.join('; ')
  return (report?.newAppFilenames || []).join(', ')
}

export function shouldNotifyProtocolProbe(previous, next) {
  if (!next || !['url_drift', 'marker_drift'].includes(next.status)) return false
  return previous?.status !== next.status
}

export function evaluateProtocolProbe({
  spec,
  scriptUrls,
  fetched = [],
  scanned = false,
  previous = null,
  trigger = 'unknown',
  pageUrl = '',
  hostname = '',
  error = null,
} = {}) {
  const scripts = summarizeScripts(scriptUrls, spec)
  const known = listKnownFilenames(spec)
  const presentNames = new Set(scripts.map((script) => script.filename))
  const knownPresent = known.filter((name) => presentNames.has(name))
  const knownMissing = known.filter((name) => !presentNames.has(name))
  const haveBodies = (fetched || []).some((file) => typeof file?.text === 'string' && file.text)
  const usedScan = scanned && haveBodies
  const roles = usedScan ? classifyFetchedScripts(spec, fetched) : {}
  const roleList = Object.values(roles)
  const knownUnidentified = usedScan
    ? (spec?.roles || []).filter((role) => {
        const expected = role.knownFilenames || []
        return expected.some((name) => presentNames.has(name)) && !roles[role.id]?.filename
      })
    : []
  const missingMarkers = [
    ...new Set([
      ...roleList
        .filter((role) => role.filename)
        .flatMap((role) => (Array.isArray(role.missing) ? role.missing : [])),
      ...knownUnidentified.flatMap((role) => role.requiredMarkers || role.identifyAll || []),
    ]),
  ]
  const roleUpdates = (spec?.roles || []).map((role) => ({
    id: role.id,
    label: role.label || role.id,
    expected: [...(role.knownFilenames || [])],
    current:
      roles[role.id]?.filename ||
      (role.knownFilenames || []).find((name) => presentNames.has(name)) ||
      null,
  }))
  const assigned = new Set(roleUpdates.map((item) => item.current).filter(Boolean))
  const mappedCount = roleUpdates.filter((item) => item.current).length
  const newAppFilenames = [
    ...new Set(
      scripts
        .filter(
          (script) =>
            script.filename &&
            !script.known &&
            !assigned.has(script.filename) &&
            (script.hinted || looksLikeAppBundle(script.filename, spec)),
        )
        .map((script) => script.filename),
    ),
  ]

  let status = 'ok'
  if (scripts.length === 0) status = 'incomplete'
  else if (usedScan && (missingMarkers.length > 0 || knownUnidentified.length > 0)) {
    status = 'marker_drift'
  } else if (error || (scanned && !haveBodies)) status = 'error'
  else if (knownMissing.length > 0) {
    if (mappedCount > 0 || trigger === 'manual') status = 'url_drift'
    else status = 'incomplete'
  } else if (!usedScan && previous?.status === 'marker_drift') {
    status = previous.status
  }

  return {
    specId: spec?.id || '',
    label: spec?.label || spec?.id || '',
    status,
    trigger,
    pageUrl,
    hostname: hostname || '',
    knownPresent,
    knownMissing,
    newAppFilenames,
    roleUpdates,
    missingMarkers,
    scanned: usedScan,
    deepScannedAt: previous?.deepScannedAt || null,
    error: error ? String(error.message || error) : null,
  }
}
