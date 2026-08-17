/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  permissionOptions,
  planChipVisible,
} from '../src/modules/dsh/ui/models/permission-model.mjs'

describe('permission-model', () => {
  it('marks full access as danger', () => {
    const rows = permissionOptions({
      presets: ['workspace-write', 'danger-full-access'],
    })
    expect(rows.find((r) => r.id === 'danger-full-access').danger).toBe(true)
    expect(rows.find((r) => r.id === 'workspace-write').danger).toBe(false)
  })

  it('falls back to options and title-cases labels', () => {
    const rows = permissionOptions({ options: ['full-access'] })
    expect(rows).toEqual([{ id: 'full-access', label: 'Full Access', danger: true }])
  })
})

describe('planChipVisible', () => {
  it('follows the host folded pending/active rule', () => {
    expect(planChipVisible({ active: false, pending: true })).toBe(true)
    expect(planChipVisible({ active: true, pending: false })).toBe(true)
    expect(planChipVisible({ active: true, pending: true })).toBe(false)
    expect(planChipVisible(null)).toBe(false)
  })
})

describe('composer extras source scans', () => {
  const read = (relative) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

  it('PermissionSelect confirms danger picks before executing', () => {
    const src = read('src/modules/dsh/ui/chrome/PermissionSelect.jsx')
    expect(src).toMatch(/permissionOptions/)
    expect(src).toMatch(/I understand/)
    expect(src).toMatch(/<dialog/)
    expect(src).not.toMatch(/cockpit/i)
    expect(src).not.toMatch(/驾驶舱/)
  })

  it('PlanChip visibility and turn-off use the model + /plan off', () => {
    const src = read('src/modules/dsh/ui/chrome/PlanChip.jsx')
    expect(src).toMatch(/planChipVisible/)
    expect(src).toMatch(/Plan ×/)
    expect(src).toMatch(/onTurnOff/)
  })

  it('CommandMenu lists commands and inserts skills', () => {
    const src = read('src/modules/dsh/ui/chrome/CommandMenu.jsx')
    expect(src).toMatch(/command\.list/)
    expect(src).toMatch(/command\.execute/)
    expect(src).toMatch(/skill\.list/)
    expect(src).toMatch(/onInsert/)
  })

  it('CommandMenu dismisses on Escape and outside click', () => {
    const src = read('src/modules/dsh/ui/chrome/CommandMenu.jsx')
    expect(src).toMatch(/Escape/)
    expect(src).toMatch(/mousedown|click/)
  })

  it('Composer gates queue Edit on textOnly', () => {
    const src = read('src/modules/dsh/ui/Composer.jsx')
    expect(src).toMatch(/item\.textOnly/)
  })

  it('Composer wires extras, queue replace, and empty-draft steer', () => {
    const src = read('src/modules/dsh/ui/Composer.jsx')
    expect(src).toMatch(/CommandMenu/)
    expect(src).toMatch(/PermissionSelect/)
    expect(src).toMatch(/PlanChip/)
    expect(src).toMatch(/session\.queue-replace/)
    expect(src).toMatch(/mode:\s*'steer'/)
    expect(src).toMatch(/session\.queue-remove/)
    expect(src).not.toMatch(/cockpit/i)
    expect(src).not.toMatch(/驾驶舱/)
    expect(src).not.toMatch(/标准模式|PTC|极简|创造/)
  })

  it('Composer and chrome together expose the required rpc strings', () => {
    const combined = [
      'src/modules/dsh/ui/Composer.jsx',
      'src/modules/dsh/ui/chrome/CommandMenu.jsx',
      'src/modules/dsh/ui/chrome/PermissionSelect.jsx',
      'src/modules/dsh/ui/chrome/PlanChip.jsx',
    ]
      .map(read)
      .join('\n')
    expect(combined).toMatch(/command\.list/)
    expect(combined).toMatch(/command\.execute/)
    expect(combined).toMatch(/skill\.list/)
    expect(combined).toMatch(/session\.queue-replace/)
    expect(combined).toMatch(/mode:\s*'steer'/)
  })
})
