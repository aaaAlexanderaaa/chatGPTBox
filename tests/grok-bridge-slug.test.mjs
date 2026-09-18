import { describe, expect, it } from 'vitest'
import { isGrokEngineKey, slugToModelKey } from '../src/pages/ApiServer/model-slug.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from '../src/config/limits.mjs'

describe('slugToModelKey', () => {
  it('routes grok slugs to grokweb/<slug>', () => {
    expect(slugToModelKey('grok-chat-expert')).toBe('grokweb/grok-chat-expert')
    expect(isGrokEngineKey('grokweb/grok-chat-expert')).toBe(true)
    expect(isGrokEngineKey('grokWebExpert')).toBe(true)
  })

  it('keeps ChatGPT slugs as chatgptweb/<slug>', () => {
    expect(slugToModelKey('gpt-6-pro')).toBe('chatgptweb/gpt-6-pro')
    expect(slugToModelKey('gpt-6-astra-wm')).toBe('chatgptweb/gpt-6-astra-wm')
    expect(slugToModelKey('gpt-5-6-thinking')).toBe('chatgptweb/gpt-5-6-thinking')
    expect(slugToModelKey('totally-new-slug')).toBe('chatgptweb/totally-new-slug')
    expect(slugToModelKey('')).toBe(CHATGPT_WEB_DEFAULT_MODEL_KEY)
    expect(isGrokEngineKey('chatgptweb/gpt-5-6-thinking')).toBe(false)
  })
})
