import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_SELECTION,
  coerceStoredEngineSelection,
  createDefaultL1Providers,
  enabledChatgptWebSelections,
  enabledGrokWebSelections,
  fallbackEngineSelection,
  firstEnabledSelection,
  formatEngineSelection,
  listEnabledEngineSelections,
  parseEngineSelection,
  resolveEngine,
  sanitizeSiteEngineOverrides,
} from '../src/config/engine-selection.mjs'

describe('engine selection', () => {
  it('parses providerId/modelId', () => {
    expect(parseEngineSelection('tokendance/deepseek-v4.1-flash')).toEqual({
      providerId: 'tokendance',
      modelId: 'deepseek-v4.1-flash',
    })
    expect(formatEngineSelection('chatgptweb', 'gpt-5-6-thinking')).toBe(
      'chatgptweb/gpt-5-6-thinking',
    )
  })

  it('defaults TokenDance as the only L1 row', () => {
    const providers = createDefaultL1Providers()
    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({
      id: 'tokendance',
      format: 'openai-compat',
      baseUrl: 'https://tokendance.space/gateway/v1',
    })
    expect(providers[0].models[0].id).toBe('deepseek-v4.1-flash')
  })

  it('current-engine default is ChatGPT Web, not TokenDance', () => {
    expect(DEFAULT_ENGINE_SELECTION).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('omits L1 providers that have no enabled models', () => {
    const config = {
      l1Providers: [
        {
          id: 'empty',
          name: 'Empty',
          format: 'openai-compat',
          models: [{ id: 'x', enabled: false, source: 'manual' }],
        },
      ],
      chatgptWebEnabled: false,
      grokWebEnabled: false,
      dshModuleEnabled: false,
    }
    expect(listEnabledEngineSelections(config)).toEqual([])
  })

  it('routes L1 openai-compat to custom-api kind', () => {
    const config = { l1Providers: createDefaultL1Providers() }
    expect(resolveEngine({ modelName: 'tokendance/deepseek-v4.1-flash' }, config)).toMatchObject({
      kind: 'l1',
      format: 'openai-compat',
      providerId: 'tokendance',
    })
    expect(resolveEngine({ modelName: 'chatgptweb/gpt-5-6-thinking' })).toMatchObject({
      kind: 'chatgpt-web',
    })
  })

  it('does not fall back to ChatGPT Web when nothing is enabled', () => {
    expect(
      firstEnabledSelection({
        l1Providers: [],
        chatgptWebEnabled: false,
        grokWebEnabled: false,
        dshModuleEnabled: false,
      }),
    ).toBe('')
  })

  it('coerces leftover vendor model names to ChatGPT Web when it is on', () => {
    expect(
      coerceStoredEngineSelection('chatgptApi5_4', {
        l1Providers: createDefaultL1Providers(),
        chatgptWebEnabled: true,
      }),
    ).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('keeps a known L1 selection', () => {
    expect(
      coerceStoredEngineSelection('tokendance/deepseek-v4.1-flash', {
        l1Providers: createDefaultL1Providers(),
      }),
    ).toBe('tokendance/deepseek-v4.1-flash')
  })

  it('omits Grok picker rows when the enabled-model list is empty', () => {
    expect(
      enabledGrokWebSelections({
        grokWebEnabled: true,
        grokWebAccountModels: ['grok-chat-fast', 'grok-chat-expert'],
        grokWebEnabledModels: [],
      }),
    ).toEqual([])
  })

  it('omits ChatGPT Web picker rows when the enabled-model list is empty', () => {
    expect(
      enabledChatgptWebSelections({
        chatgptWebEnabled: true,
        chatgptWebAccountModels: ['gpt-5-6-thinking', 'gpt-5-6-instant'],
        chatgptWebEnabledModels: [],
      }),
    ).toEqual([])
  })

  it('does not revive disabled ChatGPT Web as a fallback', () => {
    const config = {
      l1Providers: [
        {
          id: 'tokendance',
          name: 'TokenDance',
          format: 'openai-compat',
          models: [{ id: 'deepseek-v4.1-flash', enabled: false, source: 'manual' }],
        },
      ],
      chatgptWebEnabled: false,
      chatgptWebEnabledModels: ['gpt-5-6-thinking'],
      grokWebEnabled: false,
      dshModuleEnabled: false,
    }
    expect(fallbackEngineSelection(config)).toBe('')
    expect(coerceStoredEngineSelection('', config)).toBe('')
    expect(coerceStoredEngineSelection('chatgptApi5_4', config)).toBe('')
  })

  it('drops leftover vendor site overrides instead of mapping them', () => {
    const config = { l1Providers: createDefaultL1Providers() }
    expect(
      sanitizeSiteEngineOverrides(
        {
          github: { modelName: 'claudeApi', apiMode: { groupName: 'claudeApiModelKeys' } },
          gitlab: { modelName: 'chatgptweb/gpt-5-6-thinking' },
          reddit: { modelName: 'missing-provider/gpt-4' },
        },
        config,
      ),
    ).toEqual({
      gitlab: { modelName: 'chatgptweb/gpt-5-6-thinking', apiMode: null },
    })
  })
})
