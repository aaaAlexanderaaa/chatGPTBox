import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserConfig = vi.hoisted(() => vi.fn())

vi.mock('../src/config/index.mjs', () => ({
  getUserConfig,
}))

import { cropText } from '../src/utils/crop-text.mjs'

describe('cropText', () => {
  beforeEach(() => {
    getUserConfig.mockReset()
  })

  it('returns the original text when cropText is disabled', async () => {
    getUserConfig.mockResolvedValue({ cropText: false })
    const text = 'keep me'
    expect(await cropText(text)).toBe(text)
  })

  it('does not subtract maxResponseTokenLength from the crop budget', async () => {
    getUserConfig.mockResolvedValue({
      cropText: true,
      apiMode: null,
      modelName: 'unknownModel',
      customModelName: '',
      maxResponseTokenLength: 384000,
    })
    // Under the old formula this 384k cap left ~1900 tokens and would crop.
    const text = `${'a'.repeat(3000)}`
    expect(await cropText(text, 8000, 800, 600, false)).toBe(text)
  })

  it('still honors an Nk hint in the model name', async () => {
    getUserConfig.mockResolvedValue({
      cropText: true,
      apiMode: null,
      modelName: 'custom-2k',
      customModelName: '',
      maxResponseTokenLength: 384000,
    })
    const text = `${'word,'.repeat(800)}end`
    const cropped = await cropText(text, 8000, 800, 600, false)
    expect(cropped.length).toBeLessThan(text.length)
  })
})
