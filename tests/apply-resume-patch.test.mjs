import { afterEach, describe, expect, it } from 'vitest'
import { applyResumePatch } from '../src/services/clients/chatgpt-web/conversation-api.mjs'

afterEach(() => {
  delete Object.prototype.autoClean
  delete Object.prototype.polluted
})

describe('applyResumePatch', () => {
  it('applies a normal add operation', () => {
    const target = {}
    applyResumePatch(target, { p: '/message/content/parts/0', o: 'add', v: 'hello' })
    expect(target.message.content.parts[0]).toBe('hello')
  })

  it('appends to an existing string', () => {
    const target = { message: { text: 'foo' } }
    applyResumePatch(target, { p: '/message/text', o: 'append', v: 'bar' })
    expect(target.message.text).toBe('foobar')
  })

  it('refuses to walk through __proto__', () => {
    const target = {}
    applyResumePatch(target, { p: '/__proto__/autoClean', o: 'add', v: true })
    expect({}.autoClean).toBeUndefined()
    expect(Object.prototype.autoClean).toBeUndefined()
    // The patch must be dropped outright, not redirected into a fresh object
    // hung off the target's prototype slot.
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
    expect(Object.keys(target)).toEqual([])
  })

  it('refuses constructor and prototype segments', () => {
    const target = {}
    applyResumePatch(target, { p: '/constructor/prototype/polluted', o: 'add', v: true })
    expect({}.polluted).toBeUndefined()
    applyResumePatch(target, { p: '/message/prototype/polluted', o: 'replace', v: true })
    expect({}.polluted).toBeUndefined()
  })

  it('truncates a string at the pointer', () => {
    const target = { message: { text: 'Hello world' } }
    expect(applyResumePatch(target, { p: '/message/text', o: 'truncate', v: 5 })).toBe(true)
    expect(target.message.text).toBe('Hello')
  })

  it('ignores an empty path', () => {
    const target = { keep: 1 }
    applyResumePatch(target, { p: '', o: 'add', v: 'x' })
    expect(target).toEqual({ keep: 1 })
  })

  it('does not write through a non-object container', () => {
    const target = { message: 'a string' }
    expect(() =>
      applyResumePatch(target, { p: '/message/length/0', o: 'add', v: 'x' }),
    ).not.toThrow()
    expect(target.message).toBe('a string')
  })
})
