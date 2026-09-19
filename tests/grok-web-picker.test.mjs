import { describe, expect, it } from 'vitest'
import { buildEngineOptions } from '../src/popup/components/engine-options.mjs'
import { createDefaultL1Providers } from '../src/config/engine-selection.mjs'

const t = (key) => key
const base = {
  l1Providers: createDefaultL1Providers(),
  chatgptWebEnabled: true,
  chatgptWebEnabledModels: ['gpt-5-6-thinking'],
  chatgptWebAccountModels: ['gpt-5-6-thinking'],
  grokWebEnabled: false,
  grokWebEnabledModels: [],
  grokWebAccountModels: [],
  dshModuleEnabled: false,
  modelName: 'chatgptweb/gpt-5-6-thinking',
}

describe('buildEngineOptions', () => {
  it('lists TokenDance and ChatGPT Web, omits Grok when the slide is off', () => {
    const values = buildEngineOptions(base, t).map((o) => o.value)
    expect(values).toContain('tokendance/deepseek-v4.1-flash')
    expect(values).toContain('chatgptweb/gpt-5-6-thinking')
    expect(values.some((v) => String(v).startsWith('grokweb/'))).toBe(false)
    expect(values).not.toContain('customModel')
  })

  it('includes Grok when the enable slide is on, not only when signed in', () => {
    const values = buildEngineOptions(
      {
        ...base,
        grokWebEnabled: true,
        grokWebSignedIn: false,
        grokWebAccountModels: ['grok-chat-fast', 'grok-chat-expert'],
        grokWebEnabledModels: ['grok-chat-expert'],
      },
      t,
    ).map((o) => o.value)
    expect(values).toContain('grokweb/grok-chat-expert')
    expect(values).not.toContain('grokweb/grok-chat-fast')
  })

  it('does not treat an empty Grok enabled list as the whole catalog', () => {
    const values = buildEngineOptions(
      {
        ...base,
        grokWebEnabled: true,
        grokWebAccountModels: ['grok-chat-fast', 'grok-chat-expert'],
        grokWebEnabledModels: [],
      },
      t,
    ).map((o) => o.value)
    expect(values.some((v) => String(v).startsWith('grokweb/'))).toBe(false)
  })

  it('keeps a selected stale engine visible', () => {
    const values = buildEngineOptions({ ...base, modelName: 'chatgptApi5_4' }, t, {
      selectedModelName: 'chatgptApi5_4',
    }).map((o) => o.value)
    expect(values).toContain('chatgptApi5_4')
  })

  it('keeps a site override visible after its model is unchecked', () => {
    const values = buildEngineOptions(
      {
        ...base,
        chatgptWebEnabledModels: [],
        chatgptWebAccountModels: ['gpt-5-6-thinking'],
      },
      t,
      { selectedModelName: 'chatgptweb/gpt-5-6-thinking' },
    ).map((o) => o.value)
    expect(values).toContain('chatgptweb/gpt-5-6-thinking')
  })
})
