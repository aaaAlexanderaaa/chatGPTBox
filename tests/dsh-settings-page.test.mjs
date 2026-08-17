/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sectionsFromDescribeResult } from '../src/modules/dsh/ui/pages/settings/load-sections.mjs'

describe('settings page', () => {
  it('mutates with expectedRevision and never invents namespaces', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    expect(src).toMatch(/settings\.describe/)
    expect(src).toMatch(/settingsMutatePayload/)
    expect(src).toMatch(/isSettingsConflict/)
    expect(src).toMatch(/sectionsFromDescribeResult/)
    expect(src).not.toMatch(/settings-not-exposed/)
    expect(src).not.toMatch(/cockpit/i)
  })

  it('preset roster copies instead of editing YAML', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/PresetRoster.jsx'),
      'utf8',
    )
    expect(src).toMatch(/agentPreset\.copy/)
    expect(src).toMatch(/agentPreset\.remove/)
    expect(src).toMatch(/hasDocument/)
  })

  it('omits a section the host did not expose', () => {
    expect(sectionsFromDescribeResult(null, { code: 'settings-not-exposed' })).toEqual([])
    expect(
      sectionsFromDescribeResult(null, new Error('[dsh settings-not-exposed] hidden')),
    ).toEqual([])
  })
})
