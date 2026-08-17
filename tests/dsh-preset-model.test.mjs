import { describe, expect, it } from 'vitest'
import {
  defaultPresetId,
  isPresetLocked,
  pickerPresets,
  presetLabel,
} from '../src/modules/dsh/ui/models/preset-model.mjs'

const list = {
  presets: [
    { id: 'standard', name: '标准模式', description: 'full', trust: 'system', isDefault: true },
    { id: 'ghost', name: 'Broken', trust: 'user', isDefault: false, broken: 'missing composition' },
    { id: 'minimal', description: 'two tools', trust: 'system', isDefault: false },
  ],
}

describe('preset-model', () => {
  it('drops broken presets from the picker and keeps them out of the default', () => {
    expect(pickerPresets(list).map((p) => p.id)).toEqual(['standard', 'minimal'])
    expect(defaultPresetId(list)).toBe('standard')
  })

  it('falls back to id when name is missing', () => {
    expect(presetLabel({ id: 'minimal' })).toBe('minimal')
    expect(presetLabel({ id: 'standard', name: '标准模式' })).toBe('标准模式')
  })

  it('locks the picker after the first turn', () => {
    expect(isPresetLocked({ blank: true })).toBe(false)
    expect(isPresetLocked({ blank: false, agentPreset: 'standard' })).toBe(true)
    expect(isPresetLocked({})).toBe(true)
  })
})
