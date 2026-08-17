/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chrome controls', () => {
  it('PresetSelect uses the roster model and does not hard-code four modes', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/chrome/PresetSelect.jsx'),
      'utf8',
    )
    expect(src).toMatch(/pickerPresets/)
    expect(src).toMatch(/isPresetLocked/)
    expect(src).not.toMatch(/PTC/)
    expect(src).not.toMatch(/创造模式/)
  })

  it('WorkspaceEmpty has no dead control when the native picker is missing', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/chrome/WorkspaceEmpty.jsx'),
      'utf8',
    )
    expect(src).toMatch(/directory-picker-unavailable/)
    expect(src).not.toMatch(/cockpit/i)
  })
})
