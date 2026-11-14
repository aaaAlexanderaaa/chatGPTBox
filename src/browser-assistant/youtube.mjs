const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024

export function youtubeVideoId(raw) {
  try {
    const url = new URL(raw)
    const id = url.searchParams.get('v')
    return url.origin === 'https://www.youtube.com' &&
      url.pathname === '/watch' &&
      /^[a-zA-Z0-9_-]{11}$/.test(id || '')
      ? id
      : null
  } catch {
    return null
  }
}

const unavailable = () =>
  new Error('Turn on YouTube captions or open its transcript, then retry reading the material.')

function visible(element, win) {
  for (let node = element; node; node = node.parentElement) {
    const style = win.getComputedStyle(node)
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

export function parseYouTubeSubtitles(text, doc) {
  let cues
  if (text.trimStart().startsWith('{')) {
    const data = JSON.parse(text)
    if (!Array.isArray(data.events)) throw unavailable()
    cues = data.events
      .filter((event) => Array.isArray(event.segs))
      .map((event) => ({
        start: event.tStartMs / 1000,
        text: event.segs.map((segment) => segment.utf8 || '').join(''),
      }))
  } else {
    const xml = new doc.defaultView.DOMParser().parseFromString(text, 'text/xml')
    if (xml.querySelector('parsererror')) throw unavailable()
    cues = [...xml.querySelectorAll('text[start], p[t]')].map((node) => ({
      start: node.hasAttribute('start')
        ? Number(node.getAttribute('start'))
        : Number(node.getAttribute('t')) / 1000,
      text: node.textContent,
    }))
  }
  return cues.filter((cue) => Number.isFinite(cue.start) && cue.start >= 0 && cue.text?.trim())
}

async function readBounded(response) {
  if (!response.ok || Number(response.headers?.get('content-length')) > MAX_SUBTITLE_BYTES)
    throw unavailable()
  if (!response.body?.getReader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > MAX_SUBTITLE_BYTES) throw unavailable()
    return text
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let bytes = 0,
    text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_SUBTITLE_BYTES) throw unavailable()
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function acquireYouTubeSnapshot(context, { maxChars = 30000, fetch: fetcher } = {}) {
  const doc = context.document,
    win = doc.defaultView,
    videoId = youtubeVideoId(context.url)
  if (!videoId || doc.location.href !== context.url) throw new Error('The page changed')
  let cues = [
    ...doc.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model'),
  ]
    .filter((node) => visible(node, win))
    .map((node) => {
      const current = node.matches('transcript-segment-view-model')
      const stamp = node
        .querySelector(current ? '.ytwTranscriptSegmentViewModelTimestamp' : '.segment-timestamp')
        ?.textContent.trim()
      const parts = stamp?.split(':').map(Number)
      return {
        start:
          parts?.length >= 2 && parts.length <= 3 && parts.every(Number.isFinite)
            ? parts.reduce((total, part) => total * 60 + part, 0)
            : NaN,
        text: node.querySelector(current ? ':scope > span[role="text"]' : '.segment-text')
          ?.textContent,
      }
    })
    .filter((cue) => Number.isFinite(cue.start) && cue.text?.trim())
  let source = 'YouTube loaded transcript'
  if (!cues.length) {
    const urls = win.performance.getEntriesByType?.('resource') || []
    const nativeUrl = urls
      .slice(-256)
      .map((entry) => {
        try {
          const url = new URL(entry.name)
          return url.origin === 'https://www.youtube.com' &&
            url.pathname === '/api/timedtext' &&
            url.searchParams.get('v') === videoId
            ? url.href
            : null
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .at(-1)
    if (!nativeUrl) throw unavailable()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      // Only a site-observed read URL; no player changes or invented tokens.
      const response = await (fetcher || win.fetch.bind(win))(nativeUrl, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      })
      cues = parseYouTubeSubtitles(await readBounded(response), doc)
    } finally {
      clearTimeout(timeout)
    }
    source = 'YouTube subtitles'
  }
  if (doc.location.href !== context.url) throw new Error('The page changed')
  if (!cues.length) throw unavailable()
  const blocks = []
  let remaining = maxChars,
    truncated = false
  for (const cue of cues) {
    const raw = cue.text.trim()
    const seconds = Math.floor(cue.start)
    const stamp = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, '0'))
      .join(':')
    const ref = `b${blocks.length + 1}`
    const overhead = `[${ref}] ${stamp} `.length + (blocks.length ? 2 : 0)
    if (remaining <= overhead) {
      truncated = true
      break
    }
    const text = raw.slice(0, remaining - overhead)
    truncated ||= text.length < raw.length
    blocks.push({
      ref,
      text: `${stamp} ${text}`,
      quoteText: text,
      startSeconds: cue.start,
    })
    remaining -= overhead + text.length
  }
  return {
    kind: 'video-subtitles',
    videoId,
    url: context.url,
    document: doc,
    source,
    blocks,
    truncated,
  }
}

export function createYouTubeSummaryPrompt(snapshot) {
  const material = snapshot.blocks.map((block) => `[${block.ref}] ${block.text}`).join('\n\n')
  return `Summarize this YouTube video using only the supplied subtitles. Include key ideas, evidence and uncertainties. The available subtitle material${
    snapshot.truncated
      ? ' was shortened to this preview'
      : ' is not proof of complete video coverage'
  }.\n${JSON.stringify({ material })}`
}
