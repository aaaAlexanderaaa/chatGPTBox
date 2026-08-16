import { describe, expect, it } from 'vitest'
import { grokwebModule } from '../src/modules/grokweb/module.mjs'
import { getModules } from '../src/modules/index.mjs'

describe('grokweb module', () => {
  it('registers as an engines settings roof', () => {
    expect(grokwebModule.id).toBe('grokweb')
    expect(grokwebModule.settingsPlacement).toBe('engines')
    expect(getModules().some((m) => m.id === 'grokweb')).toBe(true)
  })
})
