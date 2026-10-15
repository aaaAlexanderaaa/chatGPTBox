import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextWhenReady } from '../src/utils/clipboard.mjs'

afterEach(() => vi.unstubAllGlobals())

function mockClipboard(write) {
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(data) {
        this.data = data
      }
    },
  )
  vi.stubGlobal('navigator', { clipboard: { write } })
}

describe('copying asynchronously prepared text', () => {
  it('starts the clipboard write during the click and waits for all the text', async () => {
    let finishReading
    const reading = new Promise((resolve) => {
      finishReading = resolve
    })
    const readText = vi.fn(() => reading)
    const write = vi.fn(async ([item]) => {
      const blob = await item.data['text/plain']
      expect(blob.type).toBe('text/plain')
      expect(await blob.text()).toBe('# 会话\n\nFirst message\n\nLast message\n')
    })
    mockClipboard(write)

    const copying = copyTextWhenReady(readText)
    expect(write).toHaveBeenCalledTimes(1)
    expect(readText).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(readText).toHaveBeenCalledTimes(1)
    finishReading('# 会话\n\nFirst message\n\nLast message\n')
    await copying
  })

  it('supports browsers that only provide writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const text = '{\n  "title": "报告",\n  "messages": ["one", "two"]\n}'
    await copyTextWhenReady(async () => text)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text)
  })

  it('reports the loading error even when the clipboard rejects first', async () => {
    let failReading
    const reading = new Promise((resolve, reject) => {
      failReading = reject
    })
    const loadError = new Error('Conversation history is incomplete; try loading it again')
    mockClipboard(vi.fn().mockRejectedValue(new Error('Permission denied')))

    let settled = false
    const copying = copyTextWhenReady(() => reading).finally(() => {
      settled = true
    })
    const assertion = expect(copying).rejects.toBe(loadError)
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    failReading(loadError)
    await assertion
  })

  it('does not report success when writing the prepared text fails', async () => {
    const denied = new Error('Permission denied')
    mockClipboard(vi.fn().mockRejectedValue(denied))
    await expect(copyTextWhenReady(async () => 'Complete conversation')).rejects.toMatchObject({
      message: 'Could not copy to clipboard. Please try again.',
      cause: denied,
    })
  })
})
