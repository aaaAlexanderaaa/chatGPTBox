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

  it('detects directory-picker-unavailable via includes (DshRpcError message prefix)', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    expect(src).toMatch(/\.includes\(['"]directory-picker-unavailable['"]\)/)
    expect(src).not.toMatch(/error\?\.message\s*===\s*['"]directory-picker-unavailable['"]/)
  })

  it('renders settings before WorkspaceEmpty when online', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    const mainStart = src.indexOf('let main = null')
    expect(mainStart).toBeGreaterThan(-1)
    const returnStart = src.indexOf('return (', mainStart)
    const mainSection = src.slice(mainStart, returnStart)
    const settingsIdx = mainSection.indexOf("activePage === 'settings'")
    const emptyIdx = mainSection.indexOf('WorkspaceEmpty')
    expect(settingsIdx).toBeGreaterThan(-1)
    expect(emptyIdx).toBeGreaterThan(-1)
    expect(settingsIdx).toBeLessThan(emptyIdx)
  })

  it('wires Add workspace and blank-session agentPreset.select', () => {
    const app = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    const sidebar = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/shell/Sidebar.jsx'),
      'utf8',
    )
    expect(app).toMatch(/onAddWorkspace=\{addWorkspace\}/)
    expect(app).toMatch(/agentPreset\.select/)
    expect(sidebar).toMatch(/onAddWorkspace/)
    expect(sidebar).toMatch(/Add workspace/)
  })

  it('unwraps host.pickDirectory { path } before workspace.create', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    expect(src).toMatch(/pickedDirectoryPath/)
  })

  it('surfaces add-workspace failures instead of swallowing them', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    expect(src).toMatch(/setPickerError\(detail\)/)
  })
})
