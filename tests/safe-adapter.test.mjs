import { describe, expect, it, vi } from 'vitest'
import { logAdapterError, safeAdapter } from '../src/content-script/site-adapters/_helpers.mjs'

describe('safeAdapter', () => {
  it('returns the wrapped function result on success', async () => {
    const wrapped = safeAdapter('test.success', async (a, b) => a + b)
    expect(await wrapped(2, 3)).toBe(5)
  })

  it('swallows thrown errors and returns undefined', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const wrapped = safeAdapter('test.fail', async () => {
      throw new Error('boom')
    })
    const result = await wrapped()
    expect(result).toBeUndefined()
    expect(debug).toHaveBeenCalled()
    debug.mockRestore()
  })

  it('logs error with adapter name prefix', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const wrapped = safeAdapter('myadapter.thing', async () => {
      throw new Error('boom')
    })
    await wrapped()
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('[site-adapter:myadapter.thing]'),
      expect.any(Error),
    )
    debug.mockRestore()
  })
})

describe('logAdapterError', () => {
  it('writes to console.debug with adapter name prefix', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const error = new Error('x')
    logAdapterError('foo.init', error)
    expect(debug).toHaveBeenCalledWith('[site-adapter:foo.init]', error)
    debug.mockRestore()
  })
})
