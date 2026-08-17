/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSettingsNotExposed,
  sectionsFromDescribeResult,
} from '../src/modules/dsh/ui/pages/settings/load-sections.mjs'

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

  it('preset roster catches mutation failures', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/PresetRoster.jsx'),
      'utf8',
    )
    expect(src).toMatch(/try\s*\{[\s\S]*agentPreset\.copy[\s\S]*catch/)
    expect(src).toMatch(/try\s*\{[\s\S]*agentPreset\.remove[\s\S]*catch/)
    expect(src).toMatch(/try\s*\{[\s\S]*agentPreset\.read[\s\S]*catch/)
    expect(src).toMatch(/try\s*\{[\s\S]*agentPreset\.openDocument[\s\S]*catch/)
    expect(src).toMatch(/setError\(/)
  })

  it('schema form resets draft secrets after values or revision change', () => {
    const form = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SchemaForm.jsx'),
      'utf8',
    )
    const page = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    const resetsInForm =
      /useEffect\([\s\S]*setDraft[\s\S]*setTouchedSecrets[\s\S]*section\.?revision|useEffect\([\s\S]*setTouchedSecrets[\s\S]*setDraft[\s\S]*section\.?revision|useEffect\([\s\S]*values[\s\S]*revision/.test(
        form,
      )
    const remountsWithRevision = /key=\{[^}]*revision/.test(page)
    expect(resetsInForm || remountsWithRevision).toBe(true)
    expect(form).toMatch(/touchedSecrets/)
  })

  it('omits a section the host did not expose', () => {
    expect(sectionsFromDescribeResult(null, { code: 'settings-not-exposed' })).toEqual([])
    expect(
      sectionsFromDescribeResult(null, new Error('[dsh settings-not-exposed] hidden')),
    ).toEqual([])
    expect(isSettingsNotExposed({ code: 'settings-not-exposed' })).toBe(true)
    expect(isSettingsNotExposed(new Error('[dsh settings-not-exposed] hidden'))).toBe(true)
    expect(isSettingsNotExposed(new Error('[dsh settings-conflict]'))).toBe(false)
  })

  it('quiets describe failures when settings are not exposed', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    expect(src).toMatch(/isSettingsNotExposed/)
    expect(src).not.toMatch(/settings-not-exposed/)
  })
})
