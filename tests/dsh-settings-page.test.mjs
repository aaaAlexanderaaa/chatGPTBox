/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSettingsNotExposed,
  sectionsFromDescribeResult,
  settingsTabForNamespace,
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

  it('preset roster sets default via settings.mutate on agent-presets', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/PresetRoster.jsx'),
      'utf8',
    )
    expect(src).toMatch(/Set default/)
    expect(src).toMatch(/settings\.describe/)
    expect(src).toMatch(/settings\.mutate/)
    expect(src).toMatch(/settingsMutatePayload/)
    expect(src).toMatch(/fieldsFromDescribe/)
    expect(src).toMatch(/agent-presets/)
    expect(src).not.toMatch(/标准|PTC|极简|创造/)
  })

  it('models tab offers credentials.unset for present credentials', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    expect(src).toMatch(/credentials\.unset/)
    expect(src).toMatch(/Unset/)
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

  it('reads the host describe envelope (namespaces + ns)', () => {
    const sections = sectionsFromDescribeResult({
      writable: true,
      hasDocument: true,
      namespaces: [
        { ns: 'locale', revision: 1, schema: {}, value: {} },
        { ns: 'agent-presets', revision: 4, schema: {}, value: { default: 'standard' } },
      ],
    })
    expect(sections.map((section) => section.namespace || section.ns)).toEqual([
      'locale',
      'agent-presets',
    ])
    expect(
      sections.find((section) => (section.namespace || section.ns) === 'agent-presets'),
    ).toMatchObject({
      revision: 4,
      value: { default: 'standard' },
    })
  })

  it('still accepts a sections/namespace describe envelope', () => {
    const sections = sectionsFromDescribeResult({
      sections: [{ namespace: 'locale', revision: 2 }],
    })
    expect(sections).toEqual([{ namespace: 'locale', revision: 2 }])
  })

  it('quiets describe failures when settings are not exposed', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    expect(src).toMatch(/isSettingsNotExposed/)
    expect(src).not.toMatch(/settings-not-exposed/)
  })

  it('puts locale/theme/permission in General and llm namespaces in Models', () => {
    expect(settingsTabForNamespace('locale')).toBe('general')
    expect(settingsTabForNamespace('ui-theme')).toBe('general')
    expect(settingsTabForNamespace('permission')).toBe('general')
    expect(settingsTabForNamespace('ui-conversation')).toBe('general')
    expect(settingsTabForNamespace('llm-deepseek')).toBe('models')
    expect(settingsTabForNamespace('llm-pi-ai')).toBe('models')
    expect(settingsTabForNamespace('agent-loop')).toBe('plugins')
    expect(settingsTabForNamespace('shell')).toBe('plugins')
    expect(settingsTabForNamespace('web-search-deepseek')).toBe('plugins')
    expect(settingsTabForNamespace('agent-presets')).toBe('presets')
    expect(settingsTabForNamespace('ui-onboarding')).toBe(null)
  })

  it('hides official-client-only namespaces and routes agent-default-model to Models', () => {
    // Since upstream rc.8 settings.describe serves every registered namespace,
    // the extension must opt out of the ones that only configure the official
    // React client.
    expect(settingsTabForNamespace('sidebar')).toBe(null)
    expect(settingsTabForNamespace('settings')).toBe(null)
    expect(settingsTabForNamespace('agent-default-model')).toBe('models')
  })

  it('tells the models form how to write a base URL', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    expect(src).toMatch(/https:\/\/api\.deepseek\.com/)
    expect(src).toMatch(/\/v1/)
    expect(src).toMatch(/openai-completions/)
    expect(src).toMatch(/openai-responses/)
    expect(src).toMatch(/discoverModelsPayload/)
    expect(src).toMatch(/credentialsDescribePayload/)
  })
})
