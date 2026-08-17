/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Allowed internal helper name — strip before the negative cockpit assertion
// (same idea as COCKPIT_IDENTIFIER_RE in dsh-review-fixes.test.mjs).
const ALLOWED_COCKPIT_IDENTIFIERS = /\bresolveCockpitSelection\b/g

describe('shell', () => {
  it('never says cockpit and wires workspace create through pickDirectory', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    expect(src).toMatch(/host\.pickDirectory/)
    expect(src).toMatch(/workspace\.create/)
    expect(src).toMatch(/session\.create/)
    expect(src).toMatch(/agentPreset/)
    const withoutAllowed = src.replace(ALLOWED_COCKPIT_IDENTIFIERS, '')
    expect(withoutAllowed).not.toMatch(/cockpit/i)
    expect(withoutAllowed).not.toMatch(/Cockpit/)
  })
})
