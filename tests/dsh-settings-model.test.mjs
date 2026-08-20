import { describe, expect, it } from 'vitest'
import { fieldsFromDescribe } from '../src/modules/dsh/ui/models/schema-fields.mjs'
import {
  isSettingsConflict,
  settingsDraftOps,
  settingsMutatePayload,
} from '../src/modules/dsh/ui/models/settings-write.mjs'
import {
  credentialsDescribePayload,
  credentialsSetPayload,
  credentialsUnsetPayload,
  deriveKeyRef,
  discoverModelsPayload,
} from '../src/modules/dsh/ui/models/credentials.mjs'

describe('settings-write', () => {
  it('sends expectedRevision with each mutate', () => {
    expect(
      settingsMutatePayload({
        namespace: 'locale',
        ops: [{ kind: 'set', path: 'language', value: 'zh' }],
        expectedRevision: 3,
      }),
    ).toEqual({
      ns: 'locale',
      ops: [{ op: 'set', path: ['language'], value: 'zh' }],
      expectedRevision: 3,
    })
  })

  it('writes agent-presets.default on the host mutate wire', () => {
    expect(
      settingsMutatePayload({
        namespace: 'agent-presets',
        ops: [{ kind: 'set', path: 'default', value: 'minimal' }],
        expectedRevision: 4,
      }),
    ).toEqual({
      ns: 'agent-presets',
      ops: [{ op: 'set', path: ['default'], value: 'minimal' }],
      expectedRevision: 4,
    })
  })

  it('passes through host-shaped mutate ops', () => {
    expect(
      settingsMutatePayload({
        ns: 'agent-presets',
        ops: [{ op: 'unset', path: ['default'] }],
        expectedRevision: 5,
      }),
    ).toEqual({
      ns: 'agent-presets',
      ops: [{ op: 'unset', path: ['default'] }],
      expectedRevision: 5,
    })
  })

  it('detects settings-conflict and nothing else', () => {
    expect(isSettingsConflict({ code: 'settings-conflict' })).toBe(true)
    expect(isSettingsConflict({ code: 'settings-rejected' })).toBe(false)
    expect(isSettingsConflict(null)).toBe(false)
  })

  it('detects settings-conflict from a port-thrown Error message', () => {
    expect(isSettingsConflict(new Error('[dsh settings-conflict] revision mismatch'))).toBe(true)
    expect(isSettingsConflict(new Error('[dsh settings-rejected] bad value'))).toBe(false)
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

  it('walks schema.dict the same way as properties', () => {
    const fields = fieldsFromDescribe({
      namespace: 'locale',
      secrets: ['token'],
      schema: {
        type: 'object',
        dict: {
          token: { type: 'string', title: 'Token' },
          language: { type: 'string', title: 'Language' },
        },
      },
    })
    expect(fields).toEqual([
      { path: 'token', type: 'string', title: 'Token', secret: true },
      { path: 'language', type: 'string', title: 'Language', secret: false },
    ])
  })

  it('returns no fields when the namespace has no schema', () => {
    expect(fieldsFromDescribe({ namespace: 'x' })).toEqual([])
  })

  it('walks schemastery { uid, refs } envelopes used by settings.describe', () => {
    const fields = fieldsFromDescribe({
      ns: 'ui-theme',
      secrets: [{ path: ['apiKey'], set: true }],
      schema: {
        uid: 1,
        refs: {
          1: {
            type: 'object',
            dict: {
              preference: { $ref: 2 },
              apiKey: { $ref: 6 },
              providers: { $ref: 7 },
            },
          },
          2: {
            type: 'union',
            list: [{ $ref: 3 }, { $ref: 4 }, { $ref: 5 }],
          },
          3: { type: 'const', value: 'light' },
          4: { type: 'const', value: 'dark' },
          5: { type: 'const', value: 'system' },
          6: { type: 'string' },
          7: { type: 'dict', inner: { $ref: 1 } },
        },
      },
    })
    expect(fields).toEqual([
      {
        path: 'preference',
        type: 'select',
        title: 'preference',
        secret: false,
        options: ['light', 'dark', 'system'],
      },
      { path: 'apiKey', type: 'string', title: 'apiKey', secret: true },
    ])
  })
})

describe('credentials and discover payloads', () => {
  it('describes credentials by POSIX refs, not by endpoint', () => {
    expect(deriveKeyRef('deepseek-official')).toBe('DEEPSEEK_OFFICIAL_API_KEY')
    expect(credentialsDescribePayload(['DEEPSEEK_API_KEY'])).toEqual({ refs: ['DEEPSEEK_API_KEY'] })
    expect(credentialsSetPayload({ ref: 'DEEPSEEK_API_KEY', value: 'sk-test' })).toEqual({
      ref: 'DEEPSEEK_API_KEY',
      value: 'sk-test',
    })
    expect(credentialsUnsetPayload({ ref: 'DEEPSEEK_API_KEY' })).toEqual({
      ref: 'DEEPSEEK_API_KEY',
    })
  })

  it('asks discoverModels with settingsNs + baseURL, not a completions path', () => {
    expect(
      discoverModelsPayload({
        settingsNs: 'llm-pi-ai',
        baseURL: 'https://gateway.example/v1',
        api: 'openai-completions',
        apiKey: 'sk-test',
      }),
    ).toEqual({
      settingsNs: 'llm-pi-ai',
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      apiKey: 'sk-test',
    })
  })
})

describe('settingsDraftOps', () => {
  const selectField = { path: 'theme', type: 'select', options: ['dark', 'light'] }

  it('emits unset when a select returns to the host default', () => {
    expect(
      settingsDraftOps({ fields: [selectField], draft: { theme: '' }, values: { theme: 'dark' } }),
    ).toEqual([{ kind: 'unset', path: 'theme' }])
  })

  it('sets a chosen select value and skips untouched rows', () => {
    expect(
      settingsDraftOps({
        fields: [selectField],
        draft: { theme: 'light' },
        values: { theme: 'dark' },
      }),
    ).toEqual([{ kind: 'set', path: 'theme', value: 'light' }])
    expect(
      settingsDraftOps({
        fields: [selectField],
        draft: { theme: 'dark' },
        values: { theme: 'dark' },
      }),
    ).toEqual([])
  })

  it('keeps secret rows out until touched and coerces numbers', () => {
    const fields = [
      { path: 'apiKey', type: 'string', secret: true },
      { path: 'limit', type: 'number' },
    ]
    expect(
      settingsDraftOps({
        fields,
        draft: { apiKey: 'x', limit: '5' },
        values: {},
        touchedSecrets: new Set(),
      }),
    ).toEqual([{ kind: 'set', path: 'limit', value: 5 }])
    expect(
      settingsDraftOps({
        fields,
        draft: { apiKey: 'x', limit: '' },
        values: {},
        touchedSecrets: new Set(['apiKey']),
      }),
    ).toEqual([
      { kind: 'set', path: 'apiKey', value: 'x' },
      { kind: 'unset', path: 'limit' },
    ])
  })
})
