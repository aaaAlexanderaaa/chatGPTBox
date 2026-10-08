const CHATGPT_WEB_CITATION_TOKEN_RE = /\uE200cite\uE202[^\uE201]*\uE201/g

function cleanupChatgptWebReferenceArtifacts(text) {
  if (typeof text !== 'string' || !text) return ''
  return text.replace(CHATGPT_WEB_CITATION_TOKEN_RE, '')
}

function collectReferenceUrls(reference) {
  const items = Array.isArray(reference?.items) ? reference.items : []
  const primary = items[0]
  if (!primary) return []

  const urls = []
  const primaryUrl = typeof primary.url === 'string' ? primary.url.trim() : ''
  const primaryTitle = typeof primary.title === 'string' ? primary.title.trim() : ''
  const primaryAttr = typeof primary.attribution === 'string' ? primary.attribution.trim() : ''
  if (primaryUrl)
    urls.push({ url: primaryUrl, title: primaryTitle || primaryUrl, attribution: primaryAttr })

  const sw = Array.isArray(primary.supporting_websites) ? primary.supporting_websites : []
  for (const site of sw) {
    if (!site) continue
    const sUrl = typeof site.url === 'string' ? site.url.trim() : ''
    const sTitle = typeof site.title === 'string' ? site.title.trim() : ''
    const sAttr = typeof site.attribution === 'string' ? site.attribution.trim() : ''
    if (sUrl) urls.push({ url: sUrl, title: sTitle || sUrl, attribution: sAttr })
  }
  return urls
}

export function normalizeChatgptWebReferenceText(
  text,
  contentReferences = [],
  { preserveUnresolvedCitations = false } = {},
) {
  let nextText = typeof text === 'string' ? text : ''
  if (!nextText) return ''

  const refs = Array.isArray(contentReferences) ? contentReferences.filter(Boolean) : []
  if (!refs.length)
    return preserveUnresolvedCitations ? nextText : cleanupChatgptWebReferenceArtifacts(nextText)

  // Build global deduplicated reference index (url -> sequential number)
  const urlToIndex = new Map()
  const indexedRefs = [] // [{url, title, attribution}] — 1-based via position+1

  function getOrAddRef(url, title, attribution) {
    const key = url.replace(/\?utm_source=chatgpt\.com$/, '')
    if (urlToIndex.has(key)) return urlToIndex.get(key)
    const idx = indexedRefs.length + 1
    urlToIndex.set(key, idx)
    indexedRefs.push({ url: key, title, attribution: attribution || '' })
    return idx
  }

  // First pass: register all URLs so numbering is stable (sorted by start_idx)
  const sortedRefs = refs
    .filter((r) => r?.type === 'grouped_webpages' || r?.type === 'nav_list')
    .sort((a, b) => (a.start_idx ?? Infinity) - (b.start_idx ?? Infinity))

  for (const ref of sortedRefs) {
    if (ref.type === 'grouped_webpages') {
      for (const u of collectReferenceUrls(ref)) getOrAddRef(u.url, u.title, u.attribution)
    } else if (ref.type === 'nav_list') {
      const items = Array.isArray(ref.items) ? ref.items : []
      for (const item of items) {
        if (!item) continue
        const url = typeof item.url === 'string' ? item.url.trim() : ''
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const attr = typeof item.attribution === 'string' ? item.attribution.trim() : ''
        if (url) getOrAddRef(url, title, attr)
      }
    }
  }

  // Build replacements
  const replacements = []
  for (const ref of refs) {
    const matchedText = typeof ref.matched_text === 'string' ? ref.matched_text : ''
    if (!matchedText || !matchedText.trim()) continue

    let replacement = ''
    if (ref.type === 'grouped_webpages') {
      const urls = collectReferenceUrls(ref)
      if (urls.length) {
        const indices = urls.map((u) => getOrAddRef(u.url, u.title))
        const unique = [...new Set(indices)]
        replacement = unique
          .map((i) => {
            const r = indexedRefs[i - 1]
            const label = r.attribution || r.title
            return `[${label}][${i}]`
          })
          .join(' ')
      } else {
        replacement = typeof ref.alt === 'string' ? ref.alt : ''
      }
    } else if (ref.type === 'nav_list') {
      const items = Array.isArray(ref.items) ? ref.items : []
      const links = items
        .filter((item) => item && typeof item.url === 'string')
        .map((item) => {
          const url = item.url.trim()
          const title = typeof item.title === 'string' ? item.title.trim() : url
          return `- [${title}](${url})`
        })
      replacement = links.length ? '\n' + links.join('\n') + '\n' : ''
    } else if (ref.type === 'sources_footnote') {
      replacement = ''
    } else {
      replacement = typeof ref.alt === 'string' ? ref.alt : ''
    }

    replacements.push({
      matchedText,
      replacement,
      start: Number.isInteger(ref.start_idx) ? ref.start_idx : null,
      end: Number.isInteger(ref.end_idx) ? ref.end_idx : null,
    })
  }

  // Sort by start descending so index-based replacements don't shift
  replacements.sort((left, right) => {
    const leftStart = Number.isInteger(left.start) ? left.start : -1
    const rightStart = Number.isInteger(right.start) ? right.start : -1
    return rightStart - leftStart
  })

  for (const { matchedText, replacement, start, end } of replacements) {
    const canReplaceByRange =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= nextText.length &&
      nextText.slice(start, end) === matchedText

    if (canReplaceByRange) {
      nextText = `${nextText.slice(0, start)}${replacement}${nextText.slice(end)}`
      continue
    }

    if (nextText.includes(matchedText)) {
      nextText = nextText.split(matchedText).join(replacement)
    }
  }

  if (!preserveUnresolvedCitations) nextText = cleanupChatgptWebReferenceArtifacts(nextText)

  // Append reference-style link definitions
  if (indexedRefs.length > 0) {
    const defs = indexedRefs.map((r, i) => {
      const escaped = r.title.replace(/"/g, '\\"')
      return `[${i + 1}]: <${r.url}> "${escaped}"`
    })
    nextText = nextText.trimEnd() + '\n\n' + defs.join('\n')
  }

  return nextText
}
