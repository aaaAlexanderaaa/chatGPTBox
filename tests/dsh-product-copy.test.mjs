/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('product docs for the full client', () => {
  it('records D-23 and no longer titles the surface 驾驶舱', () => {
    const decisions = readFileSync(path.resolve(process.cwd(), 'docs/product/decisions.md'), 'utf8')
    expect(decisions).toMatch(/### D-23/)
    expect(decisions).toMatch(/被 D-23 取代/)
    const ui = readFileSync(path.resolve(process.cwd(), 'docs/product/ui-console.md'), 'utf8')
    expect(ui.startsWith('# 驾驶舱')).toBe(false)
    expect(ui).toMatch(/DeepSeek Harness/)
  })
})
