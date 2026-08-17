/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPage, listPages } from '../src/modules/dsh/ui/pages/registry.mjs'

describe('conversation page', () => {
  it('registers as conversation and renders user blocks as bubbles', async () => {
    await import('../src/modules/dsh/ui/pages/conversation/index.mjs')
    expect(getPage('conversation')?.id).toBe('conversation')
    expect(listPages().some((page) => page.id === 'conversation')).toBe(true)
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/conversation/Conversation.jsx'),
      'utf8',
    )
    expect(src).toMatch(/kind === 'user'/)
    expect(src).toMatch(/dsh-user-bubble/)
    expect(src).not.toMatch(/台账/)
    expect(src).not.toMatch(/cockpit/i)
  })
})
