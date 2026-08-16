import { describe, expect, it } from 'vitest'
import { buildEngineOptions } from '../src/popup/components/engine-options.mjs'

const t = (key) => key
const base = {
  enabledProviders: { chatgptWebModelKeys: true, chatgptApiModelKeys: true },
  customApiModes: [],
  activeApiModes: ['chatgptWeb56Thinking'],
  grokWebSignedIn: false,
  grokWebAccountTier: '',
  grokWebAccountModels: [],
  modelName: 'chatgptWeb56Thinking',
}

describe('buildEngineOptions grok visibility', () => {
  it('omits Grok when signed out', () => {
    const values = buildEngineOptions(base, t).map((o) => o.value)
    expect(values.some((v) => String(v).startsWith('grokWeb'))).toBe(false)
  })

  it('includes tier-filtered Grok when signed in', () => {
    const values = buildEngineOptions(
      {
        ...base,
        grokWebSignedIn: true,
        grokWebAccountTier: 'super',
        grokWebAccountModels: ['grok-chat-fast', 'grok-chat-auto', 'grok-chat-expert'],
      },
      t,
    ).map((o) => o.value)
    expect(values).toContain('grokWebFast')
    expect(values).toContain('grokWebExpert')
    expect(values).not.toContain('grokWebHeavy')
  })

  it('keeps a selected Grok key after sign-out', () => {
    const values = buildEngineOptions(
      { ...base, grokWebSignedIn: false, modelName: 'grokWebExpert' },
      t,
      { selectedModelName: 'grokWebExpert' },
    ).map((o) => o.value)
    expect(values).toContain('grokWebExpert')
  })
})
