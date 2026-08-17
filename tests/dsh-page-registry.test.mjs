import { describe, expect, it } from 'vitest'
import { getPage, listPages, registerPage } from '../src/modules/dsh/ui/pages/registry.mjs'

describe('page registry', () => {
  it('lists pages in registration order and rejects duplicates', () => {
    const pageA = { id: 'page-a', title: 'Page A', render: () => null }
    const pageB = { id: 'page-b', title: 'Page B', render: () => null }
    registerPage(pageA)
    registerPage(pageB)
    expect(listPages().map((p) => p.id)).toEqual(['page-a', 'page-b'])
    expect(getPage('page-b')).toBe(pageB)
    expect(getPage('missing')).toBe(null)
    expect(() => registerPage(pageA)).toThrow(/duplicate id "page-a"/)
  })
})
