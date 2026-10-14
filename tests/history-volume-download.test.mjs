import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadChatgptHistoryVolumes } from '../src/popup/file-transfer.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('history volume downloads', () => {
  it('serializes each volume only when the preceding file has been written and closed', async () => {
    const events = []
    const volumes = [1, 2].map((index) => ({
      volume: { index, count: 2 },
      toJSON() {
        events.push(`serialize-${index}`)
        return { index }
      },
    }))
    let count = 0
    const directory = {
      async getFileHandle() {
        const index = ++count
        return {
          async createWritable() {
            return {
              async write(contents) {
                events.push(`write-${index}`)
                expect(JSON.parse(contents)).toEqual({ index })
              },
              async close() {
                events.push(`close-${index}`)
              },
            }
          },
        }
      },
    }
    vi.stubGlobal('window', { showDirectoryPicker: async () => directory })
    const result = await downloadChatgptHistoryVolumes({ volumes }, { delayMs: 0 })
    expect(events).toEqual([
      'serialize-1',
      'write-1',
      'close-1',
      'serialize-2',
      'write-2',
      'close-2',
    ])
    expect(result).toMatchObject({ method: 'directory', count: 2, cancelled: false })
  })

  it('does not serialize any files when directory selection is cancelled', async () => {
    const toJSON = vi.fn()
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
      },
    })
    expect(await downloadChatgptHistoryVolumes({ volumes: [{ toJSON }] })).toMatchObject({
      cancelled: true,
      count: 0,
    })
    expect(toJSON).not.toHaveBeenCalled()
  })
})
