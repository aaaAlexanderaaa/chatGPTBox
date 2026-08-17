import { describe, expect, it } from 'vitest'
import { fieldsFromDescribe } from '../src/modules/dsh/ui/models/schema-fields.mjs'
import {
  isSettingsConflict,
  settingsMutatePayload,
} from '../src/modules/dsh/ui/models/settings-write.mjs'

describe('settings-write', () => {
  it('sends expectedRevision with each mutate', () => {
    expect(
      settingsMutatePayload({
        namespace: 'locale',
        ops: [{ kind: 'set', path: 'language', value: 'zh' }],
        expectedRevision: 3,
      }),
    ).toEqual({
      namespace: 'locale',
      ops: [{ kind: 'set', path: 'language', value: 'zh' }],
      expectedRevision: 3,
    })
  })

  it('detects settings-conflict and nothing else', () => {
    expect(isSettingsConflict({ code: 'settings-conflict' })).toBe(true)
    expect(isSettingsConflict({ code: 'settings-rejected' })).toBe(false)
    expect(isSettingsConflict(null)).toBe(false)
  })
})

describe('schema-fields', () => {
  it('flattens object properties and flags secrets', () => {
    const fields = fieldsFromDescribe({
      namespace: 'llm.deepseek',
      secrets: ['apiKey'],
      schema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string', title: 'API Key' },
          baseUrl: { type: 'string', title: 'Base URL' },
        },
      },
    })
    expect(fields).toEqual([
      { path: 'apiKey', type: 'string', title: 'API Key', secret: true },
      { path: 'baseUrl', type: 'string', title: 'Base URL', secret: false },
    ])
  })

  it('returns no fields when the namespace has no schema', () => {
    expect(fieldsFromDescribe({ namespace: 'x' })).toEqual([])
  })
})
