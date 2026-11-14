import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  acquireReadingSnapshot,
  annotationLocation,
  captureContext,
} from '../src/browser-assistant/context.mjs'
import {
  createYouTubeSummaryPrompt,
  parseYouTubeSubtitles,
} from '../src/browser-assistant/youtube.mjs'
import { prepareFunctionRun, createFunction } from '../src/browser-assistant/functions.mjs'
import { revealAnnotation } from '../src/browser-assistant/effects.mjs'

const url = 'https://www.youtube.com/watch?v=abcdefghijk'
const page = (html = '<main>Page chrome is not a transcript</main>') =>
  new JSDOM(html, { url }).window.document
const transcript =
  '<ytd-transcript-segment-renderer><span class="segment-timestamp">1:05</span><span class="segment-text">A useful claim and its evidence.</span></ytd-transcript-segment-renderer>'
const currentTranscript =
  '<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp" aria-hidden="true">1:05</div><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">1 minute, 5 seconds</div><span role="text">A useful claim and its evidence.</span></transcript-segment-view-model>'
const config = {
  modelName: 'chatgptweb/model',
  chatgptWebEnabled: true,
  chatgptWebEnabledModels: ['model'],
}

describe('shared YouTube material', () => {
  it.each([transcript, currentTranscript])(
    'gives summary and a changed saved method the same frozen subtitle material, with working time navigation',
    async (markup) => {
      const doc = page(markup + '<video></video>')
      const context = captureContext({ doc })
      const snapshot = await acquireReadingSnapshot(context)
      const fn = createFunction({
        scope: 'page',
        prompt: 'Check the evidence.',
        output: 'annotations',
      })
      doc.querySelector('.segment-text, span[role="text"]').textContent =
        'Later page text must not replace the preview.'
      const prepared = prepareFunctionRun({ fn, context, config, snapshot })
      expect(prepared.material).toContain('00:01:05 A useful claim')
      expect(prepared.prompt).not.toContain('Later page text')
      expect(createYouTubeSummaryPrompt(snapshot)).toContain(
        JSON.stringify({ material: prepared.material }),
      )
      const annotation = { ref: 'b1', quote: 'useful claim', reason: 'Evidence' }
      expect(annotationLocation(snapshot, annotation)).toEqual({ startSeconds: 65 })
      doc.querySelector('video').scrollIntoView = vi.fn()
      revealAnnotation(snapshot, annotation)
      expect(doc.querySelector('video').currentTime).toBe(65)
      expect(() => annotationLocation(snapshot, { ...annotation, quote: 'invented' })).toThrow(
        'Quote does not match',
      )
      const nextDoc = new JSDOM(transcript.replace('A useful claim', 'Different video'), {
        url: 'https://www.youtube.com/watch?v=lmnopqrstuv',
      }).window.document
      const next = await acquireReadingSnapshot(captureContext({ doc: nextDoc }))
      expect(next.videoId).toBe('lmnopqrstuv')
      expect(next.blocks[0].text).toContain('Different video')
      expect(fn).not.toHaveProperty('material')
    },
  )

  it('refuses page chrome and hidden transcript as video content, without a provider call', async () => {
    const doc = page('<main>NOT_VIDEO</main><div hidden>' + transcript + '</div>')
    await expect(acquireReadingSnapshot(captureContext({ doc }))).rejects.toThrow(
      'Turn on YouTube captions',
    )
  })

  it('reuses only the current video native subtitle GET and omits its private URL from prepared material', async () => {
    const doc = page()
    const native = url.replace('/watch?', '/api/timedtext?') + '&lang=en&pot=PRIVATE_SENTINEL'
    doc.defaultView.performance.getEntriesByType = () => [
      { name: native.replace('abcdefghijk', 'wrongvideo1') },
      { name: native },
      { name: 'https://evil.example/api/timedtext?v=abcdefghijk' },
    ]
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ events: [{ tStartMs: 2000, segs: [{ utf8: 'Verified subtitle.' }] }] }),
        ),
      )
    const snapshot = await acquireReadingSnapshot(captureContext({ doc }), 'page', { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(native)
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(snapshot.blocks[0].text).toBe('00:00:02 Verified subtitle.')
    expect(createYouTubeSummaryPrompt(snapshot)).not.toContain('PRIVATE_SENTINEL')
    expect(snapshot).not.toHaveProperty('nativeUrl')
  })

  it('rejects a result after video navigation and does not fetch a second track', async () => {
    const doc = page()
    doc.defaultView.performance.getEntriesByType = () => [
      { name: 'https://www.youtube.com/api/timedtext?v=abcdefghijk' },
    ]
    const fetch = vi.fn(async () => {
      doc.defaultView.history.replaceState({}, '', '/watch?v=lmnopqrstuv')
      return new Response('<transcript><text start="1">Old video.</text></transcript>')
    })
    await expect(
      acquireReadingSnapshot(captureContext({ doc }), 'page', { fetch }),
    ).rejects.toThrow('page changed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps explicit selection material independent of caption availability', async () => {
    const doc = page('<main><p>Selected visible passage.</p></main>')
    const range = doc.createRange()
    range.selectNodeContents(doc.querySelector('p'))
    doc.defaultView.getSelection().addRange(range)
    const snapshot = await acquireReadingSnapshot(captureContext({ doc }), 'selection')
    expect(snapshot.blocks[0].text).toBe('Selected visible passage.')
    expect(snapshot.kind).toBeUndefined()
  })

  it.each([
    '<transcript><text start="1.5">One &amp; two.</text></transcript>',
    '<timedtext><body><p t="1500"><s>One &amp; </s><s>two.</s></p></body></timedtext>',
  ])('reads native XML variants without evaluating markup', (xml) => {
    expect(parseYouTubeSubtitles(xml, page())).toEqual([{ start: 1.5, text: 'One & two.' }])
  })

  it('marks shortened material and refuses oversized subtitle responses', async () => {
    const doc = page(transcript)
    const snapshot = await acquireReadingSnapshot(captureContext({ doc }), 'page', { maxChars: 22 })
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.blocks[0].quoteText).toBe('A useful')
    expect(
      snapshot.blocks.map((block) => `[${block.ref}] ${block.text}`).join('\n\n'),
    ).toHaveLength(22)
    doc.body.innerHTML = ''
    doc.defaultView.performance.getEntriesByType = () => [
      { name: 'https://www.youtube.com/api/timedtext?v=abcdefghijk' },
    ]
    await expect(
      acquireReadingSnapshot(captureContext({ doc }), 'page', {
        fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
      }),
    ).rejects.toThrow('Turn on YouTube captions')
  })
})
