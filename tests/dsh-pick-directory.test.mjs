import { describe, expect, it } from 'vitest'
import { pickedDirectoryPath } from '../src/modules/dsh/ui/models/pick-directory.mjs'

describe('pickedDirectoryPath', () => {
  it('unwraps the live { path } envelope and treats null as cancel', () => {
    expect(pickedDirectoryPath({ path: '/tmp/proj' })).toBe('/tmp/proj')
    expect(pickedDirectoryPath({ path: null })).toBe(null)
    expect(pickedDirectoryPath({ path: '' })).toBe(null)
  })

  it('rejects a nested object so workspace.create never receives { path: { path } }', () => {
    expect(pickedDirectoryPath({ path: { path: '/tmp/proj' } })).toBe(null)
  })
})
