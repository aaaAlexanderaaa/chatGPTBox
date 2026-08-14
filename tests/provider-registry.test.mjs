import { describe, expect, it } from 'vitest'
import { PROVIDERS, detectExecutionRoute } from '../src/background/providers/registry.mjs'

// The provider registry replaced the inline if/else-if chain in
// background executeApi(). These tests pin the registry's ordering and each
// provider's match predicate + route name, without invoking run() (which would
// require a live port + network). This guards against accidentally reordering
// the registry or renaming a route — both of which would silently change which
// provider handles a given model.

// One representative modelName per provider, drawn from its *ModelKeys array.
// Used to build a minimal { modelName } session that the match predicate will
// accept. The modelNames here must belong to exactly one provider group each,
// so the "first match wins" ordering is unambiguous.
const SESSION_BY_ROUTE = {
  'custom-api': { modelName: 'customModel' },
  'chatgpt-web': { modelName: 'chatgptWeb56Thinking' },
  'moonshot-web': { modelName: 'moonshotWebFree' },
  'chatgpt-api': { modelName: 'chatgptApi5_4' },
  'claude-api': { modelName: 'claudeSonnet45Api' },
  'moonshot-api': { modelName: 'moonshot_k2' },
  'chatglm-api': { modelName: 'chatglmTurbo' },
  'deepseek-api': { modelName: 'deepseek_chat' },
  'ollama-api': { modelName: 'ollamaModel' },
  'openrouter-api': { modelName: 'openRouter_anthropic_claude_sonnet4' },
  'aiml-api': { modelName: 'aiml_anthropic_claude_opus_4' },
  'azure-openai-api': { modelName: 'azureOpenAi' },
  'gpt-completion-api': { modelName: 'gptApiInstruct' },
}

describe('provider registry', () => {
  it('has exactly 13 providers', () => {
    expect(PROVIDERS.length).toBe(13)
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

  // The exact ordering of the original if/else-if chain. Do not reorder this
  // array without comparing against the pre-refactor chain — the isUsing*
  // predicates can overlap on edge-case models, so order is load-bearing.
  const EXPECTED_ORDER = [
    'custom-api',
    'chatgpt-web',
    'moonshot-web',
    'chatgpt-api',
    'claude-api',
    'moonshot-api',
    'chatglm-api',
    'deepseek-api',
    'ollama-api',
    'openrouter-api',
    'aiml-api',
    'azure-openai-api',
    'gpt-completion-api',
  ]

  it('preserves the original branch ordering', () => {
    expect(PROVIDERS.map((p) => p.route)).toEqual(EXPECTED_ORDER)
  })

  for (const route of EXPECTED_ORDER) {
    it(`${route}: matches a session using its own model and reports the correct route`, () => {
      const session = SESSION_BY_ROUTE[route]
      const provider = PROVIDERS.find((p) => p.route === route)
      expect(provider.match(session)).toBe(true)
      expect(detectExecutionRoute(session)).toBe(route)
    })
  }

  it('returns "unknown" for a session matching no provider', () => {
    expect(detectExecutionRoute({ modelName: 'does-not-exist' })).toBe('unknown')
  })
})
