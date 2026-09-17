import { afterEach, describe, expect, it, vi } from 'vitest'
import { limitedFetch } from '../src/utils/limited-fetch.mjs'

describe('limitedFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockXhr() {
    let instance
    class XMLHttpRequest {
      constructor() {
        instance = this
        this.status = 0
        this.responseText = ''
      }
      open() {}
      send() {}
      abort() {}
    }
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequest)
    return () => instance
  }

  it('resolves 2xx bodies truncated to maxBytes', async () => {
    const getXhr = mockXhr()
    const pending = limitedFetch('https://example.com/a.patch', 4)
    const xhr = getXhr()
    xhr.status = 200
    xhr.responseText = 'abcdefgh'
    xhr.onload({ target: xhr })
    await expect(pending).resolves.toBe('abcd')
  })

  it('rejects 4xx so error pages are not treated as patch text', async () => {
    const getXhr = mockXhr()
    const pending = limitedFetch('https://example.com/a.patch', 100)
    const xhr = getXhr()
    xhr.status = 404
    xhr.responseText = '<html>not found</html>'
    xhr.onload({ target: xhr })
    await expect(pending).rejects.toThrow()
  })

  it('rejects non-2xx during onprogress once maxBytes is reached', async () => {
    const getXhr = mockXhr()
    const pending = limitedFetch('https://example.com/a.patch', 8)
    const xhr = getXhr()
    xhr.status = 403
    xhr.responseText = 'error page body!!!!'
    xhr.onprogress({ target: xhr, loaded: 20 })
    await expect(pending).rejects.toThrow()
  })
})
