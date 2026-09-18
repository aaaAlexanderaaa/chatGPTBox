import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_SELECTION,
  createDefaultL1Providers,
  formatEngineSelection,
  listEnabledEngineSelections,
  parseEngineSelection,
  resolveEngine,
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
})
