import { describe, expect, it } from 'vitest'
import { getPage, listPages, registerPage } from '../src/modules/dsh/ui/pages/registry.mjs'

describe('page registry', () => {
  it('lists pages in registration order and rejects duplicates', () => {
    const conversation = { id: 'conversation', title: 'Chat', render: () => null }
    const settings = { id: 'settings', title: 'Settings', render: () => null }
    registerPage(conversation)
    registerPage(settings)
    expect(listPages().map((p) => p.id)).toEqual(['conversation', 'settings'])
    expect(getPage('settings')).toBe(settings)
    expect(getPage('missing')).toBe(null)
    expect(() => registerPage(conversation)).toThrow(/duplicate id "conversation"/)
  })
})
