import { describe, expect, it } from 'vitest'
import { abbreviateHome } from '../src/modules/dsh/ui/models/home-path.mjs'

describe('abbreviateHome', () => {
  it('collapses the home prefix to ~', () => {
    expect(abbreviateHome('/Users/alex/Workspace/proj', '/Users/alex')).toBe('~/Workspace/proj')
    expect(abbreviateHome('/Users/alex', '/Users/alex')).toBe('~')
  })

  it('never abbreviates a mere prefix-sibling or a missing home', () => {
    expect(abbreviateHome('/Users/alexander/proj', '/Users/alex')).toBe('/Users/alexander/proj')
    expect(abbreviateHome('/etc/hosts', '/Users/alex')).toBe('/etc/hosts')
    expect(abbreviateHome('/Users/alex/proj', '')).toBe('/Users/alex/proj')
    expect(abbreviateHome('/Users/alex/proj', null)).toBe('/Users/alex/proj')
    expect(abbreviateHome('', '/Users/alex')).toBe('')
  })

  it('tolerates a trailing slash on home', () => {
    expect(abbreviateHome('/Users/alex/proj', '/Users/alex/')).toBe('~/proj')
  })
})
