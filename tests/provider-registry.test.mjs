import { describe, expect, it } from 'vitest'
import { PROVIDERS, detectExecutionRoute } from '../src/background/providers/registry.mjs'
import { createDefaultL1Providers } from '../src/config/engine-selection.mjs'

function l1Config(format, id, modelId, extra = {}) {
  return {
    l1Providers: [
      {
        id,
        name: id,
        format,
        baseUrl: extra.baseUrl || 'https://example.com/v1',
        apiKey: '',
        models: [{ id: modelId, enabled: true, source: 'manual' }],
      },
    ],
  }
}

const SESSION_BY_ROUTE = {
  'dsh-bridge': {
    session: { modelName: 'dsh/agent' },
    config: {},
  },
  'custom-api': {
    session: { modelName: 'tokendance/deepseek-v4.1-flash' },
    config: { l1Providers: createDefaultL1Providers() },
  },
  'chatgpt-web': {
    session: { modelName: 'chatgptweb/gpt-5-6-thinking' },
    config: {},
  },
  'grok-web': {
    session: { modelName: 'grokweb/grok-chat-expert' },
    config: {},
  },
  'claude-api': {
    session: { modelName: 'anth/claude-sonnet' },
    config: l1Config('anthropic', 'anth', 'claude-sonnet'),
  },
  'ollama-api': {
    session: { modelName: 'local/llama' },
    config: l1Config('ollama', 'local', 'llama', { baseUrl: 'http://127.0.0.1:11434' }),
  },
  'azure-openai-api': {
    session: { modelName: 'az/deploy' },
    config: l1Config('azure', 'az', 'deploy'),
  },
  'gpt-completion-api': {
    session: { modelName: 'comp/davinci' },
    config: l1Config('completions', 'comp', 'davinci'),
  },
}

describe('provider registry', () => {
  it('has exactly 8 providers', () => {
    expect(PROVIDERS.length).toBe(8)
  })

  it('each provider exposes { route, match, run }', () => {
    for (const p of PROVIDERS) {
      expect(typeof p.route).toBe('string')
      expect(typeof p.match).toBe('function')
      expect(typeof p.run).toBe('function')
    }
  })

  it('routes are unique', () => {
    const routes = PROVIDERS.map((p) => p.route)
    expect(new Set(routes).size).toBe(routes.length)
  })

  const EXPECTED_ORDER = [
    'dsh-bridge',
    'custom-api',
    'chatgpt-web',
    'grok-web',
    'claude-api',
    'ollama-api',
    'azure-openai-api',
    'gpt-completion-api',
  ]

  it('preserves L1/L2/L3 routing order', () => {
    expect(PROVIDERS.map((p) => p.route)).toEqual(EXPECTED_ORDER)
  })

  for (const route of EXPECTED_ORDER) {
    it(`${route}: matches a session using its own model and reports the correct route`, () => {
      const { session, config } = SESSION_BY_ROUTE[route]
      const provider = PROVIDERS.find((p) => p.route === route)
      expect(provider.match(session, config)).toBe(true)
      expect(detectExecutionRoute(session, config)).toBe(route)
    })
  }

  it('returns "unknown" for a session matching no provider', () => {
    expect(detectExecutionRoute({ modelName: 'does-not-exist' }, {})).toBe('unknown')
  })

  it('does not keep moonshot or vendor API routes', () => {
    expect(PROVIDERS.map((p) => p.route)).not.toContain('moonshot-web')
    expect(PROVIDERS.map((p) => p.route)).not.toContain('chatgpt-api')
    expect(PROVIDERS.map((p) => p.route)).not.toContain('openrouter-api')
  })
})
