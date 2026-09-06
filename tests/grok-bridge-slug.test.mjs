import { describe, expect, it } from 'vitest'
import { isGrokEngineKey, slugToModelKey } from '../src/pages/ApiServer/model-slug.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from '../src/config/limits.mjs'

describe('slugToModelKey', () => {
  it('routes grok slugs to Grok keys', () => {
    expect(slugToModelKey('grok-chat-expert')).toBe('grokWebExpert')
    expect(isGrokEngineKey('grokWebExpert')).toBe(true)
  })

  it('keeps ChatGPT slugs and unknown fallback', () => {
    expect(slugToModelKey('gpt-6-pro')).toBe('chatgptWeb6Pro')
    expect(slugToModelKey('gpt-6-astra-wm')).toBe('chatgptWeb6AstraWork')
    expect(slugToModelKey('gpt-5-6-thinking')).toBe('chatgptWeb56Thinking')
    expect(slugToModelKey('totally-new-slug')).toBe(CHATGPT_WEB_DEFAULT_MODEL_KEY)
    expect(isGrokEngineKey('chatgptWeb56Thinking')).toBe(false)
  })
})
